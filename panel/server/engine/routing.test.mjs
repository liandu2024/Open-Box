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
