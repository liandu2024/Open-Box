import assert from 'node:assert/strict'
import test from 'node:test'
import { dnsmasqForwardDomains, normalizeRouting, policyOutboundOptions } from './routing-model.mjs'

test('老档案:categories 变策略,directRulesets 里的中国规则集变地区档', () => {
  const conf = normalizeRouting({
    categories: [{ ruleset: 'geosite-google', target: '香港-自动' }],
    directRulesets: ['geosite-cn', 'geoip-cn', 'geosite-private'],
    fallback: 'PROXY',
  })
  assert.equal(conf.regionMode, 'CN')
  assert.deepEqual(
    conf.policies.map((p) => [p.name, p.default, p.rulesets]),
    [
      ['geosite-google', '香港-自动', ['geosite-google']],
      ['始终直连', 'direct', ['geosite-private']],
    ],
  )
})

test('老档案:兜底 direct 且没有中国规则集 → 香港澳门那一档', () => {
  assert.equal(normalizeRouting({ directRulesets: [], fallback: 'direct' }).regionMode, 'HKMO')
})

test('已经是新模型时不再迁移', () => {
  const conf = normalizeRouting({
    regionMode: 'OTHER',
    policies: [{ id: 'x', name: '谷歌', domainSuffix: ['google.com'] }],
    categories: [{ ruleset: 'geosite-old', target: 'X' }],
  })
  assert.equal(conf.regionMode, 'OTHER')
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
