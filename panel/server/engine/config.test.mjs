import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConfig } from './config.mjs'
import { createNode } from './node-model.mjs'
import { cidrContains } from '../system/local-subnets.mjs'

const nodes = [
  createNode({ tag: '美国-01', type: 'shadowsocks', server: 'a.com', server_port: 8388, fields: { method: 'aes-256-gcm', password: 'pw' }, source: 'clash' }),
  createNode({ tag: 'WG-01', type: 'wireguard', server: 'wg.com', server_port: 51820, fields: { private_key: 'p', peer_public_key: 'q', local_address: ['10.0.0.2/32'] }, source: 'clash' }),
]
const regionGroups = [{ name: '美国', type: 'urltest', nodeTags: ['美国-01'] }]
const profile = {
  ipv6: true,
  dns: { split: true, direct: '223.5.5.5', proxy: '1.1.1.1' },
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

test('tun:私网 / 链路本地 / 组播目标排除在 TUN 之外(ipv6 开时含 v6 范围),UDP 会话 60 秒超时', async () => {
  const c4 = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: false } })
  const ex4 = c4.inbounds[0].route_exclude_address
  for (const p of ['10.0.0.0/8', '100.64.0.0/10', '169.254.0.0/16', '192.168.0.0/16', '224.0.0.0/4']) assert.ok(ex4.includes(p), p)
  // 没读到接口网段时(内核停着、tun0 不存在),tun 自己的网段也必须挖出来,不能整段排除 172.16/12
  assert.ok(!ex4.includes('172.16.0.0/12'))
  assert.ok(ex4.includes('172.16.0.0/15') && ex4.includes('172.19.0.4/30'))
  assert.equal(c4.inbounds[0].udp_timeout, '60s')
  const c6 = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: true } })
  const ex6 = c6.inbounds[0].route_exclude_address
  assert.ok(!ex6.includes('fc00::/7'), 'fc00::/7 要挖掉 tun 的 v6 网段')
  assert.ok(ex6.includes('fe80::/10'))
  const { cidrContains } = await import('../system/local-subnets.mjs')
  assert.ok(!ex6.some((x) => cidrContains(x, 'fdfe:dcba:9876::2')))
  assert.ok(ex6.some((x) => cidrContains(x, 'fd00::1')))
})

test('tun:本机接口网段从私网排除表里挖出来,局域网发给路由器的 DNS 仍会被劫持进内核', async () => {
  const { cidrContains } = await import('../system/local-subnets.mjs')
  // 有 auto_redirect 才挖本机网段(见下一条用例)
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: false, tun: { autoRedirect: true } }, localSubnets: ['192.168.3.0/24', '172.17.0.0/16', '172.19.0.0/30'] })
  const ex = c.inbounds[0].route_exclude_address
  assert.ok(!ex.some((x) => cidrContains(x, '192.168.3.1')), '路由器自己的 LAN 网段不能被排除')
  assert.ok(!ex.some((x) => cidrContains(x, '172.19.0.2')), 'tun 网关不能被排除')
  assert.ok(ex.some((x) => cidrContains(x, '10.0.0.9')), '其它私网仍然排除')
  assert.ok(ex.some((x) => cidrContains(x, '192.168.9.9')), '同属 192.168/16 但不是本机网段的仍然排除')
})

test('tun:没有 auto_redirect(禁用模式 / 关掉 autoRedirect)时本机接口网段必须整段排除,否则路由器回包被吞、整机失联', async () => {
  const { cidrContains } = await import('../system/local-subnets.mjs')
  const subnets = ['192.168.3.0/24', '172.17.0.0/16', '172.19.0.0/30']
  const off = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: false, tun: { autoRedirect: true }, dns: { ...profile.dns, mode: 'off' } }, localSubnets: subnets })
  assert.equal(off.inbounds[0].auto_redirect, undefined)
  assert.ok(off.inbounds[0].route_exclude_address.some((x) => cidrContains(x, '192.168.3.1')), '禁用模式:LAN 网段要在排除表里')
  assert.ok(!off.inbounds[0].route_exclude_address.some((x) => cidrContains(x, '172.19.0.2')), 'tun 网关永远挖出来')
  const noRedirect = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: false, tun: { autoRedirect: false } }, localSubnets: subnets })
  assert.ok(noRedirect.inbounds[0].route_exclude_address.some((x) => cidrContains(x, '192.168.3.1')), '关掉 autoRedirect 同理')
  const hijack = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: false, tun: { autoRedirect: true } }, localSubnets: subnets })
  assert.equal(hijack.inbounds[0].auto_redirect, true)
  assert.ok(!hijack.inbounds[0].route_exclude_address.some((x) => cidrContains(x, '192.168.3.1')), '有 auto_redirect 才挖本机网段')
})

