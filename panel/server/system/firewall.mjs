import { serverFirewallProto } from '../engine/servers.mjs'

const PANEL_RULE = 'firewall.openbox_panel'
// 内核 DNS 入站 :7853,只放行 LAN(AdGuard Home / Pi-hole 等把上游指向路由器 IP:7853)
const DNS_RULE = 'firewall.openbox_dns'
const V6BLOCK_RULE = 'firewall.openbox_v6block'
// 共享网络每台服务器一条:firewall.openbox_srv_<id>
const SERVER_RULE_PREFIX = 'openbox_srv_'

const commitReload = async (ctx) => {
  await ctx.exec('uci', ['commit', 'firewall'])
  await ctx.exec('/etc/init.d/firewall', ['reload'])
}

export const applyPanelLanRule = async (ctx, { port = 2026 } = {}) => {
  await ctx.exec('uci', ['-q', 'delete', PANEL_RULE])
  await ctx.exec('uci', ['set', `${PANEL_RULE}=rule`])
  await ctx.exec('uci', ['set', `${PANEL_RULE}.name=Open-Box Panel (LAN)`])
  await ctx.exec('uci', ['set', `${PANEL_RULE}.src=lan`])
  await ctx.exec('uci', ['set', `${PANEL_RULE}.proto=tcp`])
  await ctx.exec('uci', ['set', `${PANEL_RULE}.dest_port=${port}`])
  await ctx.exec('uci', ['set', `${PANEL_RULE}.target=ACCEPT`])
  await commitReload(ctx)
  return { applied: true }
}

export const applyDnsLanRule = async (ctx, { port = 7853 } = {}) => {
  await ctx.exec('uci', ['-q', 'delete', DNS_RULE])
  await ctx.exec('uci', ['set', `${DNS_RULE}=rule`])
  await ctx.exec('uci', ['set', `${DNS_RULE}.name=Open-Box DNS (LAN)`])
  await ctx.exec('uci', ['set', `${DNS_RULE}.src=lan`])
  await ctx.exec('uci', ['set', `${DNS_RULE}.proto=tcp udp`])
  await ctx.exec('uci', ['set', `${DNS_RULE}.dest_port=${port}`])
  await ctx.exec('uci', ['set', `${DNS_RULE}.target=ACCEPT`])
  await commitReload(ctx)
  return { applied: true }
}

export const applyIpv6Block = async (ctx, { enabled }) => {
  await ctx.exec('uci', ['-q', 'delete', V6BLOCK_RULE])
  if (enabled) {
    await ctx.exec('uci', ['set', `${V6BLOCK_RULE}=rule`])
    await ctx.exec('uci', ['set', `${V6BLOCK_RULE}.name=Open-Box Block IPv6 Leak`])
    await ctx.exec('uci', ['set', `${V6BLOCK_RULE}.src=lan`])
    await ctx.exec('uci', ['set', `${V6BLOCK_RULE}.dest=wan`])
    await ctx.exec('uci', ['set', `${V6BLOCK_RULE}.family=ipv6`])
    await ctx.exec('uci', ['set', `${V6BLOCK_RULE}.target=REJECT`])
  }
  await commitReload(ctx)
  return { applied: enabled === true }
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

// 共享网络:按当前启用的服务器重建放行规则(先清光旧的,再逐条加),从 WAN 进来的
// 对应端口放行。id 只允许 [A-Za-z0-9_-],写进 uci 段名前把 - 换成 _。
export const applyServerPortRules = async (ctx, servers = []) => {
  await deleteServerRules(ctx)
  for (const s of servers) {
    const rule = `firewall.${SERVER_RULE_PREFIX}${String(s.id).replace(/-/g, '_')}`
    await ctx.exec('uci', ['set', `${rule}=rule`])
    await ctx.exec('uci', ['set', `${rule}.name=Open-Box Share ${s.name || s.id}`])
    await ctx.exec('uci', ['set', `${rule}.src=wan`])
    await ctx.exec('uci', ['set', `${rule}.proto=${serverFirewallProto(s)}`])
    await ctx.exec('uci', ['set', `${rule}.dest_port=${s.port}`])
    await ctx.exec('uci', ['set', `${rule}.target=ACCEPT`])
  }
  await commitReload(ctx)
  return { applied: servers.length }
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
