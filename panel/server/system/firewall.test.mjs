import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { applyPanelLanRule, applyIpv6Block, commitFirewall, removeProxyRules, removeOpenBoxRules } from './firewall.mjs'

const cmds = (ctx) => ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))

test('面板 LAN 规则:先删后建 + reload', async () => {
  const ctx = createMockContext()
  const r = await applyPanelLanRule(ctx, { port: 2026 })
  assert.equal(r.applied, true)
  const c = cmds(ctx)
  assert.ok(c.includes('uci -q delete firewall.openbox_panel'))
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
    // mixed(SOCKS5 + HTTP)只给局域网用,不放 WAN
    { id: 'mx', name: 'MX', protocol: 'mixed', port: 7080 },
  ])
  const cmds = ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))
  assert.ok(!cmds.some((c) => c.includes('firewall.openbox_srv_mx')), cmds.join('\n'))
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

test('规则已经是目标状态:一个字不动、不 commit、不 reload;commit:false 时由调用方统一 reload 一次', async () => {
  const present = [
    "firewall.openbox_panel=rule",
    "firewall.openbox_panel.name='Open-Box Panel (LAN)'",
    "firewall.openbox_panel.src='lan'",
    "firewall.openbox_panel.proto='tcp'",
    "firewall.openbox_panel.dest_port='2026'",
    "firewall.openbox_panel.target='ACCEPT'",
  ].join('\n')
  const ctx = createMockContext({ execResults: { 'uci -q show firewall.openbox_panel': { code: 0, stdout: present } } })
  const r = await applyPanelLanRule(ctx, { port: 2026 })
  assert.equal(r.changed, false)
  const c = cmds(ctx)
  assert.ok(!c.some((x) => x.startsWith('uci set')), '不该写')
  assert.ok(!c.includes('uci commit firewall') && !c.includes('/etc/init.d/firewall reload'), '不该 commit / reload')

  // 端口换了才算变;commit:false 时自己不 reload
  ctx.calls.length = 0
  const r2 = await applyPanelLanRule(ctx, { port: 2027, commit: false })
  assert.equal(r2.changed, true)
  assert.ok(cmds(ctx).includes('uci set firewall.openbox_panel.dest_port=2027'))
  assert.ok(!cmds(ctx).includes('/etc/init.d/firewall reload'))
})

test('commitFirewall:uci commit / firewall reload 失败必须抛错,不能当成规则已生效', async () => {
  const commitFails = createMockContext({ execResults: { 'uci commit firewall': { code: 1, stderr: 'uci: I/O error' } } })
  await assert.rejects(() => applyPanelLanRule(commitFails, { port: 2026 }), /uci commit firewall 失败.*I\/O error/)
  const reloadFails = createMockContext({ execResults: { '/etc/init.d/firewall reload': { code: 1, stderr: 'fw4: syntax error' } } })
  await assert.rejects(() => removeProxyRules(reloadFails), /firewall reload 失败.*syntax error/)
})

// fw4 会因为别的软件包留下的坏配置段而以非 0 退出(网友实测:装了 passwall,它的 include
// 段指向的 /var/etc/passwall.include 不存在),可我们的规则其实已经生效了。这时候抛错会把
// 启动和紧接着的"恢复直连"回滚一起挡下来,用户既起不来也回不到直连。
const UCI_TWO_RULES = [
  'firewall.openbox_panel=rule',
  "firewall.openbox_panel.name='Open-Box Panel (LAN)'",
  "firewall.openbox_panel.dest_port='2026'",
  'firewall.openbox_dns=rule',
  "firewall.openbox_dns.name='Open-Box DNS (LAN)'",
  "firewall.openbox_dns.dest_port='7853'",
  // 别人的段不该被当成我们的
  'firewall.@rule[0]=rule',
  "firewall.@rule[0].name='Allow-DHCP'",
].join('\n')
const nftWith = (panelPort, { dns = true } = {}) => [
  `\ttcp dport ${panelPort} counter packets 3 bytes 180 accept comment "!fw4: Open-Box Panel (LAN)"`,
  ...(dns
    ? [
        '\ttcp dport 7853 counter packets 0 bytes 0 accept comment "!fw4: Open-Box DNS (LAN)"',
        '\tudp dport 7853 counter packets 0 bytes 0 accept comment "!fw4: Open-Box DNS (LAN)"',
      ]
    : []),
  '\tudp dport 67 counter packets 9 bytes 700 accept comment "!fw4: Allow-DHCP"',
].join('\n')
const PASSWALL_NOISE = [
  "[!] Section passwall option 'reload' is not supported by fw4",
  "[!] Section passwall specifies unreachable path '/var/etc/passwall.include', ignoring section",
].join('\n')
const reloadFailedCtx = (nft) => createMockContext({
  execResults: {
    '/etc/init.d/firewall reload': { code: 1, stderr: PASSWALL_NOISE },
    'uci show firewall': { code: 0, stdout: UCI_TWO_RULES },
    ...(nft === null ? {} : { 'nft list ruleset': { code: 0, stdout: nft } }),
  },
})

test('reload 报 code 1 但规则已在内核里生效(别的软件包的坏配置段):不抛错,继续走', async () => {
  await commitFirewall(reloadFailedCtx(nftWith(2026)))
})

test('reload 报 code 1 且规则确实没生效:照旧抛错', async () => {
  // 少了 DNS 那条 = 这次 reload 真的没落地
  await assert.rejects(
    () => commitFirewall(reloadFailedCtx(nftWith(2026, { dns: false }))),
    /firewall reload 失败.*passwall/s,
  )
  // 端口改了但内核里还是旧端口:只比名字会漏掉这种,必须连值一起比
  await assert.rejects(
    () => commitFirewall(reloadFailedCtx(nftWith(2025))),
    /firewall reload 失败/,
  )
  // 读不到 nft(没装 / 输出为空):看不见就按失败处理,不放行
  await assert.rejects(() => commitFirewall(reloadFailedCtx(null)), /firewall reload 失败/)
})