test('tun.autoRedirect 默认关闭,可开启', () => {
  const c1 = buildConfig({ nodes, regionGroups, profile })
  assert.equal(c1.inbounds[0].auto_redirect, undefined)
  const c2 = buildConfig({ nodes, regionGroups, profile: { ...profile, tun: { autoRedirect: true } } })
  assert.equal(c2.inbounds[0].auto_redirect, true)
})

test('dns.mode=hijack(默认)生成全局 hijack-dns 路由规则;dns-in 入站三种模式都有且监听所有地址', () => {
  const c = buildConfig({ nodes, regionGroups, profile })
  assert.ok(c.route.rules.some((r) => r.action === 'hijack-dns' && r.protocol === 'dns'))
  const dnsIn = c.inbounds.find((i) => i.tag === 'dns-in')
  assert.deepEqual(dnsIn, { type: 'direct', tag: 'dns-in', listen: '::', listen_port: 7853 })
})

test('dns.mode=off:不改写任何 DNS(只劫持 dns-in 自己收到的查询),保留 dns-in 入站,且即使开了 tun.autoRedirect 也不写 auto_redirect', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, tun: { autoRedirect: true }, dns: { ...profile.dns, mode: 'off' } } })
  const hijacks = c.route.rules.filter((r) => r.action === 'hijack-dns')
  assert.deepEqual(hijacks, [{ inbound: ['dns-in'], action: 'hijack-dns' }])
  assert.ok(c.inbounds.some((i) => i.tag === 'dns-in' && ['0.0.0.0', '::'].includes(i.listen)))
  assert.equal(c.inbounds[0].auto_redirect, undefined)
  assert.equal(c.inbounds[0].auto_route, true)
  assert.ok(!c.outbounds.some((o) => o.tag === 'dnsmasq'))
})

test('dns.mode=dnsmasq: hijack 规则仅限 dns-in 入站(不自环),DNS 入站监听 :7853(开 v6 时双栈)', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, dns: { ...profile.dns, mode: 'dnsmasq' } } })
  const hijack = c.route.rules.find((r) => r.action === 'hijack-dns')
  assert.ok(hijack)
  assert.deepEqual(hijack.inbound, ['dns-in'])
  assert.ok(!hijack.protocol)
  const dnsIn = c.inbounds.find((i) => i.type === 'direct')
  assert.ok(['0.0.0.0', '::'].includes(dnsIn.listen))
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

test('订阅有多个地址时每个地址的主机名都直连;老记录只有 url 也照旧', async () => {
  const { collectDirectHosts } = await import('./direct-hosts.mjs')
  const hosts = collectDirectHosts([], [
    { url: 'https://a.example.com/x', urls: ['https://a.example.com/x', 'https://b.example.com/y'] },
    { url: 'https://old.example.com/z' },
  ])
  assert.deepEqual(hosts.domains, ['a.example.com', 'b.example.com', 'old.example.com'])
})

