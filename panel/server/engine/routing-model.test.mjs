import assert from 'node:assert/strict'
import test from 'node:test'
import { dnsmasqForwardDomains, normalizeRouting, policyOutboundOptions } from './routing-model.mjs'

test('老档案:categories 变策略,directRulesets 里的中国规则集变地区档', () => {
  const conf = normalizeRouting({
    categories: [{ ruleset: 'geosite-google', target: '香港-自动' }],
    directRulesets: ['geosite-cn', 'geoip-cn', 'geosite-private'],
    fallback: 'PROXY',
  })
  assert.equal(conf.region.id, 'cn')
  assert.deepEqual(
    conf.policies.map((p) => [p.name, p.default, p.rulesets]),
    [
      ['geosite-google', '香港-自动', ['geosite-google']],
      ['始终直连', 'direct', ['geosite-private']],
    ],
  )
})

test('老档案:兜底 direct 且没有中国规则集 → 香港澳门那一档', () => {
  assert.equal(normalizeRouting({ directRulesets: [], fallback: 'direct' }).region.id, 'hkmo')
})

test('已经是新模型时不再迁移', () => {
  const conf = normalizeRouting({
    regionId: 'other',
    policies: [{ id: 'x', name: '谷歌', domainSuffix: ['google.com'] }],
    categories: [{ ruleset: 'geosite-old', target: 'X' }],
  })
  assert.equal(conf.region.id, 'other')
  assert.deepEqual(conf.policies.map((p) => p.name), ['谷歌'])
})

test('没有任何条件的策略被丢掉', () => {
  assert.deepEqual(normalizeRouting({ policies: [{ name: '空的' }] }).policies, [])
})

test('出站选项:顺序固定,全关时回落 direct', () => {
  assert.deepEqual(policyOutboundOptions({ direct: true, groups: true, reject: true }, ['A', 'B']), [
    'direct', 'A', 'B', 'block',
  ])
  assert.deepEqual(policyOutboundOptions({ direct: false, groups: false, reject: false }, ['A']), ['direct'])
})

// -------- dnsmasq 要不要按域名转发 --------

test('香港澳门 + 只用域名条件 → 可以逐条转发', () => {
  const domains = dnsmasqForwardDomains({
    regionMode: 'HKMO',
    policies: [{ name: '谷歌', domain: ['a.com'], domainSuffix: ['google.com'] }],
  })
  assert.deepEqual(domains, ['a.com', 'google.com'])
})

test('用了规则集或关键词就没法逐条转发(dnsmasq 两者都不支持)', () => {
  assert.deepEqual(
    dnsmasqForwardDomains({ regionMode: 'HKMO', policies: [{ name: 'x', rulesets: ['geosite-google'] }] }),
    [],
  )
  assert.deepEqual(
    dnsmasqForwardDomains({ regionMode: 'HKMO', policies: [{ name: 'x', domainKeyword: ['google'] }] }),
    [],
  )
})

test('中国大陆/其他地区的代理面没法枚举,一律全局转发', () => {
  const policies = [{ name: '谷歌', domainSuffix: ['google.com'] }]
  assert.deepEqual(dnsmasqForwardDomains({ regionMode: 'CN', policies }), [])
  assert.deepEqual(dnsmasqForwardDomains({ regionMode: 'OTHER', policies }), [])
})

// -------- 地区列表可增删改 --------

test('没自定义过就是内置那三条,默认选中第一条', () => {
  const conf = normalizeRouting({ policies: [] })
  assert.deepEqual(conf.regions.map((r) => r.id), ['cn', 'hkmo', 'other'])
  assert.equal(conf.region.id, 'cn')
})

test('可以自己加一条地区(比如日本):按规则表逐条走', () => {
  const conf = normalizeRouting({
    policies: [],
    regions: [{
      id: 'jp', name: '日本', catchAll: 'proxy',
      rules: [{ type: 'geosite', value: 'jp', action: 'direct' }],
    }],
    regionId: 'jp',
  })
  assert.equal(conf.region.name, '日本')
  assert.deepEqual(conf.region.rules, [{ type: 'geosite', value: 'jp', action: 'direct' }])
  assert.equal(conf.region.catchAll, 'proxy')
})

test('老形状的地区(规则集 + target + fallback)翻译成规则表,行为不变', () => {
  const conf = normalizeRouting({
    policies: [],
    regions: [{ id: 'jp', name: '日本', rulesets: ['geosite-jp', 'geoip-jp'], target: 'proxy', fallback: 'direct' }],
    regionId: 'jp',
  })
  assert.deepEqual(conf.region.rules, [
    { type: 'geosite', value: 'jp', action: 'proxy' },
    { type: 'geoip', value: 'jp', action: 'proxy' },
  ])
  assert.equal(conf.region.catchAll, 'direct')
})

test('规则表里认不出的类型/空值直接丢掉,不让它变成"全部命中"', () => {
  const conf = normalizeRouting({
    policies: [],
    regions: [{
      id: 'x', name: 'x', catchAll: 'direct',
      rules: [{ type: '乱写的', value: 'a', action: 'direct' }, { type: 'domain', value: '  ', action: 'direct' }],
    }],
    regionId: 'x',
  })
  assert.deepEqual(conf.region.rules, [])
})

test('选中的 id 不存在时回落到第一条,不至于整份配置没有地区层', () => {
  const conf = normalizeRouting({ policies: [], regionId: '已经删掉的' })
  assert.equal(conf.region.id, 'cn')
})

test('老的 regionMode 仍然认:改版初期存下的档案不该失效', () => {
  assert.equal(normalizeRouting({ policies: [], regionMode: 'HKMO' }).region.id, 'hkmo')
})
