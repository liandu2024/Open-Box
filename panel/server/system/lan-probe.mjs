// 「模拟 LAN 终端」的底层:在路由器上建一个独立的网络命名空间,用一对 veth 把它接到 LAN 网桥,
// 像一台新设备一样通过 DHCP 拿地址和 DNS;探测子进程(lan-probe-child.mjs)在里面发 DNS 和 HTTP。
// 它的包从 LAN 入口进入路由器,和真实终端走同一条 nft / 路由链:入口旁路命中就由系统直接转发,
// 否则被 redirect / 打标送进内核。面板在外面读 conntrack、`ip route get`、nft 旁路集合和内核
// 连接表,给每条测试连接一份"系统转发证据";没有证据不判旁路。
//
// 命名空间建好后留着复用(DHCP 一次要 1–3 秒),十分钟没人用再拆;面板重启后第一次用会先拆掉
// 上一个进程留下的再重建,状态才可信。
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROBE_NETNS = 'openbox-probe'
export const PROBE_VETH_HOST = 'obprobe0'
export const PROBE_VETH_NS = 'obprobe1'
// 本地管理位的固定 MAC:每次都拿同一个 DHCP 租约,DHCP 表里只出现一台「openbox-probe」
export const PROBE_MAC = '02:4f:42:00:00:01'
export const PROBE_HOSTNAME = 'openbox-probe'
export const PROBE_DHCP_SCRIPT = '/tmp/openbox-probe-dhcp.sh'
export const NETNS_IDLE_MS = 10 * 60 * 1000
export const SINGBOX_NFT_TABLE = 'sing-box'
// sing-box tun 的默认标记:auto_redirect 把送进 tun 的流量打 0x2023(input),内核自己出去的打 0x2024(output)
export const TUN_INPUT_MARK = 0x2023
export const TUN_OUTPUT_MARK = 0x2024
export const CONNTRACK_PATH = '/proc/net/nf_conntrack'

const CHILD_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lan-probe-child.mjs')

// ---------- 能力检查 ----------
export const parseInterfaceStatus = (text) => {
  try {
    const j = JSON.parse(String(text || ''))
    const v4 = (j['ipv4-address'] || [])[0]
    return { device: j.l3_device || j.device || '', address: v4 ? v4.address : '', mask: v4 ? Number(v4.mask) : null, up: Boolean(j.up) }
  } catch {
    return null
  }
}
export const parseAddrShow = (text) => {
  const m = /^\s*\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)\/(\d+)/m.exec(String(text || ''))
  return m ? { device: m[1], address: m[2], mask: Number(m[3]), up: true } : null
}
// LAN 网桥:先问 netifd(逻辑接口 lan 占着哪个设备),问不到按 br-lan 读地址
export const readLanInterface = async (ctx) => {
  try {
    const r = await ctx.exec('ubus', ['call', 'network.interface.lan', 'status'], { timeoutMs: 5000 })
    const st = r.code === 0 ? parseInterfaceStatus(r.stdout) : null
    if (st && st.device && st.address) return st
  } catch { /* 没有 ubus */ }
  try {
    const r = await ctx.exec('ip', ['-4', '-o', 'addr', 'show', 'dev', 'br-lan'], { timeoutMs: 5000 })
    if (r.code === 0) return parseAddrShow(r.stdout)
  } catch { /* 忽略 */ }
  return null
}
// 缺什么就列什么(missing 里的代号前端翻成人话),一项不缺才算具备条件
export const probeCapability = async (ctx, { uid = typeof process.getuid === 'function' ? process.getuid() : 0 } = {}) => {
  const missing = []
  if (uid !== 0) missing.push('root')
  const ns = await ctx.exec('ip', ['netns', 'list'], { timeoutMs: 5000 })
  if (ns.code !== 0) missing.push('netns')
  let veth = await ctx.exists('/sys/module/veth')
  if (!veth) {
    const m = await ctx.exec('modprobe', ['veth'], { timeoutMs: 5000 })
    veth = m.code === 0
  }
  if (!veth) missing.push('veth')
  const lan = await readLanInterface(ctx)
  if (!lan) missing.push('lan')
  if (!(await ctx.exists(CONNTRACK_PATH))) missing.push('conntrack')
  let dhcp = (await ctx.exists('/sbin/udhcpc')) || (await ctx.exists('/usr/sbin/udhcpc')) || (await ctx.exists('/bin/udhcpc'))
  if (!dhcp) {
    const w = await ctx.exec('which', ['udhcpc'], { timeoutMs: 5000 })
    dhcp = w.code === 0
  }
  if (!dhcp) missing.push('dhcp')
  return { ok: missing.length === 0, missing, lan }
}