test('directHostCidrs:部署时解析出来的节点 IP 并进直连规则的 ip_cidr(去重),关掉直连开关就不生成', () => {
  const c = buildConfig({ nodes, regionGroups, profile, directHostCidrs: ['38.47.107.167/32', '38.47.107.167/32', '2001:db8::5/128'] })
  const rule = c.route.rules.find((r) => r.outbound === '直连' && Array.isArray(r.domain))
  assert.ok(rule, '应有节点站点直连规则')
  assert.ok(rule.ip_cidr.includes('38.47.107.167/32'))
  assert.equal(rule.ip_cidr.filter((x) => x === '38.47.107.167/32').length, 1)
  const off = buildConfig({ nodes, regionGroups, profile: { ...profile, directForNodes: false }, directHostCidrs: ['38.47.107.167/32'] })
  assert.ok(!off.route.rules.some((r) => Array.isArray(r.ip_cidr) && r.ip_cidr.includes('38.47.107.167/32')))
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

test('出站 tag 撞名 → 生成配置时直接报人话,而不是让内核 duplicate tag FATAL', () => {
  // 两个节点同名(订阅层的去重被绕过 / 手工导入),或站点集 / 节点组和节点同名,都是同一条闸
  const twin = createNode({ tag: '美国-01', type: 'shadowsocks', server: 'b.com', server_port: 8388, fields: { method: 'aes-256-gcm', password: 'pw' }, source: 'clash' })
  assert.throws(() => buildConfig({ nodes: [...nodes, twin], regionGroups, profile }), /出站名称重复:「美国-01」/)
  const policyClash = { ...profile, routing: { ...profile.routing, policies: [{ name: '美国-01', domainSuffix: ['x.com'] }] } }
  assert.throws(() => buildConfig({ nodes, regionGroups, profile: policyClash }), /出站名称重复:「美国-01」/)
})

test('dns-in 监听地址:开 IPv6 双栈 ::(AdGuard 用路由器 v6 地址当上游也到得了),关 IPv6 只监听 0.0.0.0', () => {
  const on = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: true } }).inbounds.find((i) => i.tag === 'dns-in')
  const off = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: false } }).inbounds.find((i) => i.tag === 'dns-in')
  assert.equal(on.listen, '::')
  assert.equal(off.listen, '0.0.0.0')
})

test('回归:任何 DNS 规则都不引用含 IP 的规则集(geoip-* / 规则集链接的 -ip 那份),路由规则照旧两边都引用', () => {
  const tag = 'list-' + (() => { let h = 0x811c9dc5; for (const ch of 'https://x.test/Check.list') { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') })()
  const c = buildConfig({
    nodes,
    regionGroups,
    userGroups: [{ id: 'g', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: [] }],
    ruleLists: { [tag]: { domain: true, ip: true } },
    profile: {
      ...profile,
      routing: {
        proxyTag: 'PROXY',
        regionMode: 'CN',
        policies: [
          { id: 'p1', name: 'Netflix', rulesets: ['geosite-netflix', 'geoip-netflix'], default: '香港-自动' },
          { id: 'p2', name: 'Speed', ruleUrls: ['https://x.test/Check.list'], default: '香港-自动' },
          { id: 'p3', name: '国内', rulesets: ['geosite-cn', 'geoip-cn'], default: '直连' },
        ],
      },
    },
  })
  const dnsTags = c.dns.rules.flatMap((r) => [].concat(r.rule_set || []))
  assert.ok(dnsTags.length > 0)
  assert.ok(dnsTags.every((t) => !t.startsWith('geoip-') && !t.endsWith('-ip')), `DNS 规则里混进了含 IP 的规则集:${dnsTags.join(',')}`)
  assert.deepEqual(c.route.rules.find((r) => r.outbound === 'Netflix').rule_set, ['geosite-netflix', 'geoip-netflix'])
  assert.deepEqual(c.route.rules.find((r) => r.outbound === 'Speed').rule_set, [tag, `${tag}-ip`])
  assert.deepEqual(c.dns.rules.find((r) => r.server === 'dns-direct' && r.rule_set)?.rule_set, ['geosite-cn'])
})

// ---------- 第一层整改:入口排除表与原生旁路 ----------
const subnets = ['192.168.1.0/24']
const firstLayerGroups = [{ id: 'g', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: [] }]
const firstLayerProfile = (over = {}) => ({
  ...profile,
  ipv6: true,
  dns: { split: true, mode: 'dnsmasq', direct: '223.5.5.5', proxy: '1.1.1.1' },
  tun: { autoRedirect: true },
  routing: { fallbackDefault: 'direct', policies: [{ id: 'cn', name: '国内', default: 'direct', rulesets: ['geoip-cn', 'geosite-cn'] }] },
  ...over,
})

test('前置自定义分流把私网段送去节点时,这段要从入口排除表里挖出来,否则永远到不了那条规则(审核 B5)', () => {
  const c = buildConfig({
    nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets,
    profile: firstLayerProfile({ routing: { fallbackDefault: 'direct', policies: [], custom: { rules: [
      { type: 'ipCidr', value: '10.77.0.0/16', outbound: '香港-自动' },
      { type: 'ipCidr', value: 'fd77::/48', outbound: '香港-自动' },
      { type: 'ipCidr', value: '10.88.0.0/16', outbound: 'direct' },          // 直连的不用挖
      { type: 'ipCidr', value: '10.99.0.0/16', outbound: '不存在的出口' },     // 规则本身会被丢掉,也不挖
    ] } } }),
  })
  const ex = c.inbounds[0].route_exclude_address
  assert.ok(!ex.some((x) => cidrContains(x, '10.77.0.1')), '10.77.0.0/16 要挖出来')
  assert.ok(!ex.some((x) => cidrContains(x, 'fd77::1')), 'fd77::/48 要挖出来')
  assert.ok(ex.some((x) => cidrContains(x, '10.88.0.1')), '直连的私网段照旧排除')
  assert.ok(ex.some((x) => cidrContains(x, '10.99.0.1')), '出口不存在的不挖')
  assert.ok(ex.some((x) => cidrContains(x, '10.1.0.1')), '别的 10/8 仍然排除')
  assert.ok(c.route.rules.some((r) => r.ip_cidr && r.ip_cidr[0] === '10.77.0.0/16' && r.outbound === '香港-自动'))
})

test('dnsmasq 转发模式不再把本机网段挖出排除表:局域网发给路由器的 DNS 在入口就 return,不进内核绕一圈(审核 A2);劫持模式照旧要挖', () => {
  const dnsmasq = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile() })
  assert.equal(dnsmasq.inbounds[0].auto_redirect, true)
  assert.ok(dnsmasq.inbounds[0].route_exclude_address.some((x) => cidrContains(x, '192.168.1.1')), 'dnsmasq 模式:本机网段留在排除表里')
  const hijack = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile({ dns: { split: true, mode: 'hijack', direct: '223.5.5.5', proxy: '1.1.1.1' } }) })
  assert.ok(!hijack.inbounds[0].route_exclude_address.some((x) => cidrContains(x, '192.168.1.1')), '劫持模式:要挖,DNS 改写规则才碰得到发给路由器的查询')
  // tun 自己的网段两种模式都挖
  for (const c of [dnsmasq, hijack]) assert.ok(!c.inbounds[0].route_exclude_address.some((x) => cidrContains(x, '172.19.0.2')))
})

