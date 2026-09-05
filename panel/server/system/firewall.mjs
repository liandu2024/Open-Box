import { serverFirewallProto } from '../engine/servers.mjs'

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
export const commitFirewall = async (ctx) => {
  await ctx.exec('uci', ['commit', 'firewall'])
  await ctx.exec('/etc/init.d/firewall', ['reload'])
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
  const desired = new Map(servers.map((s) => [
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