// ---------- 命名空间的生命周期 ----------
const state = { lease: null, timer: null }
export const probeState = () => ({ lease: state.lease })

const netnsExists = async (ctx) => {
  const r = await ctx.exec('ip', ['netns', 'list'], { timeoutMs: 5000 })
  return r.code === 0 && String(r.stdout).split('\n').some((l) => l.trim().split(/\s+/)[0] === PROBE_NETNS)
}
export const teardownProbeNetns = async (ctx) => {
  if (state.timer) { clearTimeout(state.timer); state.timer = null }
  state.lease = null
  // 删命名空间时里面那半根 veth 一起没了,外面这半根跟着消失;保险起见再删一次(不存在就报错,不管)
  await ctx.exec('ip', ['netns', 'del', PROBE_NETNS], { timeoutMs: 10000 })
  await ctx.exec('ip', ['link', 'del', PROBE_VETH_HOST], { timeoutMs: 5000 })
  await ctx.remove(PROBE_DHCP_SCRIPT).catch(() => {})
}
const touch = (ctx) => {
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => { teardownProbeNetns(ctx).catch(() => {}) }, NETNS_IDLE_MS)
  if (typeof state.timer.unref === 'function') state.timer.unref()
}

// udhcpc 的回调脚本:拿到租约就把地址和默认路由配到命名空间里那半根 veth 上,并把租约打印出来
// (mask 是前缀长度;router / dns 可能有多个,空格分隔)
export const DHCP_SCRIPT = `#!/bin/sh
case "$1" in
  bound|renew)
    ip addr flush dev "$interface" 2>/dev/null
    ip addr add "$ip/\${mask:-24}" dev "$interface"
    [ -n "$router" ] && ip route replace default via "\${router%% *}" dev "$interface"
    echo "LEASE ip=$ip mask=$mask router=$router dns=$dns"
    ;;
esac
`
export const parseLease = (text) => {
  const m = /LEASE ip=(\S+) mask=(\S*) router=(.*?) dns=(.*)$/m.exec(String(text || ''))
  if (!m || !net.isIP(m[1])) return null
  return {
    ip: m[1],
    mask: Number(m[2]) || 24,
    gateway: m[3].trim().split(/\s+/).filter(Boolean)[0] || '',
    dns: m[4].trim().split(/\s+/).filter((s) => net.isIP(s)),
  }
}