test('原生旁路:走直连的站点集里的 geoip 集合写进 route_exclude_address_set,并且那个集合在 route.rule_set 里登记过;条件不满足就不写(审核 A1)', () => {
  const on = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile() })
  assert.deepEqual(on.inbounds[0].route_exclude_address_set, ['geoip-cn'])
  assert.ok(on.route.rule_set.some((r) => r.tag === 'geoip-cn'))
  // 有前置自定义分流 → 不写
  const custom = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile({ routing: { ...firstLayerProfile().routing, custom: { rules: [{ type: 'domainSuffix', value: 'a.cn', outbound: '美国' }] } } }) })
  assert.equal(custom.inbounds[0].route_exclude_address_set, undefined)
  // 走代理的终端分流 → 不写;指向直连(终端分流存的是真实出站名)的不妨碍
  const cr = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile({ clientRoutes: [{ id: 'a', name: 'a', sources: ['192.168.1.9'], outbound: '香港-自动' }] }) })
  assert.equal(cr.inbounds[0].route_exclude_address_set, undefined)
  const crDirect = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile({ clientRoutes: [{ id: 'a', name: 'a', sources: ['192.168.1.9'], outbound: '直连' }] }) })
  assert.deepEqual(crDirect.inbounds[0].route_exclude_address_set, ['geoip-cn'])
  // 代理页把「国内」切到代理(selections)→ 不写
  const flipped = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile(), selections: { '国内': '香港-自动' } })
  assert.equal(flipped.inbounds[0].route_exclude_address_set, undefined)
})

test('例外挖洞永远不挖本机网段 / tun / 回环 / 链路本地:10.0.0.0/8 → 节点 时 LAN 10.0.0.0/24 仍在排除表里,纯 tun 模式管理通道不断(复审 R6a)', () => {
  for (const autoRedirect of [false, true]) {
    const c = buildConfig({
      nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: ['10.0.0.0/24'],
      profile: firstLayerProfile({ tun: { autoRedirect }, routing: { fallbackDefault: 'direct', policies: [], custom: { rules: [{ type: 'ipCidr', value: '10.0.0.0/8', outbound: '香港-自动' }] } } }),
    })
    const ex = c.inbounds[0].route_exclude_address
    assert.ok(ex.some((x) => cidrContains(x, '10.0.0.209')), `autoRedirect=${autoRedirect}:LAN 里的终端必须还在排除表里`)
    assert.ok(ex.some((x) => cidrContains(x, '172.19.0.2')) === false, 'tun 网段照旧挖出来(内核自己要用)')
    assert.ok(!ex.some((x) => cidrContains(x, '10.77.0.1')), '10/8 里 LAN 之外的部分才挖出来送节点')
    assert.ok(c.route.rules.some((r) => r.ip_cidr && r.ip_cidr[0] === '10.0.0.0/8'))
  }
})

