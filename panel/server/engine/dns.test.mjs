import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDns } from './dns.mjs'

const base = {
  ipv6: true,
  dns: { split: true, direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' },
  routing: { proxyTag: 'PROXY', categories: [{ ruleset: 'geosite-openai', target: '美国' }], directRulesets: ['geosite-cn'], adBlock: true, adRuleset: 'geosite-ads' },
}

test('split 开:双通道 + 分流规则', () => {
  const dns = buildDns(base)
  const direct = dns.servers.find((s) => s.tag === 'dns-direct')
  const proxy = dns.servers.find((s) => s.tag === 'dns-proxy')
  assert.deepEqual(direct, { type: 'udp', tag: 'dns-direct', server: '223.5.5.5' })
  assert.deepEqual(proxy, { type: 'https', tag: 'dns-proxy', server: '1.1.1.1', detour: 'PROXY' })
  assert.equal(dns.final, 'dns-proxy')
  assert.equal(dns.strategy, 'prefer_ipv4')
  // directRulesets → dns-direct;category ruleset → dns-proxy;ad → reject
  assert.ok(dns.rules.some((r) => r.rule_set === 'geosite-cn' && r.server === 'dns-direct'))
  assert.ok(dns.rules.some((r) => r.rule_set === 'geosite-openai' && r.server === 'dns-proxy'))
  assert.ok(dns.rules.some((r) => r.rule_set === 'geosite-ads' && r.action === 'reject'))
})

test('split 关:单通道直连', () => {
  const dns = buildDns({ ...base, dns: { split: false, direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' } })
  assert.equal(dns.servers.length, 1)
  assert.equal(dns.servers[0].tag, 'dns-direct')
  assert.equal(dns.final, 'dns-direct')
  assert.ok(!dns.rules || dns.rules.length === 0)
})

test('ipv6 关:strategy=ipv4_only', () => {
  assert.equal(buildDns({ ...base, ipv6: false }).strategy, 'ipv4_only')
})