// 建好(或复用)虚拟终端,返回租约:{ ip, mask, gateway, dns[], mac, hostname, lanDevice, dhcpMs, reused }
export const ensureProbeNetns = async (ctx, { lan }) => {
  if (state.lease && (await netnsExists(ctx))) {
    touch(ctx)
    return { ...state.lease, reused: true }
  }
  await teardownProbeNetns(ctx)
  const steps = [
    ['ip', ['netns', 'add', PROBE_NETNS]],
    ['ip', ['link', 'add', PROBE_VETH_HOST, 'type', 'veth', 'peer', 'name', PROBE_VETH_NS]],
    ['ip', ['link', 'set', PROBE_VETH_NS, 'netns', PROBE_NETNS]],
    ['ip', ['link', 'set', PROBE_VETH_HOST, 'master', lan.device, 'up']],
    ['ip', ['netns', 'exec', PROBE_NETNS, 'ip', 'link', 'set', 'lo', 'up']],
    ['ip', ['netns', 'exec', PROBE_NETNS, 'ip', 'link', 'set', PROBE_VETH_NS, 'address', PROBE_MAC]],
    ['ip', ['netns', 'exec', PROBE_NETNS, 'ip', 'link', 'set', PROBE_VETH_NS, 'up']],
  ]
  for (const [cmd, args] of steps) {
    const r = await ctx.exec(cmd, args, { timeoutMs: 10000 })
    if (r.code !== 0) {
      await teardownProbeNetns(ctx)
      throw new Error(`${cmd} ${args.join(' ')}: ${String(r.stderr || r.stdout || '').trim() || `exit ${r.code}`}`)
    }
  }
  await ctx.writeFile(PROBE_DHCP_SCRIPT, DHCP_SCRIPT)
  await ctx.exec('chmod', ['+x', PROBE_DHCP_SCRIPT], { timeoutMs: 5000 })
  const t0 = Date.now()
  // -n:拿不到就退出;-q:拿到就退出(租约留给 dnsmasq,MAC 固定所以下次还是它);-t 4 -T 1:最多等 4 秒左右
  const d = await ctx.exec('ip', ['netns', 'exec', PROBE_NETNS, 'udhcpc', '-i', PROBE_VETH_NS, '-n', '-q', '-t', '4', '-T', '1', '-x', `hostname:${PROBE_HOSTNAME}`, '-s', PROBE_DHCP_SCRIPT], { timeoutMs: 20000 })
  const lease = parseLease(d.stdout)
  if (!lease) {
    await teardownProbeNetns(ctx)
    const tail = String(d.stderr || d.stdout || '').trim().split('\n').filter(Boolean).pop() || 'no lease'
    throw new Error(`dhcp: ${tail}`)
  }
  state.lease = { ...lease, mac: PROBE_MAC, hostname: PROBE_HOSTNAME, lanDevice: lan.device, dhcpMs: Date.now() - t0 }
  touch(ctx)
  return { ...state.lease, reused: false }
}

// ---------- 在命名空间里跑探测子进程 ----------
// onEvent(ev, control):每收到子进程一行 JSON 调一次;control.close() 让子进程断开连接退出。
// 返回 { events, code, stderr }。
export const runProbeChild = ({ spawnImpl = spawn, nodeBin = process.execPath, opts, onEvent, timeoutMs = 30000 }) =>
  new Promise((resolve) => {
    let child
    try {
      child = spawnImpl('ip', ['netns', 'exec', PROBE_NETNS, nodeBin, CHILD_SCRIPT, JSON.stringify(opts)], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ events: [], code: null, stderr: '', error: err instanceof Error ? err.message : String(err) })
      return
    }
    const events = []
    let stderr = ''
    let buf = ''
    let done = false
    const finish = (extra) => { if (!done) { done = true; resolve({ events, stderr: stderr.trim(), ...extra }) } }
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } }, timeoutMs)
    const control = { close: () => { try { child.stdin.write('close\n') } catch { /* ignore */ } } }
    child.stdout.on('data', (c) => {
      buf += c.toString()
      let i
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        let ev
        try { ev = JSON.parse(line) } catch { continue }
        events.push(ev)
        if (onEvent) {
          try { onEvent(ev, control) } catch { /* 处理事件出错不影响子进程 */ }
        }
      }
    })
    child.stderr.on('data', (c) => { stderr += c.toString() })
    child.on('error', (err) => { clearTimeout(timer); finish({ code: null, error: err.message }) })
    child.on('close', (code) => { clearTimeout(timer); finish({ code }) })
  })

