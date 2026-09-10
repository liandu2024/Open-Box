import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFilterConfig, DNS_FILTER_DEFAULT, filterForwardPlan, filterKey, parseDnsFilter, validateDnsFilter } from './dns-filter.mjs'

test('DNS filtering defaults off; empty list stays empty; forward changes only while enabled', () => {
  assert.equal(DNS_FILTER_DEFAULT.enabled, false)
  assert.equal(DNS_FILTER_DEFAULT.lists[0].url, 'https://anti-ad.net/easylist.txt')
  const plan = { mode: 'domains', domains: ['proxy.test'] }
  assert.equal(filterForwardPlan({}, plan), plan)
  assert.equal(filterForwardPlan({ dns: { filter: { enabled: true } } }, plan).mode, 'all')
  assert.deepEqual(buildFilterConfig({}, null), { rules: [], sets: [] })
  assert.equal(validateDnsFilter({ enabled: false, lists: [], allowDomains: [] }), null)
})

test('DNS syntax preserves allow, important, query types, denyallow, wildcard and exact hosts', () => {
  const result = parseDnsFilter('! title\n||ads.example.com^\n@@||safe.ads.example.com^\n0.0.0.0 exact.example.com\n||*.wild.example.com^$dnstype=A|AAAA\n/^ad[0-9]+\\.example\\.com$/$denyallow=ad1.example.com\n||critical.example.com^$important\nexample.com##.banner\n||unknown.example.com^$third-party')
  assert.equal(result.count, 6)
  assert.equal(result.unsupported, 2)
  assert.deepEqual(result.rules.allow, [{ domain_suffix: ['safe.ads.example.com'] }])
  assert.equal(result.rules.blockImportant.length, 1)
  assert.ok(JSON.stringify(result.rules.block).includes('"query_type":["A","AAAA"]'))
  assert.ok(JSON.stringify(result.rules.block).includes('"invert":true'))
})

test('filter configuration keeps exceptions global across lists and user allow above important', () => {
  const settings = { enabled: true, lists: [], allowDomains: [] }
  const artifact = { key: filterKey(settings), sets: [], allow: ['normal-exception'], allowImportant: ['important-exception'], userAllow: ['user'], blocks: [{ tag: 'ordinary', important: false }, { tag: 'important', important: true }] }
  const config = buildFilterConfig({ dns: { filter: settings } }, artifact)
  assert.deepEqual(config.rules[0].rules[0], { rule_set: ['important'] })
  assert.deepEqual(config.rules[0].rules[1].rule_set, ['user', 'important-exception'])
  assert.deepEqual(config.rules[1].rules[1].rule_set, ['user', 'important-exception', 'normal-exception'])
  assert.equal(config.rules[0].rcode, 'NXDOMAIN')
  assert.throws(() => buildFilterConfig({ dns: { filter: settings } }), /尚未准备/)
})

test('filter configuration validates IDs, URL schemes, duplicate lists and domain boundaries', () => {
  for (const change of [{ lists: [{ id: '../a', enabled: true, name: 'bad', url: 'https://example.com' }] }, { lists: [{ id: 'a', enabled: true, name: 'bad', url: 'file:///etc/passwd' }] }, { allowDomains: ['*example.com'] }, { enabled: 'yes' }]) {
    assert.ok(validateDnsFilter({ ...structuredClone(DNS_FILTER_DEFAULT), ...change }))
  }
})
