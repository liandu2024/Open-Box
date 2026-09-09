import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDns, dnsPolicyClasses, ipv6ProxyMode } from './dns.mjs'

const base = {
  ipv6: true,
  // 站点集相关的用例与劫持方式无关,用默认的 dnsmasq 模式;hijack / off 的差异见前几条专门的用例
  dns: { split: true, mode: 'dnsmasq', direct: '223.5.5.5', proxy: '1.1.1.1' },
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
  // 代理侧解析跟着兜底站点集「其他」走(它选哪条线路就用哪条解析),明文 TCP 53:
  // 查询整段封在代理隧道里,再套一层 DoH 只是每次多一次 TLS 握手
  assert.deepEqual(dns.servers[1], { type: 'tcp', tag: 'dns-proxy', server: '1.1.1.1', detour: '其他' })
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
  assert.deepEqual(dns.servers[2], { type: 'tcp', tag: 'dns-policy-0', server: '1.1.1.1', detour: '谷歌' })
  // 规则集和手写域名拆成紧邻的两条、同一台解析器(sing-box 1.14 起规则集不再稳定地和同条里的域名条件「或」)
  assert.deepEqual(dns.rules[0], { rule_set: ['geosite-google'], server: 'dns-policy-0' })
  assert.deepEqual(dns.rules[1], { domain_suffix: ['google.com'], server: 'dns-policy-0' })
})

