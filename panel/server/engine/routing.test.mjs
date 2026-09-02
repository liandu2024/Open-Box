import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRoute } from './routing.mjs'

const RULESET_DIR = '/data/rulesets'
const build = (routing, options) => buildRoute(routing, RULESET_DIR, options)

const policy = (over = {}) => ({
  id: 'p1', name: '谷歌', rulesets: ['geosite-google'], ...over,
})

// 前三条规则(sniff / DNS 劫持 / 内网直连)与地区、策略都无关,单独断言一次,
// 后面的用例只看它们各自关心的那几条,免得任何一条规则挪位置就全线飘红。
test('固定前缀:sniff → DNS 劫持 → 内网直连', () => {
  const { route } = build({ regionId: 'cn' })
  assert.deepEqual(route.rules.slice(0, 3), [
    { action: 'sniff' },
    { protocol: 'dns', action: 'hijack-dns' },
    { ip_is_private: true, outbound: 'direct' },
  ])
  assert.equal(route.auto_detect_interface, true)
  assert.equal(route.default_domain_resolver, 'dns-direct')
})

test('中国大陆:中国站点直连,其余走代理', () => {
  const { route, rulesetTags } = build({ regionId: 'cn' })
  const tail = route.rules.slice(3)
  assert.deepEqual(tail, [
    { rule_set: 'geosite-cn', outbound: 'direct' },
    { rule_set: 'geoip-cn', outbound: 'direct' },
  ])
  assert.equal(route.final, 'PROXY')
  assert.deepEqual([...rulesetTags], ['geosite-cn', 'geoip-cn'])
})

test('香港澳门:除策略之外全部直连,不额外生成地区规则', () => {
  const { route } = build({ regionId: 'hkmo' })
  assert.deepEqual(route.rules.slice(3), [])
  assert.equal(route.final, 'direct')
})

test('其他地区:中国站点走代理(回国),其余直连', () => {
  const { route } = build({ regionId: 'other' })
  assert.deepEqual(route.rules.slice(3), [
    { rule_set: 'geosite-cn', outbound: 'PROXY' },
    { rule_set: 'geoip-cn', outbound: 'PROXY' },
  ])
  assert.equal(route.final, 'direct')
})

test('策略排在地区规则之前:显式指定要盖过"这个地区默认怎么走"', () => {
  const { route } = build({ regionId: 'cn', policies: [policy()] })
  const idxPolicy = route.rules.findIndex((r) => r.outbound === '谷歌')
  const idxRegion = route.rules.findIndex((r) => r.rule_set === 'geosite-cn')
  assert.ok(idxPolicy >= 0 && idxRegion >= 0)
  assert.ok(idxPolicy < idxRegion, '策略必须排在地区规则前面')
})

test('策略的五类条件都落进同一条规则,出站是策略自己', () => {
  const { route, rulesetTags } = build({
    regionId: 'hkmo',
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

test('没有任何条件的策略被丢掉——空条件规则在内核里等于"全部命中",会盖住后面所有规则', () => {
  const { route } = build({ regionId: 'hkmo', policies: [{ id: 'x', name: '空的' }] })
  assert.deepEqual(route.rules.slice(3), [])
})

test('广告拦截排在策略之前', () => {
  const { route } = build({ regionId: 'cn', adBlock: true, policies: [policy()] })
  assert.deepEqual(route.rules[3], { rule_set: 'geosite-category-ads-all', action: 'reject' })
  assert.equal(route.rules[4].outbound, '谷歌')
})

test('dnsMode=dnsmasq 时只劫持 dns-in,避免 tun→dns-in 自环', () => {
  const { route } = build({ regionId: 'cn' }, { dnsMode: 'dnsmasq' })
  assert.deepEqual(route.rules[1], { inbound: ['dns-in'], action: 'hijack-dns' })
  assert.ok(!route.rules.some((r) => r.protocol === 'dns'))
})

// -------- 老档案迁移(行为不变) --------

test('老档案:categories 变成策略,geosite-cn 直连说明人在国内', () => {
  const { route } = build({
    proxyTag: 'PROXY',
    categories: [{ ruleset: 'geosite-netflix', target: '香港-自动' }],
    directRulesets: ['geosite-cn', 'geoip-cn'],
    fallback: 'PROXY',
  })
  // 迁移出来的策略仍然排在地区规则前面,规则的目标是策略自己的 selector
  assert.deepEqual(route.rules[3], { rule_set: ['geosite-netflix'], outbound: 'geosite-netflix' })
  assert.deepEqual(route.rules.slice(4), [
    { rule_set: 'geosite-cn', outbound: 'direct' },
    { rule_set: 'geoip-cn', outbound: 'direct' },
  ])
  assert.equal(route.final, 'PROXY')
})

test('老档案:兜底是 direct 说明是"只有指定的走代理",对应香港澳门那一档', () => {
  const { route } = build({ categories: [], directRulesets: [], fallback: 'direct' })
  assert.equal(route.final, 'direct')
  assert.deepEqual(route.rules.slice(3), [])
})

test('老档案:始终直连里非中国的规则集变成一条走直连的策略', () => {
  const { route } = build({ directRulesets: ['geosite-cn', 'geosite-private'], fallback: 'PROXY' })
  assert.deepEqual(route.rules[3], { rule_set: ['geosite-private'], outbound: '始终直连' })
})

test('地区规则按表里的顺序逐条生成,每条自己带动作', () => {
  const { route, rulesetTags } = build({
    regions: [{
      id: 'jp',
      name: '日本',
      catchAll: 'proxy',
      rules: [
        { type: 'domainSuffix', value: 'nhk.or.jp', action: 'direct' },
        { type: 'geosite', value: 'cn', action: 'proxy' },
        { type: 'ipcidr', value: '133.0.0.0/8', action: 'direct' },
        { type: 'domain', value: 'example.com', action: 'proxy' },
      ],
    }],
    regionId: 'jp',
  })
  assert.deepEqual(route.rules.slice(3), [
    { domain_suffix: ['nhk.or.jp'], outbound: 'direct' },
    { rule_set: 'geosite-cn', outbound: 'PROXY' },
    { ip_cidr: ['133.0.0.0/8'], outbound: 'direct' },
    { domain: ['example.com'], outbound: 'PROXY' },
  ])
  assert.equal(route.final, 'PROXY')
  // 只有 geosite/geoip 需要下载 .srs
  assert.deepEqual([...rulesetTags], ['geosite-cn'])
})
