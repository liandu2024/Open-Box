const PANEL_RULE = 'firewall.openbox_panel'
const V6BLOCK_RULE = 'firewall.openbox_v6block'

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

// 仅移除代理相关规则(v6 拦截),不动面板 LAN 放行——供 rollbackToDirect 使用。
// 回滚路径必须保留用户访问恢复界面的通道,否则一旦 LAN→路由器 input 策略非 ACCEPT,
// 用户在最需要面板时反而被彻底锁在门外。
export const removeProxyRules = async (ctx) => {
  await ctx.exec('uci', ['-q', 'delete', V6BLOCK_RULE])
  await commitReload(ctx)
  return { removed: true }
}

// 移除全部两条规则(含面板放行)——仅供卸载(P6)使用,不得用于回滚。
export const removeOpenBoxRules = async (ctx) => {
  await ctx.exec('uci', ['-q', 'delete', PANEL_RULE])
  await ctx.exec('uci', ['-q', 'delete', V6BLOCK_RULE])
  await commitReload(ctx)
  return { removed: true }
}