test('走直连的站点集用本地解析(国内站点才拿得到就近地址),不给专属解析器', () => {
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

test('内核里当前的选择优先于档案默认:默认直连但代理页切到了节点组 → 专属解析器;反之 → 本地解析', () => {
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

test('geoip 规则集不进 DNS 规则:含 IP 的规则集会让内核对每个域名先按这条查一遍再扔掉重查', () => {
  const dns = buildDns(
    withRouting({
      policies: [{ id: 'p1', name: 'Netflix', default: 'block', rulesets: ['geosite-netflix', 'geoip-netflix'] }],
    }),
    GROUPS,
  )
  assert.deepEqual(dns.rules[0], { server: 'dns-policy-0', rule_set: ['geosite-netflix'] })
})

test('只有 geoip 规则集的站点集不生成 DNS 规则,也不给专属解析器', () => {
  const dns = buildDns(
    withRouting({ policies: [{ id: 'p1', name: '电报', default: 'block', rulesets: ['geoip-telegram'] }] }),
    GROUPS,
  )
  assert.deepEqual(dns.rules, [])
  assert.equal(dns.servers.length, 2)
})

test('规则集链接:DNS 规则只引用域名那份;名单里只有 IP 的不进 DNS 规则;没有形状表就按老样子引用一份', () => {
  const routing = { policies: [{ id: 'p1', name: 'Speed', default: 'block', ruleUrls: ['https://x.test/Check.list'] }] }
  const tag = 'list-' + (() => { let h = 0x811c9dc5; for (const ch of 'https://x.test/Check.list') { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') })()
  const both = buildDns(withRouting(routing), { ...GROUPS, ruleLists: { [tag]: { domain: true, ip: true } } })
  assert.deepEqual(both.rules[0], { server: 'dns-policy-0', rule_set: [tag] })
  const ipOnly = buildDns(withRouting(routing), { ...GROUPS, ruleLists: { [tag]: { domain: false, ip: true } } })
  assert.deepEqual(ipOnly.rules, [])
  assert.equal(ipOnly.servers.length, 2)
  const unknown = buildDns(withRouting(routing), GROUPS)
  assert.deepEqual(unknown.rules[0], { server: 'dns-policy-0', rule_set: [tag] })
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

test('dnsPolicyClasses:落进 config.meta.json 的那张"谁走直连、谁走代理"表', () => {
  const routing = {
    fallbackDefault: 'proxy',
    policies: [
      { id: 'p1', name: '谷歌', default: 'block', rulesets: ['geosite-google'] },
      { id: 'p2', name: '中国', default: 'direct', rulesets: ['geosite-cn'] },
      // 只有 IP 条件:不进 DNS 规则,也就不进这张表(改它不会让规则过期)
      { id: 'p3', name: '内网', default: 'direct', ipCidr: ['10.0.0.0/8'] },
    ],
  }
  const members = ['direct', '所有-自动', 'block']
  assert.deepEqual(dnsPolicyClasses(routing, members), { 谷歌: 'proxy', 中国: 'direct', 其他: 'proxy' })
  // 内核里当前的选择优先:代理页把兜底切到直连、把「中国」切到节点组
  assert.deepEqual(
    dnsPolicyClasses(routing, members, undefined, { 其他: 'direct', 中国: '所有-自动' }),
    { 谷歌: 'proxy', 中国: 'proxy', 其他: 'direct' },
  )
})

test('前置自定义分流:每行的解析跟着这行自己的出口,同一出口共用一台解析器', () => {
  const dns = buildDns(
    withRouting({
      custom: {
        rules: [
          { type: 'domainSuffix', value: 'openai.com', outbound: 'VW | 香港-01' },
          { type: 'domainSuffix', value: 'chat.com', outbound: 'VW | 香港-01' },
          { type: 'domain', value: 'netflix.com', outbound: 'VW | 美国-01' },
        ],
      },
    }),
    { groupTags: ['direct', '香港-自动'] },
  )
  const customServers = dns.servers.filter((x) => x.tag.startsWith('dns-custom'))
  assert.deepEqual(customServers.map((x) => x.detour), ['VW | 香港-01', 'VW | 美国-01'])
  assert.equal(customServers[0].type, 'tcp')
  // 前两行共用第一台,第三行用第二台
  const mine = dns.rules.filter((r) => String(r.server).startsWith('dns-custom'))
  assert.deepEqual(mine, [
    { domain_suffix: ['openai.com'], server: 'dns-custom-0' },
    { domain_suffix: ['chat.com'], server: 'dns-custom-0' },
    { domain: ['netflix.com'], server: 'dns-custom-1' },
  ])
})

test('前置自定义分流:出口是直连的行用直连侧解析,不另开解析器', () => {
  const dns = buildDns(
    withRouting({ custom: { rules: [{ type: 'domainSuffix', value: 'cn.example', outbound: 'direct' }] } }),
    { groupTags: ['direct'] },
  )
  assert.ok(!dns.servers.some((x) => x.tag.startsWith('dns-custom')))
  assert.ok(dns.rules.some((r) => r.server === 'dns-direct' && r.domain_suffix?.includes('cn.example')))
})

test('前置自定义分流:只按 IP 匹配的行不进 DNS(解析时还没有 IP)', () => {
  const dns = buildDns(
    withRouting({
      custom: {
        rules: [
          { type: 'ipCidr', value: '1.2.3.0/24', outbound: 'VW | 香港-01' },
          { type: 'geoip', value: 'cn', outbound: 'direct' },
          { type: 'port', value: '51820', outbound: 'VW | 香港-01' },
        ],
      },
    }),
    { groupTags: ['direct'] },
  )
  assert.ok(!dns.servers.some((x) => x.tag.startsWith('dns-custom')))
  assert.ok(!dns.rules.some((r) => r.ip_cidr || r.port || r.port_range))
})

// ---------- 第一层整改:顺序、拒绝、终端来源 ----------
test('DNS 规则顺序和连接侧一致:前置自定义分流 → 直连站点 → 终端分流 → 广告拦截 → 站点集(审核 B4)', () => {
  const dns = buildDns(
    withRouting({
      adBlock: true,
      custom: { rules: [{ type: 'domainSuffix', value: 'allowed.example', outbound: 'HK' }] },
      policies: [{ id: 'p', name: 'P', default: 'HK', domainSuffix: ['p.example'] }],
    }, { dns: { ...base.dns, mode: 'hijack' } }),
    { groupTags: ['HK'], directHosts: { domains: ['node.example.com'], cidrs: [] }, clientRoutes: [{ sources: ['192.168.3.9/32'], outbound: 'direct' }] },
  )
  const at = (pred) => dns.rules.findIndex(pred)
  const custom = at((r) => r.domain_suffix && r.domain_suffix[0] === 'allowed.example')
  const hosts = at((r) => r.domain && r.domain.includes('node.example.com'))
  const client = at((r) => r.source_ip_cidr)
  const ad = at((r) => r.action === 'reject' && r.rule_set)
  const site = at((r) => r.domain_suffix && r.domain_suffix[0] === 'p.example')
  assert.ok(custom >= 0 && custom < hosts && hosts < client && client < ad && ad < site, JSON.stringify(dns.rules))
})

test('前置自定义分流出口是拒绝的行:解析也拒,不再当直连解析', () => {
  const dns = buildDns(withRouting({ custom: { rules: [{ type: 'domain', value: 'bad.example', outbound: 'block' }] } }), { groupTags: [] })
  assert.deepEqual(dns.rules.find((r) => r.domain && r.domain[0] === 'bad.example'), { domain: ['bad.example'], action: 'reject' })
})

test('终端分流(劫持模式):指定来源的终端,解析跟着它的出口——直连终端用直连解析器,走节点的终端专属解析器,缓存各自独立(审核 B3)', () => {
  const dns = buildDns(
    withRouting({ policies: [{ id: 'y', name: 'Youtube', default: 'HK', domainSuffix: ['youtube.com'] }] }, { dns: { ...base.dns, mode: 'hijack' } }),
    {
      groupTags: ['HK', 'US'],
      knownOutbounds: new Set(['HK', 'US', 'direct', 'block', 'VW | 美国-01']),
      clientRoutes: [
        { sources: ['192.168.1.10/32', '2001:db8::10/128'], outbound: 'direct' },
        { sources: ['192.168.1.20/32'], outbound: 'US' },
        { sources: ['192.168.1.30/32'], outbound: 'VW | 美国-01' },   // 直接指到节点也行
        { sources: ['192.168.1.40/32'], outbound: 'block' },
        { sources: ['192.168.1.50/32'], outbound: '已删掉的组' },        // 出口不存在:丢掉
      ],
    },
  )
  const src = dns.rules.filter((r) => r.source_ip_cidr)
  assert.deepEqual(src, [
    { source_ip_cidr: ['192.168.1.10/32', '2001:db8::10/128'], server: 'dns-direct' },
    { source_ip_cidr: ['192.168.1.20/32'], server: 'dns-client-0' },
    { source_ip_cidr: ['192.168.1.30/32'], server: 'dns-client-1' },
    { source_ip_cidr: ['192.168.1.40/32'], action: 'reject' },
  ])
  assert.equal(dns.servers.find((s) => s.tag === 'dns-client-0').detour, 'US')
  assert.equal(dns.servers.find((s) => s.tag === 'dns-client-1').detour, 'VW | 美国-01')
  // 1.14 起缓存本来就按解析器分,弃用的 independent_cache 不再写
  assert.equal(dns.independent_cache, undefined)
  // 终端规则排在站点集之前:直连终端查 youtube.com 也用直连解析,和它的连接一致
  const client = dns.rules.findIndex((r) => r.source_ip_cidr)
  const site = dns.rules.findIndex((r) => r.domain_suffix && r.domain_suffix[0] === 'youtube.com')
  assert.ok(client < site)
})

test('终端分流(dnsmasq 转发模式):内核看不到终端来源,不生成来源规则、不开独立缓存——这是明确的限制,不是漏了', () => {
  const dns = buildDns(withRouting({}), { groupTags: ['HK'], knownOutbounds: new Set(['HK']), clientRoutes: [{ sources: ['192.168.1.20/32'], outbound: 'HK' }] })
  assert.ok(!dns.rules.some((r) => r.source_ip_cidr))
  assert.equal(dns.independent_cache, undefined)
})

test('FakeIP 原型(dns.fakeIpForProxy):走代理的匹配先给 A / AAAA 一条占位地址规则,其它类型仍走代理侧解析器;直连和拒绝不变;兜底走代理时收尾也发占位地址', () => {
  const routing = {
    policies: [
      { id: 'g', name: '谷歌', default: '所有-自动', rulesets: ['geosite-google'] },
      { id: 'cn', name: '国内', default: 'direct', rulesets: ['geosite-cn'] },
    ],
    custom: { rules: [{ type: 'domainSuffix', value: 'x.test', outbound: '所有-自动' }, { type: 'domainSuffix', value: 'ad.test', outbound: 'block' }] },
    fallbackDefault: 'proxy',
  }
  const on = buildDns({ ...withRouting(routing), dns: { ...base.dns, fakeIpForProxy: true } }, GROUPS)
  const fake = on.servers.find((s) => s.type === 'fakeip')
  assert.deepEqual(fake, { type: 'fakeip', tag: 'dns-fakeip', inet4_range: '198.18.0.0/15', inet6_range: 'fc00::/18' })
  // 自定义代理行:占位规则在真解析器规则前面,且只管 A / AAAA
  assert.deepEqual(on.rules[0], { domain_suffix: ['x.test'], query_type: ['A', 'AAAA'], server: 'dns-fakeip' })
  assert.deepEqual(on.rules[1], { domain_suffix: ['x.test'], server: 'dns-custom-0' })
  // 拒绝行照旧拒绝,不发占位地址
  assert.deepEqual(on.rules[2], { domain_suffix: ['ad.test'], action: 'reject' })
  // 站点集:走代理的先占位,直连的照旧真实解析
  assert.deepEqual(on.rules[3], { rule_set: ['geosite-google'], query_type: ['A', 'AAAA'], server: 'dns-fakeip' })
  assert.deepEqual(on.rules[4], { server: 'dns-policy-0', rule_set: ['geosite-google'] })
  assert.deepEqual(on.rules[5], { server: 'dns-direct', rule_set: ['geosite-cn'] })
  // 兜底走代理:没命中的域名 A / AAAA 也占位;final 仍是代理侧解析器(其它查询类型)
  assert.deepEqual(on.rules[6], { query_type: ['A', 'AAAA'], server: 'dns-fakeip' })
  assert.equal(on.final, 'dns-proxy')
  // 没开 IPv6 就不给 v6 占位段
  const v4 = buildDns({ ...withRouting(routing), ipv6: false, dns: { ...base.dns, fakeIpForProxy: true } }, GROUPS)
  assert.deepEqual(v4.servers.find((s) => s.type === 'fakeip'), { type: 'fakeip', tag: 'dns-fakeip', inet4_range: '198.18.0.0/15' })
  // 兜底直连:收尾不占位
  const fbDirect = buildDns({ ...withRouting({ ...routing, fallbackDefault: 'direct' }), dns: { ...base.dns, fakeIpForProxy: true } }, GROUPS)
  assert.ok(!fbDirect.rules.some((r) => r.server === 'dns-fakeip' && !r.rule_set && !r.domain_suffix))
  // 关着(默认):一条占位规则、一台 fakeip 服务器都没有
  const off = buildDns(withRouting(routing), GROUPS)
  assert.ok(!off.servers.some((s) => s.type === 'fakeip'))
  assert.ok(!off.rules.some((r) => r.server === 'dns-fakeip'))
})

test('FakeIP 原型:指定终端走代理的来源规则(hijack 模式)也先占位', () => {
  const dns = buildDns(
    { ...withRouting({ fallbackDefault: 'direct' }), dns: { ...base.dns, mode: 'hijack', fakeIpForProxy: true }, clientRoutes: [{ id: 'a', name: 'a', sources: ['192.168.1.9'], outbound: '所有-自动' }] },
    { ...GROUPS, clientRoutes: [{ sources: ['192.168.1.9/32'], outbound: '所有-自动' }] },
  )
  const i = dns.rules.findIndex((r) => r.source_ip_cidr && r.server === 'dns-fakeip')
  assert.ok(i >= 0)
  assert.deepEqual(dns.rules[i].query_type, ['A', 'AAAA'])
  assert.equal(dns.rules[i + 1].server, 'dns-client-0')
})

test('IPv6 分层 · 代理 v6 降为 IPv4(ipv6 开 + ipv6Proxy=ipv4):走代理的规则前面一条 predefined 把 AAAA 回空(1.14 不认遗留的 strategy),直连规则照常;兜底走代理时 AAAA 也回空;FakeIP 不给 v6 占位段、只管 A', () => {
  const routing = {
    policies: [
      { id: 'g', name: '谷歌', default: '所有-自动', rulesets: ['geosite-google'] },
      { id: 'cn', name: '国内', default: 'direct', rulesets: ['geosite-cn'] },
    ],
    fallbackDefault: 'proxy',
  }
  const split = buildDns({ ...withRouting(routing), ipv6: true, ipv6Proxy: 'ipv4' }, GROUPS)
  assert.equal(split.strategy, 'prefer_ipv4')                       // 全局(直连侧)仍然双栈
  assert.deepEqual(split.rules[0], { rule_set: ['geosite-google'], query_type: ['AAAA'], action: 'predefined', rcode: 'NOERROR' })
  assert.deepEqual(split.rules[1], { rule_set: ['geosite-google'], server: 'dns-policy-0' })
  assert.deepEqual(split.rules[2], { server: 'dns-direct', rule_set: ['geosite-cn'] })
  assert.deepEqual(split.rules.at(-1), { query_type: ['AAAA'], action: 'predefined', rcode: 'NOERROR' })
  assert.equal(split.final, 'dns-proxy')
  // 遗留的 strategy 动作一条都不写:1.14 里它和 query_type 不能出现在同一份 DNS 配置里(启动 FATAL)
  assert.ok(!split.rules.some((r) => r.strategy))
  // 兜底直连:没有那条 AAAA 收尾
  const fbDirect = buildDns({ ...withRouting({ ...routing, fallbackDefault: 'direct' }), ipv6: true, ipv6Proxy: 'ipv4' }, GROUPS)
  assert.ok(!fbDirect.rules.some((r) => r.query_type && !r.rule_set))
  // node(默认)/ ipv6 关着:一条 AAAA 回空都不写
  const node = buildDns({ ...withRouting(routing), ipv6: true, ipv6Proxy: 'node' }, GROUPS)
  assert.ok(!node.rules.some((r) => r.strategy || r.action === 'predefined'))
  const off = buildDns({ ...withRouting(routing), ipv6: false, ipv6Proxy: 'ipv4' }, GROUPS)
  assert.ok(!off.rules.some((r) => r.strategy || r.action === 'predefined'))
  assert.equal(off.strategy, 'ipv4_only')
  // FakeIP + 降为 IPv4:占位服务器没有 inet6_range;每个走代理的匹配是 AAAA 回空 → 占位(只管 A)→ 真实解析器,
  // 兜底同样先回空 AAAA 再占位 A
  const fake = buildDns({ ...withRouting(routing), ipv6: true, ipv6Proxy: 'ipv4', dns: { ...base.dns, fakeIpForProxy: true } }, GROUPS)
  assert.deepEqual(fake.servers.find((s) => s.type === 'fakeip'), { type: 'fakeip', tag: 'dns-fakeip', inet4_range: '198.18.0.0/15' })
  const fakeGoogle = fake.rules.filter((r) => r.rule_set && r.rule_set[0] === 'geosite-google')
  assert.deepEqual(fakeGoogle.map((r) => r.action || r.server), ['predefined', 'dns-fakeip', 'dns-policy-0'])
  assert.deepEqual(fakeGoogle[1].query_type, ['A'])
  assert.deepEqual(fake.rules.slice(-2), [{ query_type: ['AAAA'], action: 'predefined', rcode: 'NOERROR' }, { query_type: ['A'], server: 'dns-fakeip' }])
  const fakeNode = buildDns({ ...withRouting(routing), ipv6: true, ipv6Proxy: 'node', dns: { ...base.dns, fakeIpForProxy: true } }, GROUPS)
  assert.equal(fakeNode.servers.find((s) => s.type === 'fakeip').inet6_range, 'fc00::/18')
})

test('ipv6ProxyMode:关着 off、默认 node、降级 ipv4、不进内核 bypass;bypass 的 DNS 和 node 一样双栈、不回空 AAAA', () => {
  assert.equal(ipv6ProxyMode({ ipv6: false, ipv6Proxy: 'bypass' }), 'off')
  assert.equal(ipv6ProxyMode({ ipv6: true }), 'node')
  assert.equal(ipv6ProxyMode({ ipv6: true, ipv6Proxy: 'ipv4' }), 'ipv4')
  assert.equal(ipv6ProxyMode({ ipv6: true, ipv6Proxy: 'bypass' }), 'bypass')
  const routing = { policies: [{ id: 'g', name: '谷歌', default: '所有-自动', rulesets: ['geosite-google'] }], fallbackDefault: 'proxy' }
  const bypass = buildDns({ ...withRouting(routing), ipv6: true, ipv6Proxy: 'bypass' }, GROUPS)
  assert.equal(bypass.strategy, 'prefer_ipv4')
  assert.ok(!bypass.rules.some((r) => r.action === 'predefined' || r.strategy))
})

test('F2:IPv6 不进内核(bypass)+ FakeIP:占位只管 A,AAAA 继续交给真实解析器(逐策略和兜底都是);node 模式 A/AAAA 都占位;ipv4 模式 AAAA 回空', () => {
  const routing = { policies: [{ id: 'g', name: '谷歌', default: '所有-自动', rulesets: ['geosite-google'] }], fallbackDefault: 'proxy' }
  const fake = (over) => buildDns({ ...withRouting(routing), ipv6: true, dns: { ...base.dns, fakeIpForProxy: true }, ...over }, GROUPS)
  const bypass = fake({ ipv6Proxy: 'bypass' })
  const rulesFor = (dns) => dns.rules.filter((r) => r.rule_set && r.rule_set[0] === 'geosite-google')
  assert.deepEqual(rulesFor(bypass).map((r) => [r.server || r.action, r.query_type || null]), [['dns-fakeip', ['A']], ['dns-policy-0', null]])
  assert.deepEqual(bypass.rules.at(-1), { query_type: ['A'], server: 'dns-fakeip' })
  assert.equal(bypass.servers.find((s) => s.type === 'fakeip').inet6_range, undefined)
  assert.ok(!bypass.rules.some((r) => r.action === 'predefined'))
  const node = fake({ ipv6Proxy: 'node' })
  assert.deepEqual(rulesFor(node)[0].query_type, ['A', 'AAAA'])
  assert.deepEqual(node.rules.at(-1), { query_type: ['A', 'AAAA'], server: 'dns-fakeip' })
  const v4 = fake({ ipv6Proxy: 'ipv4' })
  assert.deepEqual(rulesFor(v4).map((r) => [r.server || r.action, r.query_type || null]), [['predefined', ['AAAA']], ['dns-fakeip', ['A']], ['dns-policy-0', null]])
})
