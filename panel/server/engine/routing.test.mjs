import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRoute } from './routing.mjs'

const RULESET_DIR = '/data/rulesets'
const build = (routing, options) => buildRoute(routing, RULESET_DIR, options)

const policy = (over = {}) => ({ id: 'p1', name: '谷歌', rulesets: ['geosite-google'], ...over })

// 前三条规则(sniff / DNS 劫持 / 内网直连)和站点集无关,单独断言一次,
// 后面的用例只看它们各自关心的那几条,免得任何一条规则挪位置就全线飘红。
test('固定前缀:sniff → DNS 劫持 → 内网直连', () => {
  const { route } = build({ policies: [] })
  assert.deepEqual(route.rules.slice(0, 3), [
    { action: 'sniff' },
    { protocol: 'dns', action: 'hijack-dns' },
    { ip_is_private: true, outbound: 'direct' },
  ])
  assert.equal(route.auto_detect_interface, true)
  assert.equal(route.default_domain_resolver, 'dns-direct')
})

test('没有任何站点集时,全部流量落到兜底的「其他」', () => {
  const { route } = build({ policies: [] })
  assert.deepEqual(route.rules.slice(3), [])
  assert.equal(route.final, '其他')
})

test('站点集按顺序生成规则,出站是它自己的同名 selector', () => {
  const { route } = build({
    policies: [policy(), policy({ id: 'p2', name: '微软', rulesets: ['geosite-microsoft'] })],
  })
  assert.deepEqual(route.rules.slice(3), [
    { rule_set: ['geosite-google'], outbound: '谷歌' },
    { rule_set: ['geosite-microsoft'], outbound: '微软' },
  ])
})

