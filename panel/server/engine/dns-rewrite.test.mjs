import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DNS_REWRITE_DEFAULTS, DNS_REWRITE_TAG, ensureDnsRewriteDefaults, matchRewrite, normalizeDnsRewrite, normalizeDomain,
  restoreDefaultRules, rewriteDnsRules, rewriteDnsServer, rewriteForwardDomains, validateDnsRewrite,
} from './dns-rewrite.mjs'
import { buildDns } from './dns.mjs'
import { dnsmasqForwardPlan } from './routing-model.mjs'
import { createStore } from '../store/openbox-store.mjs'

const rulesOf = (list) => normalizeDnsRewrite({ rewrite: { initialized: 1, rules: list } }).rules

test('normalizeDomain:小写、去末尾点、泛域名保留 *.;非法字符 / 中间的 * 不认', () => {
  assert.equal(normalizeDomain(' Services.GoogleAPIs.CN. '), 'services.googleapis.cn')
  assert.equal(normalizeDomain('*.OK1248.cn', { allowWildcard: true }), '*.ok1248.cn')
  assert.equal(normalizeDomain('*.ok1248.cn'), '')
  assert.equal(normalizeDomain('a.*.b.cn', { allowWildcard: true }), '')
  assert.equal(normalizeDomain('bad domain.cn'), '')
  assert.equal(normalizeDomain(''), '')
})

test('validateDnsRewrite:源 / 目标 / 地址 / 重复 / 二选一 都要拦;合法定义通过', () => {
  const ok = { rules: [
    { source: 'services.googleapis.cn', domain: 'services.googleapis.com' },
    { source: '*.ok1248.cn', addresses: ['192.168.3.1', '2001:db8::1'] },
    { id: 'x', enabled: false, source: 'article.ok1248.cn', addresses: ['121.43.244.161'], note: '测试' },
  ] }
  assert.equal(validateDnsRewrite(ok), '')
  assert.equal(validateDnsRewrite(undefined), '')
  assert.equal(validateDnsRewrite({}), '')
  assert.match(validateDnsRewrite([]), /object/)
  assert.match(validateDnsRewrite({ rules: 'x' }), /array/)
  assert.match(validateDnsRewrite({ rules: [{ source: 'bad domain', domain: 'a.com' }] }), /源域名不合法/)
  assert.match(validateDnsRewrite({ rules: [{ source: 'a.cn', domain: 'b.com' }, { source: 'A.cn.', domain: 'c.com' }] }), /重复/)
  assert.match(validateDnsRewrite({ rules: [{ source: 'a.cn', domain: 'b.com', addresses: ['1.1.1.1'] }] }), /只能填/)
  assert.match(validateDnsRewrite({ rules: [{ source: 'a.cn' }] }), /要填目标域名或至少一个地址/)
  assert.match(validateDnsRewrite({ rules: [{ source: 'a.cn', addresses: ['1.2.3'] }] }), /地址不合法/)
  assert.match(validateDnsRewrite({ rules: [{ source: 'a.cn', domain: 'a.cn' }] }), /不能是它自己/)
  assert.match(validateDnsRewrite({ rules: [{ source: 'a.cn', domain: 'b.com', enabled: 'yes' }] }), /enabled/)
})

test('matchRewrite:精确优先,泛域名只匹配子域、按标签边界、后缀最长的赢;停用的不算', () => {
  const rules = rulesOf([
    { id: 'w', source: '*.ok1248.cn', addresses: ['192.168.3.1'] },
    { id: 'wd', source: '*.dev.ok1248.cn', addresses: ['10.0.0.1'] },
    { id: 'e', source: 'article.ok1248.cn', addresses: ['121.43.244.161'] },
    { id: 'off', enabled: false, source: 'off.ok1248.cn', addresses: ['1.1.1.1'] },
  ])
  assert.equal(matchRewrite(rules, 'a.ok1248.cn').id, 'w')
  assert.equal(matchRewrite(rules, 'a.b.ok1248.cn').id, 'w')
  assert.equal(matchRewrite(rules, 'ok1248.cn'), null, '根域不在泛域名范围内')
  assert.equal(matchRewrite(rules, 'badok1248.cn'), null, '不能按字符串后缀误匹配')
  assert.equal(matchRewrite(rules, 'article.ok1248.cn').id, 'e', '精确优先于泛域名')
  assert.equal(matchRewrite(rules, 'x.dev.ok1248.cn').id, 'wd', '更长的泛域后缀优先')
  assert.equal(matchRewrite(rules, 'off.ok1248.cn').id, 'w', '停用的精确规则不算,落到泛域名')
  assert.equal(matchRewrite(rules, 'ARTICLE.ok1248.cn.').id, 'e', '大小写 / 末尾点不影响')
})

