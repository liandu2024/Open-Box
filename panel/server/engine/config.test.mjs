import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConfig } from './config.mjs'
import { createNode } from './node-model.mjs'

const nodes = [
  createNode({ tag: '美国-01', type: 'shadowsocks', server: 'a.com', server_port: 8388, fields: { method: 'aes-256-gcm', password: 'pw' }, source: 'clash' }),
  createNode({ tag: 'WG-01', type: 'wireguard', server: 'wg.com', server_port: 51820, fields: { private_key: 'p', peer_public_key: 'q', local_address: ['10.0.0.2/32'] }, source: 'clash' }),
]
const regionGroups = [{ name: '美国', type: 'urltest', nodeTags: ['美国-01'] }]
const profile = {
  ipv6: true,
  dns: { split: true, direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' },
  routing: { proxyTag: 'PROXY', categories: [], directRulesets: ['geosite-cn'], adBlock: false, fallback: 'PROXY' },
  rulesetDir: '/data/rulesets',
  clashApiSecret: 's3cr3t',
}

test('buildConfig 顶层结构', () => {
  const c = buildConfig({ nodes, regionGroups, profile })
  assert.equal(c.log.level, 'warn')
  assert.equal(c.inbounds[0].type, 'tun')
  assert.equal(c.inbounds[0].address.length, 2)                     // v4 + v6
  assert.equal(c.experimental.clash_api.external_controller, '127.0.0.1:9095')
  assert.equal(c.experimental.clash_api.secret, 's3cr3t')
  // wireguard 进 endpoints,不进 outbounds
  assert.ok(c.endpoints.some((e) => e.tag === 'WG-01'))
  assert.ok(!c.outbounds.some((o) => o.tag === 'WG-01'))
  // 内置直连(默认叫「直连」)+ 兜底「其他」selector + ss 节点
  assert.ok(c.outbounds.some((o) => o.tag === '直连' && o.type === 'direct'))
  assert.ok(c.outbounds.some((o) => o.tag === '其他' && o.type === 'selector'))
  assert.ok(!c.outbounds.some((o) => o.tag === 'PROXY' || o.tag === '美国'))
  assert.ok(c.outbounds.some((o) => o.tag === '美国-01' && o.type === 'shadowsocks'))
})

test('ipv6 关:tun address 仅 v4', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: false } })
  assert.equal(c.inbounds[0].address.length, 1)
  assert.equal(c.dns.strategy, 'ipv4_only')
})

test('每条策略生成一个同名 selector,成员是「出站」页签选中的那几类', () => {
  const c = buildConfig({
    nodes,
    regionGroups,
    userGroups: [{ id: 'g', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: [] }],
    profile: {
      ...profile,
      routing: {
        proxyTag: 'PROXY',
        regionMode: 'CN',
        policies: [{ id: 'p1', name: '谷歌', rulesets: ['geosite-google'], default: '香港-自动' }],
      },
    },
  })
  const sel = c.outbounds.find((o) => o.tag === '谷歌')
  assert.deepEqual(sel, {
    type: 'selector',
    tag: '谷歌',
    // 按「节点管理」的顺序:内置直连 → 用户组 → 内置拒绝
    outbounds: ['直连', '香港-自动', '拒绝'],
    default: '香港-自动',
  })
  assert.ok(c.outbounds.some((o) => o.type === 'block' && o.tag === '拒绝'), '拒绝出站要在')
  const rule = c.route.rules.find((r) => r.outbound === '谷歌')
  assert.deepEqual(rule.rule_set, ['geosite-google'])
})

test('站点集的 default 不在成员表里时落到第一个成员,而不是写一个内核找不到的名字', () => {
  const c = buildConfig({
    nodes,
    regionGroups,
    profile: {
      ...profile,
      routing: {
        regionMode: 'CN',
        policies: [{ id: 'p1', name: '谷歌', rulesets: ['geosite-google'], default: '并不存在的组' }],
      },
    },
  })
  const sel = c.outbounds.find((o) => o.tag === '谷歌')
  assert.equal(sel.default, sel.outbounds[0])
})

test('「节点管理」里停用拒绝:配置里不生成 block 出站,站点集里也选不到', () => {
  const c = buildConfig({
    nodes,
    regionGroups,
    userGroups: [{ id: 'builtin-block', name: '拒绝', enabled: false }],
    profile: {
      ...profile,
      routing: {
        regionMode: 'CN',
        policies: [{ id: 'p1', name: '谷歌', rulesets: ['geosite-google'] }],
      },
    },
  })
  assert.ok(!c.outbounds.some((o) => o.type === 'block'))
  assert.deepEqual(c.outbounds.find((o) => o.tag === '谷歌').outbounds, ['直连'])
})

test('内置直连改名后,内网直连规则和空组占位都跟着新名字', () => {
  const c = buildConfig({
    nodes,
    regionGroups,
    userGroups: [
      { id: 'builtin-direct', name: '国内直出' },
      { id: 'e', name: '空组', type: 'selector', mode: 'static', members: [] },
    ],
    profile: { ...profile, routing: { policies: [] } },
  })
  assert.ok(c.outbounds.some((o) => o.type === 'direct' && o.tag === '国内直出'))
  assert.ok(!c.outbounds.some((o) => o.tag === 'direct'))
  assert.deepEqual(c.route.rules.find((r) => r.ip_is_private), { ip_is_private: true, outbound: '国内直出' })
  assert.deepEqual(c.outbounds.find((o) => o.tag === '空组').outbounds, ['国内直出'])
})