// ---------- 系统侧证据 ----------
// /proc/net/nf_conntrack 一行:
//   ipv4 2 tcp 6 113 TIME_WAIT src=A dst=B sport=x dport=y [packets= bytes=] src=C dst=D sport= dport= [ASSURED] mark=0 zone=0 use=2
// 第一组 src= 是原始方向(终端 → 目标),第二组是回复方向(目标那边怎么回);udp / icmp 没有状态词。
export const parseConntrack = (text) => {
  const out = []
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const tokens = line.split(/\s+/)
    const l3 = tokens[0]
    const proto = tokens[2]
    const tuples = []
    let cur = null
    let state = ''
    let mark = null
    const flags = []
    for (let i = 3; i < tokens.length; i++) {
      const tk = tokens[i]
      const kv = tk.indexOf('=')
      if (kv > 0) {
        const k = tk.slice(0, kv)
        const v = tk.slice(kv + 1)
        if (k === 'src') { cur = { src: v }; tuples.push(cur); continue }
        if (cur && (k === 'dst' || k === 'type' || k === 'code' || k === 'id')) { cur[k] = v; continue }
        if (cur && (k === 'sport' || k === 'dport')) { cur[k] = Number(v); continue }
        if (k === 'mark') mark = Number(v)
        continue
      }
      if (/^\[[A-Z]+\]$/.test(tk)) { flags.push(tk.slice(1, -1)); continue }
      if (!tuples.length && /^[A-Z_]+$/.test(tk)) state = tk
    }
    if (tuples.length < 2) continue
    out.push({ l3, proto, state, orig: tuples[0], reply: tuples[1], flags, mark, line })
  }
  return out
}
export const readConntrack = async (ctx) => {
  try {
    return parseConntrack(await ctx.readFile(CONNTRACK_PATH))
  } catch {
    return null
  }
}
// 按原始方向找这条连接;sport 不知道(连接没建起来)时只按目标找,取最后一条
export const findFlow = (entries, { proto, src, sport, dst, dport }) => {
  const list = (entries || []).filter((e) => e.proto === proto && e.orig.src === src && e.orig.dst === dst &&
    (dport === undefined || e.orig.dport === dport) && (sport === undefined || e.orig.sport === sport))
  return list.length ? list[list.length - 1] : null
}
// 虚拟终端发往 DNS 服务器的查询:回复方是不是它本人。被内核劫持的查询在入口被 dnat 到 tun 对端,
// 回复方就变成 172.19.0.2 那样的地址
export const dnsEvidence = (entries, { src, server }) => {
  const flows = (entries || []).filter((e) => e.proto === 'udp' && e.orig.src === src && e.orig.dst === server && e.orig.dport === 53)
  const hijacked = flows.filter((e) => e.reply.src !== server)
  const pick = hijacked[0] || flows[flows.length - 1]
  return { flows: flows.length, hijacked: hijacked.length > 0, answeredBy: hijacked.length ? hijacked[0].reply.src : flows.length ? server : '', line: pick ? pick.line : '' }
}

export const parseRouteGet = (text) => {
  const line = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || ''
  if (!line) return null
  const dev = /\bdev\s+(\S+)/.exec(line)
  const via = /\bvia\s+(\S+)/.exec(line)
  const table = /\btable\s+(\S+)/.exec(line)
  return { line, dev: dev ? dev[1] : '', via: via ? via[1] : '', table: table ? table[1] : '' }
}
// 内核会把"从 iif 进来、来源 from、发往 dst、带 mark"的包从哪个设备转出去:auto_redirect 下打了
// 0x2023 的走 tun 表,没打标的按主表(WAN);纯 tun 模式没有 nft,ip rule 直接决定
export const routeGet = async (ctx, { dst, from, iif, mark }) => {
  const args = ['route', 'get', dst, 'from', from, 'iif', iif]
  if (mark) args.push('mark', `0x${Number(mark).toString(16)}`)
  const r = await ctx.exec('ip', args, { timeoutMs: 5000 })
  return r.code === 0 ? parseRouteGet(r.stdout) : null
}
// 目标在不在 sing-box 装进 nft 的旁路集合里(集合不存在 = 当前没有原生旁路)
export const bypassSetHas = async (ctx, ip) => {
  const set = net.isIPv6(ip) ? 'inet6_route_exclude_address_set' : 'inet4_route_exclude_address_set'
  const exists = await ctx.exec('nft', ['list', 'set', 'inet', SINGBOX_NFT_TABLE, set], { timeoutMs: 5000 })
  if (exists.code !== 0) return { set: null, hit: false }
  const r = await ctx.exec('nft', ['get', 'element', 'inet', SINGBOX_NFT_TABLE, set, `{ ${ip} }`], { timeoutMs: 5000 })
  return { set, hit: r.code === 0 }
}
// 生成配置里 tun 入站的设备名和标记(没写就是 sing-box 的默认)
export const tunSettings = (config) => {
  const tun = ((config && config.inbounds) || []).find((i) => i && i.type === 'tun') || {}
  return {
    device: tun.interface_name || 'tun0',
    autoRedirect: Boolean(tun.auto_redirect),
    inputMark: Number(tun.auto_redirect_input_mark) || TUN_INPUT_MARK,
    outputMark: Number(tun.auto_redirect_output_mark) || TUN_OUTPUT_MARK,
  }
}