test('生成:内核规则精确进 domain、泛域名进 domain_suffix(带前导点);转发名单泛域名写根域;停用的不进', () => {
  const rules = rulesOf([
    { source: 'services.googleapis.cn', domain: 'services.googleapis.com' },
    { source: '*.ok1248.cn', addresses: ['192.168.3.1'] },
    { enabled: false, source: 'off.example.com', domain: 'x.example.net' },
  ])
  assert.deepEqual(rewriteDnsRules(rules), [
    { domain: ['services.googleapis.cn'], server: DNS_REWRITE_TAG },
    { domain_suffix: ['.ok1248.cn'], server: DNS_REWRITE_TAG },
  ])
  assert.deepEqual(rewriteForwardDomains(rules), ['services.googleapis.cn', 'ok1248.cn'])
  assert.deepEqual(rewriteDnsServer(), { type: 'udp', tag: 'dns-rewrite', server: '127.0.0.1', server_port: 7854 })
  assert.deepEqual(rewriteDnsRules([]), [])
})

test('buildDns:重写规则排在所有 DNS 规则最前面,服务器在列表里;没有规则时什么都不加', () => {
  const profile = {
    ipv6: true,
    dns: { split: true, mode: 'dnsmasq', direct: '223.5.5.5', proxy: '1.1.1.1', rewrite: { initialized: 1, rules: [{ source: 'services.googleapis.cn', domain: 'services.googleapis.com' }] } },
    routing: { proxyTag: 'PROXY', policies: [], fallbackDefault: 'proxy' },
  }
  const dns = buildDns(profile, { systemDns: ['192.168.1.1'] })
  assert.deepEqual(dns.rules[0], { domain: ['services.googleapis.cn'], server: 'dns-rewrite' })
  assert.ok(dns.servers.some((s) => s.tag === 'dns-rewrite' && s.server === '127.0.0.1' && s.server_port === 7854))
  const hijack = buildDns({ ...profile, dns: { ...profile.dns, mode: 'hijack' } })
  assert.equal(hijack.rules[0].server, 'dns-rewrite', '劫持模式下也排在本地主机名规则前面')
  const none = buildDns({ ...profile, dns: { ...profile.dns, rewrite: { initialized: 1, rules: [] } } })
  assert.ok(!none.rules.some((r) => r.server === 'dns-rewrite'))
  assert.ok(!none.servers.some((s) => s.tag === 'dns-rewrite'))
  // 不分流(split=false)的精简配置同样带上
  const only = buildDns({ ...profile, dns: { ...profile.dns, split: false } })
  assert.deepEqual(only.rules[0], { domain: ['services.googleapis.cn'], server: 'dns-rewrite' })
})

test('dnsmasqForwardPlan:全直连时原本 none,有重写源域名就变成 domains 且只含它们;走代理的名单和重写名单合并', () => {
  const routing = { proxyTag: 'PROXY', policies: [], fallbackDefault: 'direct' }
  assert.equal(dnsmasqForwardPlan(routing, ['direct'], undefined, {}).mode, 'none')
  const plan = dnsmasqForwardPlan(routing, ['direct'], undefined, {}, { rewriteDomains: ['services.googleapis.cn', 'ok1248.cn'] })
  assert.equal(plan.mode, 'domains')
  assert.deepEqual(plan.domains, ['services.googleapis.cn', 'ok1248.cn'])
  const withPolicy = {
    proxyTag: 'PROXY', fallbackDefault: 'direct',
    policies: [{ id: 'p', name: 'Google', default: 'PROXY', domainSuffix: ['google.com'] }],
  }
  const plan2 = dnsmasqForwardPlan(withPolicy, ['direct', 'PROXY'], undefined, {}, { rewriteDomains: ['services.googleapis.cn'] })
  assert.equal(plan2.mode, 'domains')
  assert.ok(plan2.domains.includes('google.com') && plan2.domains.includes('services.googleapis.cn'))
})

