import { serverFirewallProto, serverWanExposed } from '../engine/servers.mjs'

const PANEL_RULE = 'firewall.openbox_panel'
// 内核 DNS 入站 :7853,只放行 LAN(AdGuard Home / Pi-hole 等把上游指向路由器 IP:7853)
const DNS_RULE = 'firewall.openbox_dns'
const V6BLOCK_RULE = 'firewall.openbox_v6block'
// 共享网络每台服务器一条:firewall.openbox_srv_<id>
const SERVER_RULE_PREFIX = 'openbox_srv_'

// `/etc/init.d/firewall reload`(fw4)在规则多的路由器上一次要好几秒(正式路由器实测一次
// 部署 reload 四遍就是十几秒),而绝大多数部署防火墙这块根本没变。所以下面每条规则都按
// "目标状态"写:先读现在的样子,一样就一个字不动;真变了才 commit + reload。部署流程里
// 各条规则传 commit:false,最后由 deploy.mjs 看有没有任何一条变了,只 reload 一次。
// commit 和 reload 都要看退出码:闪存写满 commit 会静默失败,fw4 reload 失败规则就没生效——
// 以前两个都不看,部署照样报成功。
//
// 但 reload 的退出码判断不了"规则到底生效没有":fw4 会因为**别的软件包**留下的坏配置段
// 而以非 0 退出。网友实测:装了 passwall,它的 include 段带一个 fw4 不认的 option reload、
// 指向的 /var/etc/passwall.include 又不存在,fw4 一路 [!] 警告后 code 1,可我们的规则其实
// 已经在内核里了。这时候抛错的后果特别糟:启动被挡下来,紧接着的"恢复直连"回滚同样卡在
// 这一步,用户既起不来、也回不到直连。
// 所以非 0 时不直接下结论,改看结果:uci 里想要的那几条规则,是不是正好就是 nft 里此刻
// 生效的那几条(名字和端口都对得上)。对得上就只记一句警告继续走。
// uci 里此刻想要的规则:名字 → 端口(没有端口的规则是空串)
const wantedRules = async (ctx) => {
  const { code, stdout } = await ctx.exec('uci', ['show', 'firewall'])
  if (code !== 0) return null
  const bySection = new Map()
  for (const raw of String(stdout || '').split('\n')) {
    const m = raw.trim().match(/^firewall\.(openbox_[A-Za-z0-9_]+)\.(name|dest_port)='?([^']*)'?$/)
    if (!m) continue
    const entry = bySection.get(m[1]) || {}
    entry[m[2]] = m[3]
    bySection.set(m[1], entry)
  }
  const out = new Map()
  for (const entry of bySection.values()) if (entry.name) out.set(entry.name, entry.dest_port || '')
  return out
}

// nft 里此刻生效的我们的规则:名字 → 相关行拼起来的文本。fw4 把每条具名 rule 写成
// comment "!fw4: <name>";proto 写 "tcp udp" 会出两行,所以按名字把行拼起来再比端口。
// 读不到(没有 nft、或输出是空的)就返回 null:宁可按失败处理,也不要在看不见的情况下放行。
const liveRules = async (ctx) => {
  const { code, stdout } = await ctx.exec('nft', ['list', 'ruleset'])
  const text = String(stdout || '')
  if (code !== 0 || !text.trim()) return null
  const out = new Map()
  for (const raw of text.split('\n')) {
    const m = raw.match(/comment "!fw4: (Open-Box[^"]*)"/)
    if (m) out.set(m[1], `${out.get(m[1]) || ''} ${raw.trim()}`)
  }
  return out
}

// 名字要一一对上;有端口的还要在那条规则的文本里出现——只比名字的话,"改了端口但 reload
// 没成功"会被当成已生效(内核里还是旧端口,名字却没变)。
const rulesInEffect = (wanted, live) => {
  if (!wanted || !live || wanted.size !== live.size) return false
  for (const [name, port] of wanted) {
    const line = live.get(name)
    if (line === undefined) return false
    if (port && !new RegExp(`(^|[^0-9])${port.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9]|$)`).test(line)) return false
  }
  return true
}

export const commitFirewall = async (ctx) => {
  const commit = await ctx.exec('uci', ['commit', 'firewall'])
  if (commit.code !== 0) throw new Error(`uci commit firewall 失败(code ${commit.code}):${String(commit.stderr || commit.stdout || '').trim() || '闪存可能已写满'}`)
  const reload = await ctx.exec('/etc/init.d/firewall', ['reload'])
  if (reload.code === 0) return
  const detail = String(reload.stderr || reload.stdout || '').trim()
  const [wanted, live] = await Promise.all([wantedRules(ctx), liveRules(ctx)])
  if (rulesInEffect(wanted, live)) {
    console.warn(`[firewall] reload 报了 code ${reload.code},但规则已在内核里生效,继续:${detail}`)
    return
  }
  throw new Error(`firewall reload 失败(code ${reload.code}):${detail || '规则没有生效'}`)
}
const commitReload = commitFirewall

// 读一个具名段现在的样子:{ type, options } 或 null(没有这个段)
const readSection = async (ctx, section) => {
  const { code, stdout } = await ctx.exec('uci', ['-q', 'show', section])
  if (code !== 0) return null
  const out = { type: '', options: {} }
  for (const raw of String(stdout || '').split('\n')) {
    const line = raw.trim()
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq)
    let val = line.slice(eq + 1)
    if (val.length >= 2 && val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1)
    if (key === section) out.type = val
    else if (key.startsWith(`${section}.`)) out.options[key.slice(section.length + 1)] = val
  }
  return out.type ? out : null
}