test('例外规则比排除段还大(10.0.0.0/7 盖住 10/8)也要挖:看的是有没有交集,不是谁包含谁(复审 R6b)', () => {
  const c = buildConfig({
    nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: ['192.168.3.0/24'],
    profile: firstLayerProfile({ routing: { fallbackDefault: 'direct', policies: [], custom: { rules: [{ type: 'ipCidr', value: '10.0.0.0/7', outbound: '香港-自动' }] } } }),
  })
  const ex = c.inbounds[0].route_exclude_address
  assert.ok(!ex.some((x) => cidrContains(x, '10.77.0.1')))
  assert.ok(ex.some((x) => cidrContains(x, '192.168.3.9')), 'LAN 照旧排除')
  assert.ok(ex.some((x) => cidrContains(x, '172.20.0.1')), '别的私网段照旧排除')
})

test('FakeIP 原型:cache_file 存占位映射;开了 IPv6 时把 fc00::/18 从 tun 排除表挖出来;部署给的旁路结论优先于纯函数(第三轮 阶段 3)', () => {
  const on = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile({ dns: { split: true, mode: 'dnsmasq', direct: '223.5.5.5', proxy: '1.1.1.1', fakeIpForProxy: true } }) })
  assert.equal(on.experimental.cache_file.store_fakeip, true)
  assert.ok(on.dns.servers.some((s) => s.type === 'fakeip'))
  const ex6 = on.inbounds[0].route_exclude_address
  assert.ok(!ex6.some((x) => cidrContains(x, 'fc00::1')), 'v6 占位段要挖出来,不然走代理域名的 v6 连接在入口就被放走')
  assert.ok(ex6.some((x) => cidrContains(x, 'fd00::1')), 'fc00::/7 剩下的部分还在排除表里')
  const off = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile() })
  assert.equal(off.experimental.cache_file.store_fakeip, false)
  assert.ok(off.inbounds[0].route_exclude_address.some((x) => cidrContains(x, 'fc00::1')))
  // 部署时带来的结论(做过重叠核对)直接用;空集合就不写字段
  const given = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile(), nativeBypass: { enabled: true, sets: ['geoip-cn', 'geoip-hk'], reason: '' } })
  assert.deepEqual(given.inbounds[0].route_exclude_address_set, ['geoip-cn', 'geoip-hk'])
  const none = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile(), nativeBypass: { enabled: false, sets: [], reason: 'x' } })
  assert.equal(none.inbounds[0].route_exclude_address_set, undefined)
})

test('IPv6 分层(第三轮 阶段 5):ipv6 开 + ipv6Proxy=ipv4 时按此刻的选择给代理出口插 v6 拒绝、DNS 代理规则只解析 A;站点集切到直连就不插;老开关语义不变', () => {
  const p = (over = {}) => firstLayerProfile({
    ipv6: true, ipv6Proxy: 'ipv4',
    routing: { fallbackDefault: 'direct', policies: [
      { id: 'g', name: 'Google', default: '香港-自动', rulesets: ['geosite-google', 'geoip-google'] },
      { id: 'cn', name: '国内', default: 'direct', rulesets: ['geoip-cn', 'geosite-cn'] },
    ] },
    ...over,
  })
  const split = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p() })
  const g = split.route.rules.findIndex((r) => r.outbound === 'Google')
  assert.deepEqual(split.route.rules[g - 1], { rule_set: ['geosite-google', 'geoip-google'], ip_version: 6, action: 'reject' })
  assert.ok(!split.route.rules.some((r) => r.ip_version === 6 && r.rule_set && r.rule_set.includes('geoip-cn')), '直连站点集前不插')
  assert.ok(!split.route.rules.some((r) => r.ip_version === 6 && !r.rule_set), '兜底直连:没有裸 v6 拒绝')
  assert.deepEqual(split.dns.rules.find((r) => r.server === 'dns-policy-0'), { server: 'dns-policy-0', rule_set: ['geosite-google'], strategy: 'ipv4_only' })
  assert.equal(split.dns.strategy, 'prefer_ipv4')
  assert.ok(split.inbounds[0].address.some((a) => a.includes(':')), 'tun 仍有 v6 地址:直连 v6 照常走')
  // 代理页把 Google 切到直连:不再插;把「国内」切到代理:插
  const flipped = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p(), selections: { Google: '直连', 国内: '香港-自动' } })
  assert.ok(!flipped.route.rules.some((r) => r.ip_version === 6 && r.rule_set && r.rule_set.includes('geosite-google')))
  assert.ok(flipped.route.rules.some((r) => r.ip_version === 6 && r.rule_set && r.rule_set.includes('geoip-cn')))
  // 兜底走代理:收尾裸 v6 拒绝
  const fb = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p({ routing: { ...p().routing, fallbackDefault: 'proxy' } }) })
  assert.deepEqual(fb.route.rules.at(-1), { ip_version: 6, action: 'reject' })
  // node(老"开启")/ ipv6 关(老"关闭"):一条 ip_version 都没有;关着仍是 ipv4_only + 无 v6 地址
  const node = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p({ ipv6Proxy: 'node' }) })
  assert.ok(!node.route.rules.some((r) => r.ip_version))
  const off = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p({ ipv6: false }) })
  assert.ok(!off.route.rules.some((r) => r.ip_version))
  assert.equal(off.dns.strategy, 'ipv4_only')
  assert.ok(!off.inbounds[0].address.some((a) => a.includes(':')))
})

