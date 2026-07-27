import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRoute } from './routing.mjs'

const routing = {
  proxyTag: 'PROXY',
  categories: [{ ruleset: 'geosite-openai', target: '美国' }],
  directRulesets: ['geosite-cn', 'geoip-cn'],
  adBlock: true,
  adRuleset: 'geosite-ads',
  fallback: 'PROXY',
}

test('buildRoute 结构与顺序', () => {
  const { route, rulesetTags } = buildRoute(routing, '/data/rulesets')
  assert.equal(route.auto_detect_interface, true)
  assert.equal(route.default_domain_resolver, 'dns-direct')
  assert.equal(route.final, 'PROXY')
  // rule_set 本地路径
  assert.ok(route.rule_set.some((r) => r.tag === 'geosite-openai' && r.type === 'local' && r.format === 'binary' && r.path === '/data/rulesets/geosite-openai.srs'))
  // 规则顺序:sniff, hijack-dns, ip_is_private, ad reject, category, direct
  assert.deepEqual(route.rules[0], { action: 'sniff' })
  assert.deepEqual(route.rules[1], { protocol: 'dns', action: 'hijack-dns' })
  assert.deepEqual(route.rules[2], { ip_is_private: true, outbound: 'direct' })
  assert.deepEqual(route.rules[3], { rule_set: 'geosite-ads', action: 'reject' })
  assert.deepEqual(route.rules[4], { rule_set: 'geosite-openai', outbound: '美国' })
  assert.deepEqual(route.rules[5], { rule_set: 'geosite-cn', outbound: 'direct' })
  assert.deepEqual(route.rules[6], { rule_set: 'geoip-cn', outbound: 'direct' })
  // rulesetTags 汇总(去重)
  assert.deepEqual([...rulesetTags].sort(), ['geoip-cn', 'geosite-ads', 'geosite-cn', 'geosite-openai'])
})

test('adBlock 关闭时无 reject 规则', () => {
  const { route } = buildRoute({ ...routing, adBlock: false }, '/d')
  assert.ok(!route.rules.some((r) => r.action === 'reject'))
})

test('options.dnsMode=dnsmasq 时生成仅限 dns-in 入站的 hijack-dns 规则(避免全局劫持自环)', () => {
  const { route } = buildRoute(routing, '/data/rulesets', { dnsMode: 'dnsmasq' })
  assert.ok(route.rules.some((r) => r.action === 'hijack-dns' && Array.isArray(r.inbound) && r.inbound.includes('dns-in')))
  assert.ok(!route.rules.some((r) => r.action === 'hijack-dns' && r.protocol === 'dns'))
})