// 把一个具名 rule 段调到目标状态。desired 为 null 表示不要这条;否则是它的选项表。
// 返回这次有没有真的改动 uci。删除总是发一次 `uci -q delete`(幂等、便宜),但只有段确实
// 存在过才算"变了"。
const ensureRule = async (ctx, section, desired) => {
  const current = await readSection(ctx, section)
  if (!desired) {
    await ctx.exec('uci', ['-q', 'delete', section])
    return current !== null
  }
  const same = current && current.type === 'rule'
    && Object.entries(desired).every(([k, v]) => current.options[k] === String(v))
  if (same) return false
  await ctx.exec('uci', ['-q', 'delete', section])
  await ctx.exec('uci', ['set', `${section}=rule`])
  for (const [k, v] of Object.entries(desired)) await ctx.exec('uci', ['set', `${section}.${k}=${v}`])
  return true
}

export const applyPanelLanRule = async (ctx, { port = 2026, commit = true } = {}) => {
  const changed = await ensureRule(ctx, PANEL_RULE, { name: 'Open-Box Panel (LAN)', src: 'lan', proto: 'tcp', dest_port: port, target: 'ACCEPT' })
  if (changed && commit) await commitReload(ctx)
  return { applied: true, changed }
}

export const applyDnsLanRule = async (ctx, { port = 7853, commit = true } = {}) => {
  const changed = await ensureRule(ctx, DNS_RULE, { name: 'Open-Box DNS (LAN)', src: 'lan', proto: 'tcp udp', dest_port: port, target: 'ACCEPT' })
  if (changed && commit) await commitReload(ctx)
  return { applied: true, changed }
}

export const applyIpv6Block = async (ctx, { enabled, commit = true }) => {
  const changed = await ensureRule(ctx, V6BLOCK_RULE, enabled
    ? { name: 'Open-Box Block IPv6 Leak', src: 'lan', dest: 'wan', family: 'ipv6', target: 'REJECT' }
    : null)
  if (changed && commit) await commitReload(ctx)
  return { applied: enabled === true, changed }
}

// 现有的共享网络放行规则(uci 里以 openbox_srv_ 开头的具名 rule 段)
export const listServerRules = async (ctx) => {
  const { code, stdout } = await ctx.exec('uci', ['show', 'firewall'])
  if (code !== 0) return []
  const names = new Set()
  for (const line of String(stdout || '').split('\n')) {
    const m = line.match(/^firewall\.(openbox_srv_[A-Za-z0-9_]+)=rule\s*$/)
    if (m) names.add(m[1])
  }
  return [...names]
}

const deleteServerRules = async (ctx) => {
  for (const name of await listServerRules(ctx)) await ctx.exec('uci', ['-q', 'delete', `firewall.${name}`])
}

// 共享网络:按当前启用的服务器对齐放行规则——多出来的删,缺的加,一样的不动。从 WAN 进来的
// 对应端口放行。id 只允许 [A-Za-z0-9_-],写进 uci 段名前把 - 换成 _。
export const applyServerPortRules = async (ctx, servers = [], { commit = true } = {}) => {
  // mixed(SOCKS5 + HTTP)只给局域网用,不放 WAN
  const desired = new Map(servers.filter(serverWanExposed).map((s) => [
    `${SERVER_RULE_PREFIX}${String(s.id).replace(/-/g, '_')}`,
    { name: `Open-Box Share ${s.name || s.id}`, src: 'wan', proto: serverFirewallProto(s), dest_port: s.port, target: 'ACCEPT' },
  ]))
  let changed = false
  for (const name of await listServerRules(ctx)) {
    if (desired.has(name)) continue
    await ctx.exec('uci', ['-q', 'delete', `firewall.${name}`])
    changed = true
  }
  for (const [name, rule] of desired) {
    if (await ensureRule(ctx, `firewall.${name}`, rule)) changed = true
  }
  if (changed && commit) await commitReload(ctx)
  return { applied: servers.length, changed }
}

// 仅移除代理相关规则(v6 拦截、共享网络放行),不动面板 LAN 放行——供 rollbackToDirect 使用。
// 回滚路径必须保留用户访问恢复界面的通道,否则一旦 LAN→路由器 input 策略非 ACCEPT,
// 用户在最需要面板时反而被彻底锁在门外。
export const removeProxyRules = async (ctx) => {
  await ctx.exec('uci', ['-q', 'delete', V6BLOCK_RULE])
  await ctx.exec('uci', ['-q', 'delete', DNS_RULE])
  await deleteServerRules(ctx)
  await commitReload(ctx)
  return { removed: true }
}

// 移除全部两条规则(含面板放行)——仅供卸载(P6)使用,不得用于回滚。
export const removeOpenBoxRules = async (ctx) => {
  await ctx.exec('uci', ['-q', 'delete', PANEL_RULE])
  await ctx.exec('uci', ['-q', 'delete', DNS_RULE])
  await ctx.exec('uci', ['-q', 'delete', V6BLOCK_RULE])
  await deleteServerRules(ctx)
  await commitReload(ctx)
  return { removed: true }
}
