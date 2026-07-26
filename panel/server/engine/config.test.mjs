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
  // direct + PROXY selector + 美国 urltest + ss 节点
  assert.ok(c.outbounds.some((o) => o.tag === 'direct' && o.type === 'direct'))
  assert.ok(c.outbounds.some((o) => o.tag === 'PROXY' && o.type === 'selector'))
  assert.ok(c.outbounds.some((o) => o.tag === '美国-01' && o.type === 'shadowsocks'))
})

test('ipv6 关:tun address 仅 v4', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: false } })
  assert.equal(c.inbounds[0].address.length, 1)
  assert.equal(c.dns.strategy, 'ipv4_only')
})

test('修复2: category.target 引用不存在的组时重映射为 proxyTag', () => {
  const profileWithDanglingTarget = {
    ...profile,
    routing: { ...profile.routing, categories: [{ ruleset: 'geosite-netflix', target: '不存在的组' }] },
  }
  const c = buildConfig({ nodes, regionGroups, profile: profileWithDanglingTarget })
  const rule = c.route.rules.find((r) => r.rule_set === 'geosite-netflix')
  assert.ok(rule)
  assert.equal(rule.outbound, 'PROXY')
})

test('修复2: fallback 引用不存在的 tag 时重映射为 proxyTag', () => {
  const profileWithDanglingFallback = {
    ...profile,
    routing: { ...profile.routing, fallback: '也不存在' },
  }
  const c = buildConfig({ nodes, regionGroups, profile: profileWithDanglingFallback })
  assert.equal(c.route.final, 'PROXY')
})

test('修复2: 合法 target/fallback 不被改写', () => {
  const profileWithValidTarget = {
    ...profile,
    routing: { ...profile.routing, categories: [{ ruleset: 'geosite-netflix', target: '美国' }], fallback: '美国' },
  }
  const c = buildConfig({ nodes, regionGroups, profile: profileWithValidTarget })
  const rule = c.route.rules.find((r) => r.rule_set === 'geosite-netflix')
  assert.equal(rule.outbound, '美国')
  assert.equal(c.route.final, '美国')
})