test('规则集链接:路由规则按形状表引用域名 / IP 两份 .srs,两份都登记进 rule_set 清单', () => {
  const routing = { policies: [policy({ rulesets: [], ruleUrls: ['https://x.test/Check.list'] })] }
  const tag = 'list-' + (() => { let h = 0x811c9dc5; for (const ch of 'https://x.test/Check.list') { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') })()
  const both = build(routing, { ruleLists: { [tag]: { domain: true, ip: true } } })
  assert.deepEqual(both.route.rules[3], { rule_set: [tag, `${tag}-ip`], outbound: '谷歌' })
  assert.deepEqual(both.route.rule_set.map((s) => s.path), [`${RULESET_DIR}/${tag}.srs`, `${RULESET_DIR}/${tag}-ip.srs`])
  const ipOnly = build(routing, { ruleLists: { [tag]: { domain: false, ip: true } } })
  assert.deepEqual(ipOnly.route.rules[3], { rule_set: [`${tag}-ip`], outbound: '谷歌' })
  // 没有形状表(预览、还没拉过):按老样子引用一份
  const unknown = build(routing)
  assert.deepEqual(unknown.route.rules[3], { rule_set: [tag], outbound: '谷歌' })
})

test('一个站点集的五类条件落进同一条规则', () => {
  const { route, rulesetTags } = build({
    policies: [
      policy({
        rulesets: ['geosite-google', 'geoip-google'],
        domain: ['example.com'],
        domainSuffix: ['google.com'],
        domainKeyword: ['gstatic'],
        ipCidr: ['8.8.8.8/32'],
      }),
    ],
  })
  assert.deepEqual(route.rules[3], {
    rule_set: ['geosite-google', 'geoip-google'],
    domain: ['example.com'],
    domain_suffix: ['google.com'],
    domain_keyword: ['gstatic'],
    ip_cidr: ['8.8.8.8/32'],
    outbound: '谷歌',
  })
  // 规则集要登记进 rule_set 清单,否则部署时不会去下载对应的 .srs
  assert.ok(rulesetTags.has('geosite-google') && rulesetTags.has('geoip-google'))
})

test('没有任何规则的站点集被丢掉——空条件规则在内核里等于"全部命中",会盖住后面所有规则', () => {
  const { route } = build({ policies: [{ id: 'x', name: '空的' }] })
  assert.deepEqual(route.rules.slice(3), [])
})

test('名字叫「其他」的站点集被丢掉:那是兜底的保留名,重名会生成两个同名出站', () => {
  const { route } = build({ policies: [policy({ name: '其他' })] })
  assert.deepEqual(route.rules.slice(3), [])
  assert.equal(route.final, '其他')
})

test('广告拦截排在所有站点集之前', () => {
  const { route } = build({ adBlock: true, policies: [policy()] })
  assert.deepEqual(route.rules[3], { rule_set: 'geosite-category-ads-all', action: 'reject' })
  assert.equal(route.rules[4].outbound, '谷歌')
})

test('dnsmasq 模式:被 auto_redirect 改写到 tun 网段:53 的局域网 DNS 交回本机 dnsmasq,排在防回环 reject 之前', () => {
  const { route } = build({ policies: [] }, { dnsMode: 'dnsmasq', tunCidrs: ['172.19.0.0/30'], dnsmasqTag: 'dnsmasq' })
  assert.deepEqual(route.rules[1], { inbound: ['dns-in'], action: 'hijack-dns' })
  assert.deepEqual(route.rules[2], {
    ip_cidr: ['172.19.0.0/30'], port: [53], action: 'route', outbound: 'dnsmasq', override_address: '127.0.0.1',
  })
  assert.deepEqual(route.rules[3], { ip_cidr: ['172.19.0.0/30'], action: 'reject' })
  assert.ok(route.rules[4].ip_is_private)
  // hijack 模式靠 protocol:dns 接住,不需要这条
  const h = build({ policies: [] }, { dnsMode: 'hijack', tunCidrs: ['172.19.0.0/30'], dnsmasqTag: 'dnsmasq' })
  assert.ok(!h.route.rules.some((r) => r.override_address))
})

test('dnsMode=off 时只劫持 dns-in 自己收到的查询(AdGuard 等主动指过来的),不改写别的 DNS,也没有回交规则', () => {
  const { route } = build({ policies: [] }, { dnsMode: 'off', tunCidrs: ['172.19.0.0/30'], dnsmasqTag: 'dnsmasq' })
  assert.deepEqual(route.rules.filter((r) => r.action === 'hijack-dns'), [{ inbound: ['dns-in'], action: 'hijack-dns' }])
  assert.ok(!route.rules.some((r) => r.protocol === 'dns'))
  assert.ok(!route.rules.some((r) => r.override_address))
})

test('dnsMode=dnsmasq 时只劫持 dns-in,避免 tun→dns-in 自环', () => {
  const { route } = build({ policies: [] }, { dnsMode: 'dnsmasq' })
  assert.deepEqual(route.rules[1], { inbound: ['dns-in'], action: 'hijack-dns' })
  assert.ok(!route.rules.some((r) => r.protocol === 'dns'))
})

// -------- 地区层退役:老档案迁移(行为不变) --------

test('地区档案:选中的地区按动作拆成站点集,接在用户的站点集后面', () => {
  const { route } = build({
    policies: [policy()],
    regions: [{
      id: 'cn',
      name: '中国大陆',
      catchAll: 'proxy',
      rules: [
        { type: 'geosite', value: 'cn', action: 'direct' },
        { type: 'geoip', value: 'cn', action: 'direct' },
      ],
    }],
    regionId: 'cn',
  })
  assert.deepEqual(route.rules.slice(3), [
    { rule_set: ['geosite-google'], outbound: '谷歌' },
    { rule_set: ['geosite-cn', 'geoip-cn'], outbound: '中国大陆·直连' },
  ])
  // 兜底"走代理"这件事变成兜底站点集的默认选中项,规则本身仍然是 final → 其他
  assert.equal(route.final, '其他')
})

test('地区档案:一条地区里既有直连又有代理的规则时,拆成两个站点集', () => {
  const { route } = build({
    policies: [],
    regions: [{
      id: 'jp',
      name: '日本',
      catchAll: 'direct',
      rules: [
        { type: 'geosite', value: 'jp', action: 'direct' },
        { type: 'geosite', value: 'cn', action: 'proxy' },
      ],
    }],
    regionId: 'jp',
  })
  assert.deepEqual(route.rules.slice(3), [
    { rule_set: ['geosite-jp'], outbound: '日本·直连' },
    { rule_set: ['geosite-cn'], outbound: '日本·代理' },
  ])
})

test('已经迁过的档案(有 fallbackDefault)不再翻译地区,免得每次读都多长出两个站点集', () => {
  const { route } = build({
    policies: [policy()],
    fallbackDefault: 'proxy',
    regions: [{ id: 'cn', name: '中国大陆', catchAll: 'proxy', rules: [{ type: 'geosite', value: 'cn', action: 'direct' }] }],
    regionId: 'cn',
  })
  assert.deepEqual(route.rules.slice(3), [{ rule_set: ['geosite-google'], outbound: '谷歌' }])
})

test('更老的档案:categories 变成站点集', () => {
  const { route } = build({
    proxyTag: 'PROXY',
    categories: [{ ruleset: 'geosite-netflix', target: '香港-自动' }],
    directRulesets: ['geosite-cn', 'geoip-cn'],
    fallback: 'PROXY',
  })
  assert.deepEqual(route.rules[3], { rule_set: ['geosite-netflix'], outbound: 'geosite-netflix' })
})

test('更老的档案:始终直连里非中国的规则集变成一个默认直连的站点集', () => {
  const { route } = build({ directRulesets: ['geosite-cn', 'geosite-private'], fallback: 'PROXY' })
  assert.ok(route.rules.some((r) => r.outbound === '始终直连'))
})

test('订阅/节点站点直连:紧跟在 ip_is_private 之后,域名进 domain、IP 进 ip_cidr', () => {
  const { route } = buildRoute({ policies: [{ id: 'a', name: 'A', rulesets: ['geosite-google'] }], fallbackDefault: 'direct' }, '/r', {
    directTag: '直连',
    directHosts: { domains: ['hiddfy.example.xyz', 'sub.example.com'], cidrs: ['1.2.3.4/32'] },
  })
  const i = route.rules.findIndex((r) => r.ip_is_private)
  assert.deepEqual(route.rules[i + 1], { outbound: '直连', domain: ['hiddfy.example.xyz', 'sub.example.com'], ip_cidr: ['1.2.3.4/32'] })
  assert.equal(route.rules[i + 2].outbound, 'A')
})

test('终端分流:来源网段的流量走指定出口,排在直连站点之后、站点集之前;出口不存在的丢掉', () => {
  const { route } = build({ policies: [policy()] }, {
    directHosts: { domains: ['sub.example.com'], cidrs: [] },
    clientRoutes: [
      { sources: ['10.0.0.5/32'], outbound: '香港-自动' },
      { sources: ['10.0.0.6/32'], outbound: '不存在的组' },
    ],
    knownOutbounds: new Set(['direct', '香港-自动', '谷歌']),
  })
  const i = route.rules.findIndex((r) => r.source_ip_cidr)
  const dh = route.rules.findIndex((r) => r.domain && r.domain.includes('sub.example.com'))
  const pol = route.rules.findIndex((r) => r.outbound === '谷歌')
  assert.ok(i > dh && i < pol, `client=${i} directHosts=${dh} policy=${pol}`)
  assert.deepEqual(route.rules[i], { source_ip_cidr: ['10.0.0.5/32'], outbound: '香港-自动' })
  assert.equal(route.rules.filter((r) => r.source_ip_cidr).length, 1)
})

// ---------- 前置自定义分流:一行一条规则,一行一个出口 ----------
const customRules = (...rules) => ({ custom: { rules } })
const R = (over = {}) => ({ type: 'domainSuffix', value: 'openai.com', outbound: 'VW | 香港-01', ...over })

test('每行各走各的出口,按行的先后进配置', () => {
  const { route } = build(
    customRules(R(), R({ value: 'netflix.com', outbound: 'VW | 美国-01' })),
    { knownOutbounds: new Set(['VW | 香港-01', 'VW | 美国-01']) },
  )
  const mine = route.rules.filter((r) => r.domain_suffix)
  assert.deepEqual(mine, [
    { domain_suffix: ['openai.com'], outbound: 'VW | 香港-01' },
    { domain_suffix: ['netflix.com'], outbound: 'VW | 美国-01' },
  ])
})

test('整块排在广告拦截和所有站点集之前', () => {
  const { route } = build(
    { ...customRules(R()), policies: [policy()], adBlock: true },
    { knownOutbounds: new Set(['VW | 香港-01']) },
  )
  const mine = route.rules.findIndex((r) => r.domain_suffix)
  const ad = route.rules.findIndex((r) => r.action === 'reject' && r.rule_set)
  const site = route.rules.findIndex((r) => r.outbound === '谷歌')
  assert.ok(mine > 0 && mine < ad && ad < site, JSON.stringify(route.rules))
})

test('四种条件各自对到内核字段;geosite / 规则集链接进 rule_set 并登记下载', () => {
  const known = new Set(['HK'])
  const cases = [
    [R({ type: 'domain', value: 'a.com', outbound: 'HK' }), { domain: ['a.com'], outbound: 'HK' }],
    [R({ type: 'domainKeyword', value: 'porn', outbound: 'HK' }), { domain_keyword: ['porn'], outbound: 'HK' }],
    [R({ type: 'ipCidr', value: '1.2.3.0/24', outbound: 'HK' }), { ip_cidr: ['1.2.3.0/24'], outbound: 'HK' }],
    [R({ type: 'geosite', value: 'openai', outbound: 'HK' }), { rule_set: ['geosite-openai'], outbound: 'HK' }],
  ]
  for (const [rule, expected] of cases) {
    const { route, rulesetTags } = build(customRules(rule), { knownOutbounds: known })
    const got = route.rules.find((r) => r.outbound === 'HK')
    assert.deepEqual(got, expected, JSON.stringify(rule))
    if (expected.rule_set) assert.ok(rulesetTags.has(expected.rule_set[0]))
  }
})

test('direct / block 占位换算成内置出站当时的名字', () => {
  const opts = { directTag: '直连', blockTag: '拒绝', knownOutbounds: new Set(['直连', '拒绝']) }
  const { route } = build(customRules(R({ outbound: 'direct' }), R({ value: 'ad.com', outbound: 'block' })), opts)
  assert.deepEqual(route.rules.filter((r) => r.domain_suffix), [
    { domain_suffix: ['openai.com'], outbound: '直连' },
    { domain_suffix: ['ad.com'], outbound: '拒绝' },
  ])
})

test('出口不在配置里的那一行跳过,其余行照常生效(内核 outbound not found 起不来)', () => {
  const { route } = build(
    customRules(R({ outbound: '已删掉的节点' }), R({ value: 'ok.com', outbound: 'HK' })),
    { knownOutbounds: new Set(['HK']) },
  )
  assert.deepEqual(route.rules.filter((r) => r.domain_suffix), [{ domain_suffix: ['ok.com'], outbound: 'HK' }])
})

test('停用、或一行都没有,整块不出规则', () => {
  const known = new Set(['VW | 香港-01'])
  assert.ok(!build({ custom: { enabled: false, rules: [R()] } }, { knownOutbounds: known }).route.rules.some((r) => r.domain_suffix))
  assert.ok(!build({ custom: { rules: [] } }, { knownOutbounds: known }).route.rules.some((r) => r.domain_suffix))
})

test('值或出口空着的行在归一化时就被丢掉(空条件的规则等价于全部命中)', () => {
  const { route } = build(
    customRules(R({ value: '' }), R({ outbound: '' }), R({ value: 'ok.com' })),
    { knownOutbounds: new Set(['VW | 香港-01']) },
  )
  assert.deepEqual(route.rules.filter((r) => r.domain_suffix), [
    { domain_suffix: ['ok.com'], outbound: 'VW | 香港-01' },
  ])
})