test('tun 的 v6 排除表(第四轮 T6):组播 ff00::/8 全段照排,auto_redirect 下只把全 1 的最后一个地址挖掉让 nft 区间可编码;纯 tun 原样', () => {
  const on = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: true, tun: { autoRedirect: true } } })
  const ex6 = on.inbounds[0].route_exclude_address.filter((x) => x.includes(':'))
  // 两半组播都还在(ff3e::/ffbe:: 分别落在 ff00::/9 和 ff80::/9)
  assert.ok(ex6.some((x) => cidrContains(x, 'ff3e::1234')))
  assert.ok(ex6.some((x) => cidrContains(x, 'ffbe::1234')))
  assert.ok(ex6.some((x) => cidrContains(x, 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe')))
  // 只有全 1 的那个地址不在排除表里
  assert.ok(!ex6.some((x) => cidrContains(x, 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')))
  assert.ok(!ex6.includes('ff00::/8'))
  assert.ok(ex6.some((x) => x.startsWith('fe80::')))
  // 纯 tun(不开 auto_redirect):没有编码问题,ff00::/8 原样
  const pure = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: true, tun: { autoRedirect: false } } })
  const pure6 = pure.inbounds[0].route_exclude_address.filter((x) => x.includes(':'))
  assert.ok(pure6.includes('ff00::/8'))
  assert.equal(pure.inbounds[0].auto_redirect, undefined)
  // v4 的组播段 224.0.0.0/4 不到地址空间末尾,两种模式都原样
  for (const c of [on, pure]) assert.ok(c.inbounds[0].route_exclude_address.includes('224.0.0.0/4'))
})

test('第四轮 T4:DNS 禁用模式下即使开着 FakeIP 试验,较早的域名代理站点集也要挡住后面的直连集合(终端不一定经内核解析)', () => {
  const p = firstLayerProfile({
    dns: { split: true, mode: 'off', direct: '223.5.5.5', proxy: '1.1.1.1', fakeIpForProxy: true },
    routing: { fallbackDefault: 'direct', policies: [
      { id: 'a', name: '任意域名策略', domainSuffix: ['example.test'], default: '香港-自动' },
      { id: 'b', name: '后置直连', rulesets: ['geoip-cn'], default: 'direct' },
    ] },
  })
  const off = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p })
  assert.equal(off.inbounds[0].route_exclude_address_set, undefined)
  // 同样的配置换成 dnsmasq 模式:试验前提成立,计划阶段放行(部署时还要做内容校验)
  const dnsmasq = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: { ...p, dns: { ...p.dns, mode: 'dnsmasq' } } })
  assert.deepEqual(dnsmasq.inbounds[0].route_exclude_address_set, ['geoip-cn'])
  // 真实 IP(试验关着):挡住
  const real = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: { ...p, dns: { ...p.dns, mode: 'dnsmasq', fakeIpForProxy: false } } })
  assert.equal(real.inbounds[0].route_exclude_address_set, undefined)
})