// 入口判定。只认系统给的证据:
//   kernel  —— conntrack 里回复方被改写成路由器自己的地址(auto_redirect 的 redirect),或流被打了 tun 的
//              输入标记,或内核连接表里有这条连接(纯 tun 模式)
//   bypass  —— conntrack 有这条流、没被改写、没打 tun 标记、内核连接表里也没有,并且按它的标记做路由
//              查询是从非 tun 设备转出去的(masquerade:回包发往那个设备上路由器自己的地址)
//   unknown —— 其余一切(conntrack 没这条流、被改写到别处、路由查不到、路由却说进 tun)都不判旁路
export const classifyEntry = ({ flow, localAddresses = [], tunDevice = 'tun0', tunMark = TUN_INPUT_MARK, route = null, kernelConn = false, deviceAddresses = [] }) => {
  const evidence = { conntrack: flow ? flow.line : '', mark: flow ? flow.mark : null, route: route ? route.line : '', kernelConn }
  if (!flow) return { kind: 'unknown', reason: 'no-conntrack', evidence }
  const rewritten = flow.reply.src !== flow.orig.dst || flow.reply.sport !== flow.orig.dport
  const redirected = rewritten && localAddresses.includes(flow.reply.src)
  const marked = tunMark !== null && tunMark !== undefined && flow.mark === tunMark
  if (redirected) return { kind: 'kernel', via: 'redirect', redirectPort: flow.reply.sport, evidence }
  if (marked) return { kind: 'kernel', via: 'tun', evidence }
  if (kernelConn) return { kind: 'kernel', via: 'connection-table', evidence }
  if (rewritten) return { kind: 'unknown', reason: 'dnat-elsewhere', rewrittenTo: `${flow.reply.src}:${flow.reply.sport}`, evidence }
  if (!route) return { kind: 'unknown', reason: 'no-route', evidence }
  if (route.dev === tunDevice) return { kind: 'unknown', reason: 'route-tun', evidence }
  const masquerade = deviceAddresses.includes(flow.reply.dst)
  return { kind: 'bypass', via: 'forward', device: route.dev, gateway: route.via, masquerade, evidence }
}

// dnsmasq 转发清单(server=/后缀/127.0.0.1#7853)里有没有这个域名:有就是交给内核 DNS,没有就直接问上游。
// dnsmasq 的 server=/x/ 匹配 x 本身和它的所有子域
export const dnsmasqForwardFor = (confText, domain) => {
  const d = String(domain || '').toLowerCase().replace(/\.$/, '')
  for (const raw of String(confText || '').split('\n')) {
    const m = /^server=\/([^/]+)\/(\S+)/.exec(raw.trim())
    if (!m) continue
    const suffix = m[1].toLowerCase().replace(/^\./, '')
    if (d === suffix || d.endsWith(`.${suffix}`)) return { forward: 'kernel', suffix, to: m[2] }
  }
  return { forward: 'upstream' }
}
