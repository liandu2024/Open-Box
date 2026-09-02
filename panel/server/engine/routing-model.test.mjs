import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FALLBACK_TAG,
  dnsmasqForwardDomains,
  effectiveOutbound,
  normalizeRouting,
  policyOutboundOptions,
} from './routing-model.mjs'

const GROUPS = ['所有-自动', '香港-自动']

// -------- 站点集本身 --------

test('没有任何条件的站点集被丢掉', () => {
  assert.deepEqual(normalizeRouting({ policies: [{ id: 'x', name: '空的' }] }).policies, [])
})

test('叫「其他」的站点集被丢掉:那是兜底占着的名字,重名会生成两个同名出站', () => {
  const conf = normalizeRouting({ policies: [{ id: 'x', name: FALLBACK_TAG, rulesets: ['geosite-cn'] }] })
  assert.deepEqual(conf.policies, [])
})

test('兜底站点集永远存在,名字和图标固定,只有"默认走哪"是用户的选择', () => {
  const conf = normalizeRouting({ policies: [], fallbackDefault: 'direct' })
  assert.equal(conf.fallback.name, FALLBACK_TAG)
  assert.equal(conf.fallback.icon, 'globe:earth-meridians')
  assert.equal(conf.fallback.default, 'direct')
})

test('出站选项:顺序固定,全关时回落 direct', () => {
  assert.deepEqual(policyOutboundOptions({ direct: true, groups: true, reject: true }, GROUPS), [
    'direct', ...GROUPS, 'block',
  ])
  assert.deepEqual(policyOutboundOptions({ direct: false, groups: false, reject: false }, GROUPS), ['direct'])
})

test('effectiveOutbound:成员里有就用它,没有则按占位/第一项算', () => {
  const members = ['direct', ...GROUPS, 'block']
  assert.equal(effectiveOutbound('香港-自动', members), '香港-自动')
  assert.equal(effectiveOutbound('已经删掉的组', members), 'direct')
  assert.equal(effectiveOutbound('', members), 'direct')
  // 迁移留下的 'proxy' 占位 → 第一个节点组
  assert.equal(effectiveOutbound('proxy', members), '所有-自动')
  // 一个组都没有时只能落回直连:不能写一个内核里不存在的出站
  assert.equal(effectiveOutbound('proxy', ['direct', 'block']), 'direct')
})

// -------- 地区层退役:迁移 --------

test('地区档案:选中那条按动作拆成站点集,兜底变成兜底站点集的默认选中项', () => {
  const conf = normalizeRouting({
    policies: [],
    regionId: 'cn',
    regions: [{
      id: 'cn', name: '中国大陆', catchAll: 'proxy',
      rules: [
        { type: 'geosite', value: 'cn', action: 'direct' },
        { type: 'domainSuffix', value: 'example.cn', action: 'direct' },
      ],
    }],
  })
  assert.deepEqual(
    conf.policies.map((p) => [p.name, p.default, p.rulesets, p.domainSuffix]),
    [['中国大陆·直连', 'direct', ['geosite-cn'], ['example.cn']]],
  )
  assert.equal(conf.fallback.default, 'proxy')
})

test('地区档案:存过 fallbackDefault 就说明迁过了,不再重复长出站点集', () => {
  const conf = normalizeRouting({
    policies: [],
    fallbackDefault: 'direct',
    regionId: 'cn',
    regions: [{ id: 'cn', name: '中国大陆', catchAll: 'proxy', rules: [{ type: 'geosite', value: 'cn', action: 'direct' }] }],
  })
  assert.deepEqual(conf.policies, [])
  assert.equal(conf.fallback.default, 'direct')
})

test('压根没有地区数据时不凭空长站点集', () => {
  assert.deepEqual(normalizeRouting({ policies: [] }).policies, [])
})

test('更老的档案:categories 变站点集,始终直连里非中国的规则集单独成一个', () => {
  const conf = normalizeRouting({
    categories: [{ ruleset: 'geosite-google', target: '香港-自动' }],
    directRulesets: ['geosite-cn', 'geoip-cn', 'geosite-private'],
    fallback: 'PROXY',
  })
  assert.deepEqual(
    conf.policies.map((p) => [p.name, p.default, p.rulesets]),
    [
      ['geosite-google', '香港-自动', ['geosite-google']],
      ['始终直连', 'direct', ['geosite-private']],
    ],
  )
})

test('更老的档案:store 补出来的空 policies 不该挡住迁移', () => {
  // store 的 deepMerge 会把 DEFAULT_PROFILE 的 `policies: []` 补给老档案
  const conf = normalizeRouting({
    policies: [],
    categories: [{ ruleset: 'geosite-google', target: 'X' }],
  })
  assert.equal(conf.policies.length, 1)
})

test('已经是新模型时不迁移老字段', () => {
  const conf = normalizeRouting({
    policies: [{ id: 'x', name: '谷歌', domainSuffix: ['google.com'] }],
    categories: [{ ruleset: 'geosite-old', target: 'X' }],
  })
  assert.deepEqual(conf.policies.map((p) => p.name), ['谷歌'])
})

// -------- dnsmasq 逐条转发 --------

const MEMBERS = ['direct', ...GROUPS, 'block']
const forward = (routing) => dnsmasqForwardDomains(routing, MEMBERS)

test('兜底直连 + 走代理的集合只用域名 → 可以逐条转发', () => {
  assert.deepEqual(
    forward({
      fallbackDefault: 'direct',
      policies: [
        { id: 'a', name: '谷歌', default: '香港-自动', domainSuffix: ['google.com'], domain: ['example.com'] },
        { id: 'b', name: '中国', default: 'direct', rulesets: ['geosite-cn'] },
      ],
    }),
    ['example.com', 'google.com'],
  )
})

test('走代理的集合用了规则集或关键词就没法逐条转发(dnsmasq 两者都不支持)', () => {
  assert.deepEqual(
    forward({ fallbackDefault: 'direct', policies: [{ id: 'a', name: 'x', default: '香港-自动', rulesets: ['geosite-google'] }] }),
    [],
  )
  assert.deepEqual(
    forward({ fallbackDefault: 'direct', policies: [{ id: 'a', name: 'x', default: '香港-自动', domainKeyword: ['google'] }] }),
    [],
  )
})

test('兜底走代理时代理面没法枚举,一律全局转发', () => {
  assert.deepEqual(
    forward({ fallbackDefault: 'proxy', policies: [{ id: 'a', name: 'x', default: '香港-自动', domainSuffix: ['google.com'] }] }),
    [],
  )
})

test('全都直连时也不走逐条转发:全局转发更简单可靠', () => {
  assert.deepEqual(
    forward({ fallbackDefault: 'direct', policies: [{ id: 'b', name: '中国', default: 'direct', rulesets: ['geosite-cn'] }] }),
    [],
  )
})