test('tun:私网 / 链路本地 / 组播目标排除在 TUN 之外(ipv6 开时含 v6 范围),UDP 会话 60 秒超时', () => {
  const c4 = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: false } })
  assert.deepEqual(c4.inbounds[0].route_exclude_address, ['10.0.0.0/8', '100.64.0.0/10', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '224.0.0.0/4'])
  assert.equal(c4.inbounds[0].udp_timeout, '60s')
  const c6 = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: true } })
  assert.ok(c6.inbounds[0].route_exclude_address.includes('fc00::/7'))
  assert.ok(c6.inbounds[0].route_exclude_address.includes('fe80::/10'))
})

test('tun.autoRedirect 默认关闭,可开启', () => {
  const c1 = buildConfig({ nodes, regionGroups, profile })
  assert.equal(c1.inbounds[0].auto_redirect, undefined)
  const c2 = buildConfig({ nodes, regionGroups, profile: { ...profile, tun: { autoRedirect: true } } })
  assert.equal(c2.inbounds[0].auto_redirect, true)
})

test('dns.mode=hijack(默认)生成 hijack-dns 路由规则', () => {
  const c = buildConfig({ nodes, regionGroups, profile })
  assert.ok(c.route.rules.some((r) => r.action === 'hijack-dns'))
  assert.ok(!c.inbounds.some((i) => i.type === 'direct'))
})

test('dns.mode=off:不劫持 DNS、没有 dns-in,且即使开了 tun.autoRedirect 也不写 auto_redirect(它自带 DNS 劫持)', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, tun: { autoRedirect: true }, dns: { ...profile.dns, mode: 'off' } } })
  assert.ok(!c.route.rules.some((r) => r.action === 'hijack-dns'))
  assert.ok(!c.inbounds.some((i) => i.type === 'direct'))
  assert.equal(c.inbounds[0].auto_redirect, undefined)
  assert.equal(c.inbounds[0].auto_route, true)
  assert.ok(!c.outbounds.some((o) => o.tag === 'dnsmasq'))
})

test('dns.mode=dnsmasq: hijack 规则仅限 dns-in 入站(不自环),增 DNS 入站 127.0.0.1:7853', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, dns: { ...profile.dns, mode: 'dnsmasq' } } })
  const hijack = c.route.rules.find((r) => r.action === 'hijack-dns')
  assert.ok(hijack)
  assert.deepEqual(hijack.inbound, ['dns-in'])
  assert.ok(!hijack.protocol)
  const dnsIn = c.inbounds.find((i) => i.type === 'direct')
  assert.equal(dnsIn.listen, '127.0.0.1')
  assert.equal(dnsIn.listen_port, 7853)
})

test('directForNodes 默认开:节点服务器和订阅主机名生成直连规则与本地解析规则;关掉就没有', async () => {
  const { collectDirectHosts } = await import('./direct-hosts.mjs')
  const hosts = collectDirectHosts(
    [{ tag: 'a', type: 'shadowsocks', server: 'node.example.com' }, { tag: 'b', type: 'shadowsocks', server: '5.6.7.8' }],
    [{ url: 'https://sub.example.com/x?token=1' }, { url: '' }],
  )
  assert.deepEqual(hosts, { domains: ['node.example.com', 'sub.example.com'], cidrs: ['5.6.7.8/32'] })
})

test('防回环:目标是 tun 自己网段的连接直接拒绝,且排在 ip_is_private 之前', () => {
  const c = buildConfig({ nodes, regionGroups, profile })
  const i = c.route.rules.findIndex((r) => Array.isArray(r.ip_cidr) && r.action === 'reject')
  const j = c.route.rules.findIndex((r) => r.ip_is_private)
  assert.ok(i >= 0 && j >= 0 && i < j, `reject=${i} ip_is_private=${j}`)
  assert.ok(c.route.rules[i].ip_cidr.includes('172.19.0.0/30'))
  const v6 = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: true } })
  const r6 = v6.route.rules.find((r) => Array.isArray(r.ip_cidr) && r.action === 'reject')
  assert.deepEqual(r6.ip_cidr, ['172.19.0.0/30', 'fdfe:dcba:9876::/126'])
})

test('dnsmasq 模式:多一个绑定 lo 的 dnsmasq 专用直连出站,局域网 DNS 回交规则指向它;hijack 模式没有', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, dns: { ...profile.dns, mode: 'dnsmasq' } } })
  const ob = c.outbounds.find((o) => o.tag === 'dnsmasq')
  assert.deepEqual(ob, { type: 'direct', tag: 'dnsmasq', bind_interface: 'lo' })
  const back = c.route.rules.findIndex((r) => r.override_address === '127.0.0.1')
  const reject = c.route.rules.findIndex((r) => Array.isArray(r.ip_cidr) && r.action === 'reject')
  assert.ok(back >= 0 && back < reject, `back=${back} reject=${reject}`)
  assert.equal(c.route.rules[back].outbound, 'dnsmasq')
  const h = buildConfig({ nodes, regionGroups, profile })
  assert.ok(!h.outbounds.some((o) => o.tag === 'dnsmasq'))
  assert.ok(!h.route.rules.some((r) => r.override_address))
})
