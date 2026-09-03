import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDns } from './dns.mjs'

const base = {
  ipv6: true,
  // 站点集相关的用例与劫持方式无关,用默认的 dnsmasq 模式;hijack / off 的差异见前几条专门的用例
  dns: { split: true, mode: 'dnsmasq', direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' },
  // fallbackDefault 写着就说明这份档案已经迁过地区了(见 engine/routing-model.mjs)
  routing: { proxyTag: 'PROXY', policies: [], fallbackDefault: 'proxy' },
}
const withRouting = (routing, over = {}) => ({ ...base, ...over, routing: { ...base.routing, ...routing } })

test('hijack 模式:直连侧也用 WAN 上游而不是 local(local 会经 dnsmasq 绕回局域网里的 AdGuard 形成回环);本地主机名单独交给 local', () => {
  const dns = buildDns({ ...base, dns: { ...base.dns, mode: 'hijack' } }, { systemDns: ['192.168.1.1', '8.8.8.8'] })
  assert.deepEqual(dns.servers[0], { type: 'udp', tag: 'dns-direct', server: '192.168.1.1' })
  assert.ok(dns.servers.some((s) => s.type === 'local' && s.tag === 'dns-local'))
  assert.deepEqual(dns.rules[0], { domain_suffix: ['.lan', '.local', '.home', '.internal', '.home.arpa'], server: 'dns-local' })
  assert.deepEqual(dns.rules[1], { domain_regex: ['^[^.]+$'], server: 'dns-local' })
})

test('off 模式:直连侧同样用 WAN 上游,不再有 local 与本地主机名规则', () => {
  const dns = buildDns({ ...base, dns: { ...base.dns, mode: 'off' } }, { systemDns: ['192.168.1.1'] })
  assert.deepEqual(dns.servers[0], { type: 'udp', tag: 'dns-direct', server: '192.168.1.1' })
  assert.ok(!dns.servers.some((s) => s.type === 'local'))
  assert.ok(!dns.rules.some((r) => r.server === 'dns-local'))
})

test('hijack 模式读不到 WAN 上游时退回档案里填的那台', () => {
  const dns = buildDns({ ...base, dns: { ...base.dns, mode: 'hijack' } })
  assert.deepEqual(dns.servers[0], { type: 'udp', tag: 'dns-direct', server: '223.5.5.5' })
})

test('dnsmasq 模式不能用 local(会绕回 dnsmasq 死循环),改用 WAN 下发的上游', () => {
  const dns = buildDns({ ...base, dns: { ...base.dns, mode: 'dnsmasq' } }, { systemDns: ['192.168.1.1', '8.8.8.8'] })
  // 不带 detour:显式 detour:'direct' 会在启动时被内核拒绝(check 查不出来)
  assert.deepEqual(dns.servers[0], { type: 'udp', tag: 'dns-direct', server: '192.168.1.1' })
})

test('dnsmasq 模式读不到系统上游时,回落到档案里填的那台', () => {
  const dns = buildDns({ ...base, dns: { ...base.dns, mode: 'dnsmasq' } })
  assert.equal(dns.servers[0].server, '223.5.5.5')
})

// 成员表现在整份来自「节点管理」(内置直连/拒绝 + 节点组),用例里要把它们都给出来
const GROUPS = { groupTags: ['direct', '所有-自动', 'block'] }

test('兜底走代理时,没被站点集挑走的域名用代理侧解析', () => {
  const dns = buildDns(base, GROUPS)
  // 代理侧解析跟着兜底站点集「其他」走(它选哪条线路就用哪条解析)
  assert.deepEqual(dns.servers[1], { type: 'https', tag: 'dns-proxy', server: '1.1.1.1', detour: '其他' })
  assert.equal(dns.final, 'dns-proxy')
})

test('兜底直连时,兜底的解析也回到本地', () => {
  const dns = buildDns(withRouting({ fallbackDefault: 'direct' }), GROUPS)
  assert.equal(dns.final, 'dns-direct')
})

test('走代理的站点集各有一台自己的 DNS,detour 指向同名 selector', () => {
  const dns = buildDns(
    withRouting({
      policies: [{ id: 'p1', name: '谷歌', default: 'block', rulesets: ['geosite-google'], domainSuffix: ['google.com'] }],
    }),
    GROUPS,
  )
  assert.deepEqual(dns.servers[2], { type: 'https', tag: 'dns-policy-0', server: '1.1.1.1', detour: '谷歌' })
  assert.deepEqual(dns.rules[0], {
    server: 'dns-policy-0',
    rule_set: ['geosite-google'],
    domain_suffix: ['google.com'],
  })
})

test('走直连的站点集用本地解析(国内站点才拿得到就近地址),不给专属 DoH', () => {
  const dns = buildDns(
    withRouting({
      policies: [{ id: 'p1', name: '中国', default: 'direct', rulesets: ['geosite-cn'] }],
    }),
  )
  assert.deepEqual(dns.rules[0], { server: 'dns-direct', rule_set: ['geosite-cn'] })
  assert.equal(dns.servers.length, 2)
})

test('default 空着、内核没在跑时按成员表第一项算(直连)', () => {
  const dns = buildDns(withRouting({ policies: [{ id: 'p1', name: 'x', rulesets: ['geosite-x'] }] }))
  assert.deepEqual(dns.rules[0], { server: 'dns-direct', rule_set: ['geosite-x'] })
})

test('内核里当前的选择优先于档案默认:默认直连但代理页切到了节点组 → 专属 DoH;反之 → 本地解析', () => {
  const routing = {
    fallbackDefault: 'direct',
    policies: [
      { id: 'p1', name: '谷歌', default: 'direct', rulesets: ['geosite-google'] },
      { id: 'p2', name: '中国', default: 'block', rulesets: ['geosite-cn'] },
    ],
  }
  const selections = { 谷歌: '香港-自动', '香港-自动': 'HK-01', 中国: 'direct', 其他: '香港-自动' }
  const dns = buildDns(withRouting(routing), { ...GROUPS, selections })
  assert.deepEqual(dns.rules[0], { server: 'dns-policy-0', rule_set: ['geosite-google'] })
  assert.deepEqual(dns.rules[1], { server: 'dns-direct', rule_set: ['geosite-cn'] })
  assert.equal(dns.final, 'dns-proxy')
})

test('只有 IP 条件的站点集不进 DNS 规则:解析阶段还没有 IP,写进去只会让人以为生效了', () => {
  const dns = buildDns(withRouting({ policies: [{ id: 'p1', name: '内网', ipCidr: ['10.0.0.0/8'] }] }))
  assert.deepEqual(dns.rules, [])
  assert.equal(dns.servers.length, 2)
})

test('广告拦截排在所有站点集之前', () => {
  const dns = buildDns(
    withRouting({ adBlock: true, policies: [{ id: 'p1', name: '谷歌', default: 'block', rulesets: ['geosite-google'] }] }),
  )
  assert.deepEqual(dns.rules[0], { rule_set: 'geosite-category-ads-all', action: 'reject' })
})

test('分流 DNS 关掉时只剩一条直连通道', () => {
  const dns = buildDns({ ...base, dns: { ...base.dns, split: false } })
  assert.equal(dns.servers.length, 1)
  assert.equal(dns.final, 'dns-direct')
  assert.ok(!dns.rules)
})

test('reverse_mapping 恒开:按 IP 连的客户端也能命中域名规则', () => {
  assert.equal(buildDns(base).reverse_mapping, true)
  assert.equal(buildDns({ ...base, dns: { ...base.dns, split: false } }).reverse_mapping, true)
})

test('ipv6 关:strategy=ipv4_only', () => {
  assert.equal(buildDns({ ...base, ipv6: false }).strategy, 'ipv4_only')
})


test('一个节点组都没有时,兜底的「走代理」只能落回直连:不能指向内核里不存在的出站', () => {
  const dns = buildDns(base)
  assert.equal(dns.final, 'dns-direct')
})
