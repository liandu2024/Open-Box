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

export const removeOpenBoxRules = async (ctx) => {
  await ctx.exec('uci', ['-q', 'delete', PANEL_RULE])
  await ctx.exec('uci', ['-q', 'delete', V6BLOCK_RULE])
  await commitReload(ctx)
  return { removed: true }
}
