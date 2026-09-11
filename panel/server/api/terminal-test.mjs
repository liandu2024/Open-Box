import express from 'express'
import net from 'node:net'
import { CLASH_API_BASE } from './penetration.mjs'
import { isFakeIp, targetUrl } from './route-test.mjs'
import { fetchSelections } from './deploy-runner.mjs'
import { configMetaPath } from '../system/deploy.mjs'
import { flushDnsCache } from '../system/dns-cache.mjs'
import { openKernelLogTap, traceDnsQuery } from '../system/dns-trace.mjs'
import { DNS_REWRITE_TAG } from '../engine/dns-rewrite.mjs'
import { dnsForwardFilePath } from '../system/dns-takeover.mjs'
import { parseIpAddresses } from '../system/local-subnets.mjs'
import { builtinTags } from '../engine/user-groups.mjs'
import * as lanProbe from '../system/lan-probe.mjs'

// 「模拟 LAN 终端」的真实路由测试:面板在路由器上建一个虚拟终端(system/lan-probe.mjs),让它像
// 一台普通 LAN 设备一样问 LAN 的 DNS、从 LAN 入口进入路由器,由实际入口规则决定旁路还是进内核。
// 和回环 mixed 入站的 route-test 不同,这条路径能看到入口旁路;判旁路必须拿到系统转发证据
// (conntrack 里这条流没被改写、没打 tun 标记、路由从非 tun 设备转出),内核连接表里"没记录"
// 本身不算证据。设备不具备条件时如实回 capable=false,前端不许悄悄退回回环测试。
const TARGET_PATTERN = /^[A-Za-z0-9._:-]+$/
const isValidTarget = (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('-') && TARGET_PATTERN.test(v)
const isIp = (v) => net.isIP(String(v)) !== 0
const errorMessage = (err) => (err instanceof Error ? err.message : String(err))
const clashHeaders = (secret) => (secret ? { Authorization: `Bearer ${secret}` } : {})
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fetchWithTimeout = async (fetchImpl, url, init = {}, timeoutMs = 5000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// 顺着 selector 的 now 一路下钻:站点集 → 节点组 → 节点(和 route-test 同一套)
const chainOf = (selections, name) => {
  const chain = [name]
  const seen = new Set()
  let cur = name
  for (let i = 0; i < 16 && Object.prototype.hasOwnProperty.call(selections, cur) && !seen.has(cur); i++) { seen.add(cur); cur = selections[cur]; chain.push(cur) }
  return chain
}

// 内核侧的解析过程:从日志流里截出这条查询(system/dns-trace.mjs),再配上配置里这个解析器长什么样、
// detour 此刻落到哪条线路。日志里记的拨号节点是实际发出查询的那个,比按 selector 推算的叶子更准:
// 两边不一致(刚切换过节点)以日志为准
export const kernelDnsFromTap = async (tap, { target, config, lease, lan, fetchImpl, secret, sleepImpl = sleep }) => {
  const preferSources = [lease && lease.ip, '127.0.0.1', lan && lan.address].filter(Boolean)
  const read = () => traceDnsQuery(tap.lines, target, { preferSources })
  let trace = read()
  // 应答行可能比虚拟终端拿到答案晚几十毫秒到:没等到就再等一会儿
  for (let i = 0; i < 6 && (!trace.seen || (trace.A && trace.A.result === 'pending')); i++) {
    await sleepImpl(100)
    trace = read()
  }
  if (!trace.seen) return { seen: false, reason: 'not-seen' }
  const rec = trace.A || trace.AAAA
  const conf = (((config && config.dns) || {}).servers || []).find((s) => s && s.tag === rec.server) || null
  const server = rec.server
    ? { tag: rec.server, type: conf ? String(conf.type || '') : '', server: conf ? String(conf.server || '') : '', port: conf && conf.server_port ? Number(conf.server_port) : null, detour: conf ? String(conf.detour || '') : '' }
    : null
  const dialed = rec.outbound && rec.outbound.tag ? rec.outbound.tag : ''
  let chain = []
  if (server && server.detour) {
    chain = chainOf(await fetchSelections(fetchImpl, secret), server.detour)
    if (dialed) {
      const at = chain.indexOf(dialed)
      chain = at >= 0 ? chain.slice(0, at + 1) : chain.length > 1 ? [...chain.slice(0, -1), dialed] : [dialed]
    }
  }
  const v6 = trace.AAAA ? { result: trace.AAAA.result, rcode: trace.AAAA.rcode, answers: trace.AAAA.answers, ms: trace.AAAA.ms, error: trace.AAAA.error } : undefined
  // 内核自己的 FakeIP 服务器(engine/dns.mjs 的原型)发的占位地址:不是上游 / 对端回的,连接进内核后按它找回域名
  const fakeIpLocal = Boolean(server && server.type === 'fakeip')
  return {
    seen: true,
    source: rec.source,
    ruleIndex: rec.ruleIndex,
    ruleText: rec.ruleText,
    action: rec.action,
    server,
    viaProxy: Boolean(server && server.detour),
    rewrite: Boolean(server && server.tag === DNS_REWRITE_TAG),
    outbound: dialed,
    chain,
    result: rec.result,
    rcode: rec.rcode,
    ttl: rec.ttl,
    answers: rec.answers,
    ms: rec.ms,
    error: rec.error,
    fakeIp: rec.answers.length > 0 && rec.answers.every(isFakeIp),
    fakeIpLocal,
    ...(v6 ? { v6 } : {}),
  }
}

// 一次只跑一个:虚拟终端只有一个,两条测试同时进去 conntrack 和连接表就分不清谁是谁
let chain = Promise.resolve()
const exclusive = (fn) => {
  const p = chain.then(fn, fn)
  chain = p.catch(() => {})
  return p
}

export const runTerminalTest = async ({ store, ctx, paths, fetchImpl = globalThis.fetch, probe = lanProbe, spawnImpl, nodeBin, logTap = openKernelLogTap }, { target, port: bodyPort }) => {
  const started = Date.now()
  const out = { target, mode: 'lan' }
  const cap = await probe.probeCapability(ctx)
  if (!cap.ok) return { ...out, capable: false, missing: cap.missing }
  out.capable = true

  let config = null
  try { config = JSON.parse(await ctx.readFile(paths.configPath)) } catch { config = null }
  const tun = probe.tunSettings(config)
  let firstLayer = null
  try {
    const meta = JSON.parse(await ctx.readFile(configMetaPath(paths)))
    if (meta.firstLayer && typeof meta.firstLayer === 'object') firstLayer = meta.firstLayer
  } catch { /* 没有部署记录就不带 */ }
  if (firstLayer) {
    out.firstLayer = { bypassEnabled: Boolean(firstLayer.nativeBypass && firstLayer.nativeBypass.enabled), bypassSets: (firstLayer.nativeBypass && firstLayer.nativeBypass.sets) || [], dnsMode: firstLayer.dnsMode || '', dnsForward: firstLayer.dnsForward || '' }
  }

  let lease
  try {
    lease = await probe.ensureProbeNetns(ctx, { lan: cap.lan })
  } catch (err) {
    return { ...out, setupError: errorMessage(err) }
  }
  out.source = { kind: 'virtual', name: lease.hostname, ip: lease.ip, mac: lease.mac, via: 'dhcp', dns: lease.dns, gateway: lease.gateway, lanDevice: lease.lanDevice, reused: Boolean(lease.reused), dhcpMs: lease.dhcpMs }

  const port = Number.isInteger(bodyPort) && bodyPort >= 1 && bodyPort <= 65535 ? bodyPort : isIp(target) ? 80 : 443
  const secure = port !== 80
  const profile = store.getProfile ? store.getProfile() : null
  const resolve6 = Boolean(profile && profile.ipv6)
  out.exit = { url: targetUrl(target, port, secure), port }
  const secret = store.getClashSecret ? store.getClashSecret() : ''
  const tags = builtinTags(store.getGroups ? store.getGroups() : [])

  // 域名走 dnsmasq 时,这条查询按转发清单是交给内核 DNS 还是直接问上游(配置推算,和下面的 conntrack 证据分开说)
  if (!isIp(target) && firstLayer && firstLayer.dnsMode === 'dnsmasq') {
    const plan = firstLayer.dnsForward || 'none'
    if (plan === 'all') out.dnsForward = { forward: 'kernel', plan }
    else if (plan === 'domains') {
      try {
        out.dnsForward = { ...probe.dnsmasqForwardFor(await ctx.readFile(dnsForwardFilePath(paths)), target), plan }
      } catch {
        out.dnsForward = { forward: 'unknown', plan }
      }
    } else out.dnsForward = { forward: 'upstream', plan }
  }

  const remote = { ip: isIp(target) ? target : '' }
  const kernelRecord = (hit) => {
    const chains = Array.isArray(hit.chains) ? hit.chains.slice().reverse() : []
    const leaf = chains[chains.length - 1]
    return { seen: true, id: hit.id || '', inbound: hit.metadata.type || '', rule: hit.rule || '', rulePayload: hit.rulePayload || '', chains, destinationIP: hit.metadata.destinationIP || '', host: hit.metadata.host || '', viaProxy: Boolean(leaf) && leaf !== tags.direct && leaf !== tags.block }
  }
  // 连接建起来(或者建不起来)之后,趁它还在,把系统侧证据一次收齐
  const gather = async ({ localPort }) => {
    let entries = null
    let flow = null
    for (const delay of [0, 150, 300, 600]) {
      if (delay) await sleep(delay)
      entries = await probe.readConntrack(ctx)
      flow = remote.ip ? probe.findFlow(entries, { proto: 'tcp', src: lease.ip, sport: localPort, dst: remote.ip, dport: port }) : null
      if (flow || !entries) break
    }
    const addrs = []
    for (const fam of ['-4', '-6']) {
      const r = await ctx.exec('ip', [fam, '-o', 'addr'], { timeoutMs: 5000 })
      if (r.code === 0) addrs.push(...parseIpAddresses(r.stdout))
    }
    const localAddresses = addrs.map((a) => a.address)
    const route = remote.ip ? await probe.routeGet(ctx, { dst: remote.ip, from: lease.ip, iif: lease.lanDevice, mark: flow && flow.mark ? flow.mark : 0 }) : null
    const deviceAddresses = route ? addrs.filter((a) => a.iface === route.dev).map((a) => a.address) : []
    let kernel = { seen: false }
    let kernelError = ''
    try {
      for (const delay of [0, 150, 250, 350, 450]) {
        if (delay) await sleep(delay)
        const c = await fetchWithTimeout(fetchImpl, `${CLASH_API_BASE}/connections`, { headers: clashHeaders(secret) }, 5000)
        const body = await c.json()
        const hit = ((body && body.connections) || []).find((x) => x && x.metadata &&
          x.metadata.sourceIP === lease.ip &&
          (localPort === undefined || String(x.metadata.sourcePort) === String(localPort)) &&
          (!remote.ip || x.metadata.destinationIP === remote.ip || String(x.metadata.host || '').toLowerCase() === target) &&
          String(x.metadata.destinationPort) === String(port))
        if (hit) {
          kernel = kernelRecord(hit)
          break
        }
      }
      // 刚建立的连接,链路可能还只记到节点组(叶子节点在拨号中):过一会儿再读一次,链路更长就用后面这份
      if (kernel.seen && kernel.id) {
        await sleep(250)
        const c = await fetchWithTimeout(fetchImpl, `${CLASH_API_BASE}/connections`, { headers: clashHeaders(secret) }, 5000)
        const body = await c.json()
        const again = ((body && body.connections) || []).find((x) => x && x.id === kernel.id)
        if (again && Array.isArray(again.chains) && again.chains.length > (kernel.chains || []).length) kernel = kernelRecord(again)
      }
    } catch (err) {
      kernelError = errorMessage(err)
    }
    const setInfo = remote.ip ? await probe.bypassSetHas(ctx, remote.ip) : { set: null, hit: false }
    const entry = probe.classifyEntry({ flow, localAddresses, tunDevice: tun.device, tunMark: tun.inputMark, route, kernelConn: kernel.seen, deviceAddresses })
    entry.evidence.set = setInfo.set
    entry.evidence.setHit = setInfo.hit
    if (!entries) entry.evidence.conntrackError = 'unreadable'
    if (kernelError) entry.evidence.kernelError = kernelError
    entry.evidence.autoRedirect = tun.autoRedirect
    entry.evidence.tunDevice = tun.device
    out.entry = entry
    out.kernel = kernel
    if (entry.kind === 'bypass') out.exit.forward = { device: entry.device, gateway: entry.gateway, masquerade: entry.masquerade, address: deviceAddresses[0] || '' }
    if (!isIp(target) && entries && lease.dns[0]) out.dnsEvidence = probe.dnsEvidence(entries, { src: lease.ip, server: lease.dns[0] })
  }

  // 子进程要等两件事都齐了才让它断开:系统侧证据收完、并且访问有了结果(响应或错误)。
  // 只等证据就断,经内核的连接往往还没拿到 HTTP 响应(拨到节点要几百毫秒),结果会被记成失败。
  let gathering = null
  let gathered = false
  let settled = false
  let closer = null
  const maybeClose = () => { if (gathered && settled && closer) closer.close() }
  const startGather = (args, control) => {
    closer = control
    if (gathering) return
    gathering = gather(args)
      .catch((err) => { out.entry = { kind: 'unknown', reason: 'evidence-failed', error: errorMessage(err), evidence: {} } })
      .finally(() => { gathered = true; maybeClose() })
  }
  // 域名目标:先清内核 DNS 缓存(和内核诊断一样——看真实路由就不该拿上一条线路问出来的缓存答案),
  // 再接上内核日志流,趁虚拟终端发查询的这一刻把内核侧的处理过程截下来。接不上就如实报,不推算
  let tap = null
  if (!isIp(target)) {
    await flushDnsCache(fetchImpl, secret)
    // dnsmasq 转发模式下 dnsmasq 自己还有一层缓存:命中了内核就收不到这条查询,下面就截不到内核侧的过程。
    // 发 SIGHUP 让它清缓存(只清缓存、重读 hosts,不动租约、不重启),和上面清内核缓存是同一个意思
    if (firstLayer && firstLayer.dnsMode === 'dnsmasq') {
      try {
        const pid = String((await ctx.exec('pidof', ['dnsmasq'], { timeoutMs: 3000 })).stdout || '').trim().split(/\s+/).filter(Boolean)
        if (pid.length) await ctx.exec('kill', ['-HUP', ...pid], { timeoutMs: 3000 })
      } catch { /* 清不了就算了,截不到时前端会说明可能是 dnsmasq 缓存 */ }
    }
    try {
      tap = logTap({ secret })
      if (!(await tap.ready)) {
        out.kernelDns = { seen: false, reason: 'no-log', error: tap.error || '' }
        tap.close()
        tap = null
      }
    } catch (err) {
      out.kernelDns = { seen: false, reason: 'no-log', error: errorMessage(err) }
      tap = null
    }
  }
  const opts = { target, port, secure, dnsServers: lease.dns, resolve6, timeoutMs: 10000, holdMs: 25000 }
  const result = await probe.runProbeChild({
    spawnImpl, nodeBin, opts, timeoutMs: 30000,
    onEvent: (ev, control) => {
      if (ev.event === 'dns') {
        out.dns = { server: ev.server, ok: Boolean(ev.ok), answers: ev.answers || [], ms: ev.ms }
        if (ev.error) out.dns.error = ev.error
        if (ev.answers6 !== undefined) { out.dns.answers6 = ev.answers6; if (ev.error6) out.dns.error6 = ev.error6 }
        remote.ip = (ev.answers || [])[0] || ''
      } else if (ev.event === 'connected') {
        remote.ip = ev.remoteAddress || remote.ip
        out.exit.connectTo = remote.ip
        out.exit.localPort = ev.localPort
        out.exit.connectMs = ev.ms
        startGather({ localPort: ev.localPort }, control)
      } else if (ev.event === 'response') {
        out.exit.ok = true
        out.exit.status = ev.status
        out.exit.ms = ev.ms
        settled = true
        maybeClose()
      } else if (ev.event === 'error') {
        out.exit.ok = false
        out.exit.error = ev.stage === 'dns' ? `dns: ${ev.error}` : ev.error
        if (ev.ms !== undefined) out.exit.ms = ev.ms
        settled = true
        // 连接没建起来(超时 / 被拒):conntrack 里也许有一条 SYN_SENT,照样看它被送去了哪
        if (ev.stage !== 'dns') startGather({ localPort: out.exit.localPort }, control)
        else control.close()
        maybeClose()
      }
    },
  })
  if (gathering) await gathering
  if (tap) {
    try {
      out.kernelDns = await kernelDnsFromTap(tap, { target, config, lease, lan: cap.lan, fetchImpl, secret })
    } catch (err) {
      out.kernelDns = { seen: false, reason: 'no-log', error: errorMessage(err) }
    } finally {
      tap.close()
    }
  }
  if (isIp(target)) out.dns = { skipped: true }
  else if (!out.dns) out.dns = { server: lease.dns[0] || '', ok: false, answers: [], ms: 0, error: result.error || 'no answer' }
  if (!out.entry) out.entry = { kind: 'unknown', reason: out.exit.error && /^dns:/.test(out.exit.error) ? 'not-connected' : 'no-connection', evidence: {} }
  if (result.error) out.exit.error = out.exit.error || result.error
  // 子进程既没报响应也没报错就退出了(被杀 / 崩溃):如实记成没有响应,不留 undefined
  if (out.exit.ok === undefined) { out.exit.ok = false; out.exit.error = out.exit.error || 'no response' }
  if (result.stderr) out.probeStderr = result.stderr.slice(0, 500)
  out.timing = { totalMs: Date.now() - started }
  return out
}

export const registerTerminalTestRoutes = (app, deps) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '16kb' }))
  const probe = deps.probe || lanProbe

  router.get('/terminal-test/capability', async (_req, res) => {
    try {
      const cap = await probe.probeCapability(deps.ctx)
      res.json({ ok: cap.ok, missing: cap.missing, lan: cap.lan })
    } catch (err) {
      res.status(500).json({ message: errorMessage(err) })
    }
  })

  router.post('/terminal-test', async (req, res) => {
    const target = String((req.body || {}).target || '').trim().toLowerCase()
    if (!isValidTarget(target)) return res.status(400).json({ message: 'target must be a domain or IP' })
    const bodyPort = Number((req.body || {}).port)
    try {
      res.json(await exclusive(() => runTerminalTest(deps, { target, port: bodyPort })))
    } catch (err) {
      res.status(500).json({ message: errorMessage(err) })
    }
  })

  app.use('/api/openbox', router)
}