const memStore = () => {
  const m = new Map()
  return createStore({ get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), del: (k) => m.delete(k) })
}

test('ensureDnsRewriteDefaults:没初始化过的档案补两条默认并记初始化;用户删空 / 改过之后不再回填', () => {
  const store = memStore()
  assert.equal(ensureDnsRewriteDefaults(store), true)
  let rw = normalizeDnsRewrite(store.getProfile().dns)
  assert.equal(rw.initialized, true)
  assert.deepEqual(rw.rules.map((r) => [r.id, r.source, r.domain, r.enabled]), DNS_REWRITE_DEFAULTS.map((d) => [d.id, d.source, d.domain, true]))
  // 第二次不动
  assert.equal(ensureDnsRewriteDefaults(store), false)
  // 用户清空:显式空列表保留,重启后不回填
  store.setProfile({ dns: { rewrite: { initialized: 1, rules: [] } } })
  assert.equal(ensureDnsRewriteDefaults(store), false)
  assert.deepEqual(normalizeDnsRewrite(store.getProfile().dns).rules, [])
  // 用户停用一条、改另一条的目标:原样保留
  store.setProfile({ dns: { rewrite: { initialized: 1, rules: [
    { ...DNS_REWRITE_DEFAULTS[0], enabled: false },
    { ...DNS_REWRITE_DEFAULTS[1], domain: 'developers.google.com.hk' },
  ] } } })
  assert.equal(ensureDnsRewriteDefaults(store), false)
  rw = normalizeDnsRewrite(store.getProfile().dns)
  assert.equal(rw.rules[0].enabled, false)
  assert.equal(rw.rules[1].domain, 'developers.google.com.hk')
  // 没初始化但已经有同源的用户规则(从别处导入):用户的优先,只补缺的那条
  const store2 = memStore()
  store2.setProfile({ dns: { rewrite: { rules: [{ id: 'mine', source: 'services.googleapis.cn', domain: 'my.example.com' }] } } })
  assert.equal(ensureDnsRewriteDefaults(store2), true)
  const rw2 = normalizeDnsRewrite(store2.getProfile().dns)
  assert.deepEqual(rw2.rules.map((r) => [r.id, r.domain]), [['mine', 'my.example.com'], [DNS_REWRITE_DEFAULTS[1].id, DNS_REWRITE_DEFAULTS[1].domain]])
})

test('restoreDefaultRules:只把两条默认项重置 / 补回,自定义规则原样保留;同源的自定义规则让默认项让位', () => {
  const custom = { id: 'c1', source: '*.ok1248.cn', addresses: ['192.168.3.1'] }
  const edited = { ...DNS_REWRITE_DEFAULTS[0], enabled: false, domain: 'changed.example.com' }
  const out = restoreDefaultRules([custom, edited])
  assert.deepEqual(out.map((r) => [r.id, r.source, r.domain || r.addresses.join(','), r.enabled]), [
    ['c1', '*.ok1248.cn', '192.168.3.1', true],
    [DNS_REWRITE_DEFAULTS[0].id, DNS_REWRITE_DEFAULTS[0].source, DNS_REWRITE_DEFAULTS[0].domain, true],
    [DNS_REWRITE_DEFAULTS[1].id, DNS_REWRITE_DEFAULTS[1].source, DNS_REWRITE_DEFAULTS[1].domain, true],
  ])
  const mine = { id: 'mine', source: 'developers.google.cn', domain: 'my.example.com' }
  const out2 = restoreDefaultRules([mine])
  assert.deepEqual(out2.map((r) => r.id), ['mine', DNS_REWRITE_DEFAULTS[0].id])
})
