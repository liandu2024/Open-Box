import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDns } from './dns.mjs'

const base = {
  ipv6: true,
  dns: { split: true, mode: 'hijack', direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' },
  routing: { proxyTag: 'PROXY', regionMode: 'CN', policies: [] },
}
const withRouting = (routing, over = {}) => ({ ...base, ...over, routing: { ...base.routing, ...routing } })

test('直连侧走系统解析器:hijack 模式下用 local,不指定任何服务器地址', () => {
  const dns = buildDns(base)
  assert.deepEqual(dns.servers[0], { type: 'local', tag: 'dns-direct' })
})

test('dnsmasq 模式不能用 local(会绕回 dnsmasq 死循环),改用 WAN 下发的上游', () => {
  const dns = buildDns({ ...base, dns: { ...base.dns, mode: 'dnsmasq' } }, { systemDns: ['192.168.1.1', '8.8.8.8'] })
  assert.deepEqual(dns.servers[0], { type: 'udp', tag: 'dns-direct', server: '192.168.1.1', detour: 'direct' })
})

test('dnsmasq 模式读不到系统上游时,回落到档案里填的那台', () => {
  const dns = buildDns({ ...base, dns: { ...base.dns, mode: 'dnsmasq' } })
  assert.equal(dns.servers[0].server, '223.5.5.5')
})

test('中国大陆:中国域名直连解析,其余走代理 DNS', () => {
  const dns = buildDns(base)
  assert.deepEqual(dns.servers[1], { type: 'https', tag: 'dns-proxy', server: '1.1.1.1', detour: 'PROXY' })
  assert.deepEqual(dns.rules, [
    { rule_set: 'geosite-cn', server: 'dns-direct' },
    { rule_set: 'geoip-cn', server: 'dns-direct' },
  ])
  assert.equal(dns.final, 'dns-proxy')
})

test('香港澳门:没有地区规则,兜底就是直连解析', () => {
  const dns = buildDns(withRouting({ regionMode: 'HKMO' }))
  assert.deepEqual(dns.rules, [])
  assert.equal(dns.final, 'dns-direct')
})

test('其他地区:中国域名走代理 DNS(回国),兜底直连', () => {
  const dns = buildDns(withRouting({ regionMode: 'OTHER' }))
  assert.deepEqual(dns.rules, [
    { rule_set: 'geosite-cn', server: 'dns-proxy' },
    { rule_set: 'geoip-cn', server: 'dns-proxy' },
  ])
  assert.equal(dns.final, 'dns-direct')
})

test('每条策略一台自己的 DNS,detour 指向同名 selector——代理的 DNS 跟着策略选的线路走', () => {
  const dns = buildDns(
    withRouting({
      regionMode: 'HKMO',
      policies: [{ id: 'p1', name: '谷歌', rulesets: ['geosite-google'], domainSuffix: ['google.com'] }],
    }),
  )
  assert.deepEqual(dns.servers[2], { type: 'https', tag: 'dns-policy-0', server: '1.1.1.1', detour: '谷歌' })
  assert.deepEqual(dns.rules[0], {
    server: 'dns-policy-0',
    rule_set: ['geosite-google'],
    domain_suffix: ['google.com'],
  })
})

test('只有 IP 条件的策略不进 DNS 规则:解析阶段还没有 IP,写进去只会让人以为生效了', () => {
  const dns = buildDns(
    withRouting({ regionMode: 'HKMO', policies: [{ id: 'p1', name: '内网', ipCidr: ['10.0.0.0/8'] }] }),
  )
  assert.deepEqual(dns.rules, [])
  assert.equal(dns.servers.length, 2)
})

test('广告拦截排在所有策略之前', () => {
  const dns = buildDns(
    withRouting({ regionMode: 'HKMO', adBlock: true, policies: [{ id: 'p1', name: '谷歌', rulesets: ['geosite-google'] }] }),
  )
  assert.deepEqual(dns.rules[0], { rule_set: 'geosite-category-ads-all', action: 'reject' })
})

test('分流 DNS 关掉时只剩一条直连通道', () => {
  const dns = buildDns({ ...base, dns: { ...base.dns, split: false } })
  assert.equal(dns.servers.length, 1)
  assert.equal(dns.final, 'dns-direct')
  assert.ok(!dns.rules)
})

test('ipv6 关:strategy=ipv4_only', () => {
  assert.equal(buildDns({ ...base, ipv6: false }).strategy, 'ipv4_only')
})
