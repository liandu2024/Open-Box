import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { applyPanelLanRule, applyIpv6Block, removeProxyRules, removeOpenBoxRules } from './firewall.mjs'

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

test('removeProxyRules 只删 v6 拦截 + reload,不动面板放行规则(供回滚使用)', async () => {
  const ctx = createMockContext()
  const r = await removeProxyRules(ctx)
  assert.equal(r.removed, true)
  const c = cmds(ctx)
  assert.ok(c.includes('uci -q delete firewall.openbox_v6block'))
  assert.ok(!c.includes('uci -q delete firewall.openbox_panel'))
  assert.ok(c.includes('/etc/init.d/firewall reload'))
})

test('removeOpenBoxRules 清两条(含面板放行)+ reload,仅供卸载使用', async () => {
  const ctx = createMockContext()
  const r = await removeOpenBoxRules(ctx)
  assert.equal(r.removed, true)
  const c = cmds(ctx)
  assert.ok(c.includes('uci -q delete firewall.openbox_panel'))
  assert.ok(c.includes('uci -q delete firewall.openbox_v6block'))
  assert.ok(c.includes('/etc/init.d/firewall reload'))
})

test('共享网络放行:先清掉旧的 openbox_srv_*,再按启用的服务器逐条加,SS 放 tcp udp', async () => {
  const { applyServerPortRules, removeProxyRules } = await import('./firewall.mjs')
  const { createMockContext } = await import('./context.mjs')
  const ctx = createMockContext({ execResults: { 'uci show firewall': { code: 0, stdout: 'firewall.openbox_srv_old=rule\nfirewall.openbox_srv_old.name=x\nfirewall.@rule[0]=rule\n' } } })
  await applyServerPortRules(ctx, [
    { id: 'ab-1', name: 'SS', protocol: 'shadowsocks', port: 8388 },
    { id: 'hy', name: 'HY', protocol: 'hysteria2', port: 8446 },
  ])
  const cmds = ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))
  assert.ok(cmds.includes('uci -q delete firewall.openbox_srv_old'))
  assert.ok(cmds.includes('uci set firewall.openbox_srv_ab_1=rule'))
  assert.ok(cmds.includes('uci set firewall.openbox_srv_ab_1.proto=tcp udp'))
  assert.ok(cmds.includes('uci set firewall.openbox_srv_ab_1.dest_port=8388'))
  assert.ok(cmds.includes('uci set firewall.openbox_srv_hy.proto=udp'))
  assert.ok(cmds.includes('uci set firewall.openbox_srv_hy.src=wan'))
  assert.equal(cmds.filter((c) => c === 'uci commit firewall').length, 1)
  ctx.calls.length = 0
  await removeProxyRules(ctx)
  assert.ok(ctx.calls.map((c) => [c.cmd, ...c.args].join(' ')).includes('uci -q delete firewall.openbox_srv_old'))
})

test('applyDnsLanRule:只放行 LAN 到 7853 的 tcp/udp;removeProxyRules 会一起删掉', async () => {
  const { createMockContext } = await import('./context.mjs')
  const { applyDnsLanRule, removeProxyRules } = await import('./firewall.mjs')
  const ctx = createMockContext()
  await applyDnsLanRule(ctx, { port: 7853 })
  const sets = ctx.calls.filter((c) => c.cmd === 'uci' && c.args[0] === 'set').map((c) => c.args[1])
  assert.ok(sets.includes('firewall.openbox_dns.src=lan'))
  assert.ok(sets.includes('firewall.openbox_dns.proto=tcp udp'))
  assert.ok(sets.includes('firewall.openbox_dns.dest_port=7853'))
  assert.ok(sets.includes('firewall.openbox_dns.target=ACCEPT'))
  ctx.calls.length = 0
  await removeProxyRules(ctx)
  assert.ok(ctx.calls.some((c) => c.cmd === 'uci' && c.args.join(' ') === '-q delete firewall.openbox_dns'))
})
