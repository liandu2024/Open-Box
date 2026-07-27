import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { applyPanelLanRule, applyIpv6Block, removeOpenBoxRules } from './firewall.mjs'

const cmds = (ctx) => ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))

test('面板 LAN 规则:先删后建 + reload', async () => {
  const ctx = createMockContext()
  const r = await applyPanelLanRule(ctx, { port: 2026 })
  assert.equal(r.applied, true)
  const c = cmds(ctx)
  assert.equal(c[0], 'uci -q delete firewall.openbox_panel')
  assert.ok(c.includes('uci set firewall.openbox_panel=rule'))
  assert.ok(c.includes('uci set firewall.openbox_panel.src=lan'))
  assert.ok(c.includes('uci set firewall.openbox_panel.dest_port=2026'))
  assert.ok(c.includes('uci set firewall.openbox_panel.target=ACCEPT'))
  assert.ok(c.includes('uci commit firewall'))
  assert.ok(c.includes('/etc/init.d/firewall reload'))
})

test('IPv6 拦截开启建 REJECT 规则', async () => {
  const ctx = createMockContext()
  await applyIpv6Block(ctx, { enabled: true })
  const c = cmds(ctx)
  assert.ok(c.includes('uci set firewall.openbox_v6block=rule'))
  assert.ok(c.includes('uci set firewall.openbox_v6block.family=ipv6'))
  assert.ok(c.includes('uci set firewall.openbox_v6block.target=REJECT'))
})

test('IPv6 拦截关闭则删除规则', async () => {
  const ctx = createMockContext()
  await applyIpv6Block(ctx, { enabled: false })
  const c = cmds(ctx)
  assert.ok(c.includes('uci -q delete firewall.openbox_v6block'))
  assert.ok(!c.some((x) => x.includes('openbox_v6block=rule')))
})

test('removeOpenBoxRules 清两条 + reload', async () => {
  const ctx = createMockContext()
  const r = await removeOpenBoxRules(ctx)
  assert.equal(r.removed, true)
  const c = cmds(ctx)
  assert.ok(c.includes('uci -q delete firewall.openbox_panel'))
  assert.ok(c.includes('uci -q delete firewall.openbox_v6block'))
  assert.ok(c.includes('/etc/init.d/firewall reload'))
})
