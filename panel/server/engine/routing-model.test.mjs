import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CUSTOM_POLICY_NAME,
  FALLBACK_TAG,
  collectRuleListUrls,
  customPolicyActive,
  customRuleTag,
  dnsmasqForwardDomains,
  effectiveOutbound,
  normalizeRouting,
  policyOutboundOptions,
  parsePortSpec,
  dnsmasqForwardPlan,
  nativeBypassPlan,
  policyClasses,
  bypassPlanKey,
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

test('成员表:按节点管理的顺序,停用的内置出站被去掉,一个都不剩时回落直连', () => {
  const tags = ['direct', ...GROUPS, 'block']
  assert.deepEqual(policyOutboundOptions({}, tags), tags)
  // 老档案里「出站」页签存下的 groups:false 不再有意义,节点组永远在
  assert.deepEqual(policyOutboundOptions({ groups: false }, tags), tags)
  const off = { direct: 'direct', block: 'block', directEnabled: false, blockEnabled: false }
  assert.deepEqual(policyOutboundOptions({}, tags, off), [...GROUPS])
  assert.deepEqual(policyOutboundOptions({}, [], off), ['direct'])
  // 内置出站改了名,占位 'direct' 要换算成当时的名字
  const renamed = { direct: '国内直出', block: '拦截', directEnabled: true, blockEnabled: true }
  assert.equal(effectiveOutbound('direct', ['国内直出', ...GROUPS, '拦截'], renamed), '国内直出')
  assert.equal(effectiveOutbound('block', ['国内直出', ...GROUPS, '拦截'], renamed), '拦截')
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

test('全都直连时一个域名都不转发(none),不再"全量转发更简单":原 DNS 原样(审核 B2)', () => {
  const plan = dnsmasqForwardPlan({ fallbackDefault: 'direct', policies: [{ id: 'b', name: '中国', default: 'direct', rulesets: ['geosite-cn'] }] }, MEMBERS)
  assert.equal(plan.mode, 'none')
  assert.deepEqual(plan.domains, [])
  // 老接口对 none 也回空数组
  assert.deepEqual(forward({ fallbackDefault: 'direct', policies: [] }), [])
})

test('转发计划把三种情况分开:none / domains / all,并说明为什么只能全量(审核 B1 B2)', () => {
  const domains = dnsmasqForwardPlan({
    fallbackDefault: 'direct',
    policies: [{ id: 'a', name: '谷歌', default: '香港-自动', domainSuffix: ['google.com'] }],
    // 前置自定义分流里走代理的域名行也要进名单(以前漏掉,DNS 和连接走不同出口)
    custom: { rules: [
      { type: 'domainSuffix', value: 'openai.com', outbound: '所有-自动' },
      { type: 'domain', value: 'api.example.com', outbound: '香港-自动' },
      { type: 'domainSuffix', value: 'wan.family', outbound: 'direct' },   // 直连的不进名单
      { type: 'ipCidr', value: '10.77.0.0/16', outbound: '香港-自动' },     // 解析阶段用不上,跳过
      { type: 'port', value: '51820', outbound: 'direct' },
    ] },
  }, MEMBERS)
  assert.equal(domains.mode, 'domains')
  assert.deepEqual([...domains.domains].sort(), ['api.example.com', 'google.com', 'openai.com'])

  const kw = dnsmasqForwardPlan({ fallbackDefault: 'direct', custom: { rules: [{ type: 'domainKeyword', value: 'google', outbound: '香港-自动' }] } }, MEMBERS)
  assert.equal(kw.mode, 'all')
  assert.match(kw.reason, /域名关键词/)
  // 规则集(geosite / 规则集链接)不再自动等于 all:记进 expand,部署时解码成域名(system/dns-forward.mjs)
  const url = dnsmasqForwardPlan({ fallbackDefault: 'direct', policies: [{ id: 'a', name: 'x', default: '香港-自动', ruleUrls: ['https://e.com/l.txt'], rulesets: ['geosite-google', 'geoip-google'] }] }, MEMBERS)
  assert.equal(url.mode, 'domains')
  assert.deepEqual(url.expand.map((x) => x.tag).sort(), ['geosite-google', 'list-' + url.expand.find((x) => x.tag.startsWith('list-')).tag.slice(5)])
  assert.ok(url.expand.every((x) => x.owner === '站点集「x」'))
  assert.ok(!url.expand.some((x) => x.tag === 'geoip-google'), 'geoip 解析阶段用不上,不展开')
  // 中文域名按 IDNA 规范化进名单;写不进 dnsmasq 的直接 all(第三轮 S3:不留到应用阶段悄悄降级)
  const idna = dnsmasqForwardPlan({ fallbackDefault: 'direct', custom: { rules: [{ type: 'domain', value: '中文.example', outbound: '香港-自动' }] } }, MEMBERS)
  assert.deepEqual(idna, { mode: 'domains', domains: ['xn--fiq228c.example'], expand: [], reason: '' })
  const badName = dnsmasqForwardPlan({ fallbackDefault: 'direct', custom: { rules: [{ type: 'domain', value: 'a/#b.example', outbound: '香港-自动' }] } }, MEMBERS)
  assert.equal(badName.mode, 'all')
  assert.match(badName.reason, /写不进 dnsmasq/)
  const fb = dnsmasqForwardPlan({ fallbackDefault: 'proxy', policies: [] }, MEMBERS)
  assert.equal(fb.mode, 'all')
  assert.match(fb.reason, /兜底/)
})

test('原生旁路计划:走直连的站点集里的 geoip 集合进入口旁路;有前置分流 / 走代理的终端 / 广告拦截时不开并说明原因', () => {
  const routing = {
    fallbackDefault: 'direct',
    policies: [
      { id: 'cn', name: '国内', default: 'direct', rulesets: ['geosite-cn', 'geoip-cn', 'geoip-private'] },
      { id: 'g', name: '谷歌', default: '香港-自动', rulesets: ['geosite-google', 'geoip-google'] },   // 走代理的 geoip 不进
      { id: 'ms', name: '微软', default: 'direct', domainSuffix: ['microsoft.com'] },                 // 没有 geoip
    ],
  }
  const on = nativeBypassPlan(routing, { members: MEMBERS })
  // 计划阶段按集合名字收候选,不按名字特判;geoip-private 含到地址空间末尾的区间,由部署时的内容校验剔掉
  // (system/native-bypass.mjs)
  assert.deepEqual(on, { enabled: true, sets: ['geoip-cn', 'geoip-private'], pending: [], fakeIp: false, reason: '' })
  // 代理页把「国内」切到代理:它的集合就不能旁路了
  assert.equal(nativeBypassPlan(routing, { members: MEMBERS, selections: { '国内': '香港-自动' } }).enabled, false)
  const custom = nativeBypassPlan({ ...routing, custom: { rules: [{ type: 'domainSuffix', value: 'a.cn', outbound: '香港-自动' }] } }, { members: MEMBERS })
  assert.equal(custom.enabled, false)
  assert.match(custom.reason, /前置自定义分流/)
  const cr = nativeBypassPlan(routing, { members: MEMBERS, clientRoutes: [{ sources: ['192.168.3.9/32'], outbound: '香港-自动' }] })
  assert.equal(cr.enabled, false)
  assert.match(cr.reason, /终端/)
  // 指定终端走直连不影响
  assert.equal(nativeBypassPlan(routing, { members: MEMBERS, clientRoutes: [{ sources: ['192.168.3.9/32'], outbound: 'direct' }] }).enabled, true)
  const ad = nativeBypassPlan({ ...routing, adBlock: true }, { members: MEMBERS })
  assert.equal(ad.enabled, false)
  assert.match(ad.reason, /广告/)
  const none = nativeBypassPlan({ fallbackDefault: 'direct', policies: [routing.policies[2]] }, { members: MEMBERS })
  assert.equal(none.enabled, false)
  assert.match(none.reason, /没有 geoip/)
})

test('原生旁路 · 真实 IP 基准(第四轮):较早的纯 IP 代理 / 拒绝规则可以核对重叠(pending),较早的域名规则一律挡住;前置自定义分流按行的类型分;改名 / 换出口 / 任意规则集名都只看配置', () => {
  // 较早的纯 IP 代理站点集:候选留 pending,核对对象带上名字 + 集合 + CIDR
  const ipFirst = { fallbackDefault: 'direct', policies: [
    { id: 't', name: '随便叫什么', default: '香港-自动', rulesets: ['geoip-anything'], ipCidr: ['1.2.3.0/24'] },
    { id: 'b', name: '用户直连集合', default: 'direct', rulesets: ['geoip-user'] },
  ] }
  const p = nativeBypassPlan(ipFirst, { members: MEMBERS })
  assert.equal(p.enabled, false)
  assert.deepEqual(p.sets, [])
  assert.deepEqual(p.pending, [{ policy: '用户直连集合', sets: ['geoip-user'], against: [{ name: '随便叫什么', geoip: ['geoip-anything'], cidrs: ['1.2.3.0/24'] }] }])
  assert.match(p.reason, /用户直连集合.*随便叫什么.*核对重叠/)
  // 拒绝出口同理(按出口类型,不按名字)
  const blockFirst = nativeBypassPlan({ ...ipFirst, policies: [{ ...ipFirst.policies[0], default: 'block' }, ipFirst.policies[1]] }, { members: MEMBERS })
  assert.equal(blockFirst.pending.length, 1)
  // 较早的代理站点集带域名条件(域名 / 后缀 / 关键词 / geosite):解析出来的 IP 在入口分不出来 → 挡住
  for (const cond of [{ domainSuffix: ['x.test'] }, { domainKeyword: ['x'] }, { rulesets: ['geosite-x'] }, { rulesets: ['geoip-x', 'geosite-x'] }]) {
    const r = nativeBypassPlan({ fallbackDefault: 'direct', policies: [{ id: 'a', name: '前面的', default: '香港-自动', ...cond }, ipFirst.policies[1]] }, { members: MEMBERS })
    assert.equal(r.enabled, false, JSON.stringify(cond))
    assert.deepEqual(r.pending, [])
    assert.match(r.reason, /用户直连集合.*前面的/)
  }
  // 前置自定义分流:ip_cidr / geoip 行 → 核对;域名行 → 挡住;端口 / 规则集行 → 不开
  const custom = (rule) => nativeBypassPlan({ ...ipFirst, policies: [ipFirst.policies[1]], custom: { rules: [rule] } }, { members: MEMBERS })
  assert.deepEqual(custom({ type: 'ipCidr', value: '10.9.0.0/16', outbound: '香港-自动' }).pending[0].against, [{ name: '前置自定义分流', geoip: [], cidrs: ['10.9.0.0/16'] }])
  assert.deepEqual(custom({ type: 'geoip', value: 'xx', outbound: 'block' }).pending[0].against, [{ name: '前置自定义分流', geoip: ['geoip-xx'], cidrs: [] }])
  assert.match(custom({ type: 'domainSuffix', value: 'a.cn', outbound: '香港-自动' }).reason, /前置自定义分流.*域名/)
  assert.match(custom({ type: 'port', value: '443', outbound: '香港-自动' }).reason, /端口/)
  assert.match(custom({ type: 'ruleUrl', value: 'https://x.test/a.list', outbound: '香港-自动' }).reason, /规则集链接/)
  // 前置直连行不影响
  assert.equal(custom({ type: 'ipCidr', value: '10.9.0.0/16', outbound: 'direct' }).enabled, true)
  // 切换:把较早的纯 IP 站点集切到直连,候选不用核对了;把候选切到代理,候选没了
  assert.deepEqual(nativeBypassPlan(ipFirst, { members: MEMBERS, selections: { 随便叫什么: 'direct' } }).sets, ['geoip-anything', 'geoip-user'])
  assert.equal(nativeBypassPlan(ipFirst, { members: MEMBERS, selections: { 用户直连集合: '香港-自动' } }).enabled, false)
  // 顺序:候选在前、纯 IP 代理在后 → 直接成立(首条命中本来就是候选)
  assert.deepEqual(nativeBypassPlan({ fallbackDefault: 'direct', policies: [ipFirst.policies[1], ipFirst.policies[0]] }, { members: MEMBERS }).sets, ['geoip-user'])
})

test('policyClasses / bypassPlanKey:所有站点集(含兜底、纯 IP 的)此刻的出口类别一张表;计划指纹连核对对象一起比(第四轮 T2 / T3)', () => {
  const routing = { fallbackDefault: 'direct', policies: [
    { id: 'a', name: '前置甲', ipCidr: ['1.2.3.0/24'], default: '香港-自动' },
    { id: 'b', name: '前置乙', ipCidr: ['9.9.9.0/24'], default: 'direct' },
    { id: 'c', name: '后置直连', rulesets: ['geoip-audit'], default: 'direct' },
    { id: 'd', name: '拒绝的', domainSuffix: ['x.test'], default: 'block' },
  ] }
  assert.deepEqual(policyClasses(routing, MEMBERS), { 前置甲: 'proxy', 前置乙: 'direct', 后置直连: 'direct', 拒绝的: 'block', 其他: 'direct' })
  assert.deepEqual(policyClasses(routing, MEMBERS, undefined, { 前置乙: '香港-自动', 其他: '香港-自动' }), { 前置甲: 'proxy', 前置乙: 'proxy', 后置直连: 'direct', 拒绝的: 'block', 其他: 'proxy' })
  // 复审 T2 的切换:前置乙 直连 → 代理,pending 还是同一个站点集,但核对对象从一条变成两条 → 指纹必须不同
  const before = nativeBypassPlan({ ...routing, policies: routing.policies.slice(0, 3) }, { members: MEMBERS })
  const after = nativeBypassPlan({ ...routing, policies: routing.policies.slice(0, 3) }, { members: MEMBERS, selections: { 前置乙: '香港-自动' } })
  assert.equal(before.pending[0].against.length, 1)
  assert.equal(after.pending[0].against.length, 2)
  assert.notEqual(bypassPlanKey(before), bypassPlanKey(after))
  assert.equal(bypassPlanKey(before), bypassPlanKey(nativeBypassPlan({ ...routing, policies: routing.policies.slice(0, 3) }, { members: MEMBERS })))
  // 指纹不受数组顺序 / 原因文字影响
  assert.equal(bypassPlanKey({ sets: ['b', 'a'], pending: [], reason: 'x' }), bypassPlanKey({ sets: ['a', 'b'], pending: [], reason: 'y' }))
})
test('停用的站点集留在 policies 里但不进 activePolicies;兜底名字/图标可改', () => {
  const conf = normalizeRouting({
    fallbackDefault: 'direct',
    fallbackName: '默认',
    fallbackIcon: 'brand:google',
    policies: [
      { id: 'a', name: 'A', rulesets: ['geosite-google'] },
      { id: 'b', name: 'B', rulesets: ['geosite-cn'], enabled: false },
      // 和兜底重名的会被剔掉,不然内核里两个同名出站
      { id: 'c', name: '默认', rulesets: ['geosite-apple'] },
    ],
  })
  assert.deepEqual(conf.policies.map((p) => [p.name, p.enabled]), [['A', true], ['B', false]])
  assert.deepEqual(conf.activePolicies.map((p) => p.name), ['A'])
  assert.equal(conf.fallback.name, '默认')
  assert.equal(conf.fallback.icon, 'brand:google')
})

test('dnsmasqForwardDomains:按内核里此刻的选择判断谁走代理,和 DNS 规则一致', async () => {
  const mod = await import('./routing-model.mjs')
  const routing = {
    fallbackDefault: 'direct',
    policies: [
      { name: '谷歌', default: 'proxy', domainSuffix: ['google.com'] },
      { name: '微软', default: 'direct', domainSuffix: ['microsoft.com'] },
    ],
  }
  const members = ['直连', '拒绝', '香港']
  const builtin = { direct: '直连', block: '拒绝' }
  // 没有选择信息:按档案默认 → 只有谷歌走代理
  assert.deepEqual(mod.dnsmasqForwardDomains(routing, members, builtin), ['google.com'])
  // 用户在代理页把「微软」切到香港、把「谷歌」切回直连 → 转发表跟着变
  assert.deepEqual(mod.dnsmasqForwardDomains(routing, members, builtin, { '微软': '香港', '谷歌': '直连' }), ['microsoft.com'])
  // 兜底被切到代理 → 代理面没法枚举,回落全局转发
  assert.deepEqual(mod.dnsmasqForwardDomains(routing, members, builtin, { '其他': '香港' }), [])
  // 顺着 selector 链下钻到叶子:香港 → 香港-手动 → 直连
  assert.equal(mod.resolveSelectionLeaf({ '谷歌': '香港', '香港': '香港-手动', '香港-手动': '直连' }, '谷歌'), '直连')
})

test('前置自定义分流:默认值、生效条件、坏行丢弃', () => {
  const empty = normalizeRouting({}).custom
  assert.equal(empty.name, CUSTOM_POLICY_NAME)
  assert.deepEqual(empty.rules, [])
  assert.equal(customPolicyActive(empty), false)

  const c = normalizeRouting({
    custom: {
      rules: [
        { type: 'domainSuffix', value: 'a.com', outbound: 'HK' },
        { type: 'domain', value: 'b.com', outbound: '' },      // 没选出口
        { type: 'domain', value: '', outbound: 'HK' },          // 没填值
        { type: '不认识的类型', value: 'x', outbound: 'HK' },
        { type: 'ruleUrl', value: 'not-a-url', outbound: 'HK' },
        { type: 'port', value: '99999', outbound: 'HK' },     // 端口写错
      ],
    },
  }).custom
  assert.deepEqual(c.rules, [{ type: 'domainSuffix', value: 'a.com', outbound: 'HK' }])
  assert.equal(customPolicyActive(c), true)
  assert.equal(customPolicyActive({ ...c, enabled: false }), false)
})

test('前置自定义分流:一行引用的规则集名', () => {
  assert.equal(customRuleTag({ type: 'geosite', value: 'cn' }), 'geosite-cn')
  assert.equal(customRuleTag({ type: 'geoip', value: 'cn' }), 'geoip-cn')
  assert.equal(customRuleTag({ type: 'ruleset', value: 'my-list' }), 'my-list')
  assert.equal(customRuleTag({ type: 'domainSuffix', value: 'a.com' }), '')
})

test('前置自定义分流里的规则集链接进入待下载名单', () => {
  const routing = { custom: { rules: [{ type: 'ruleUrl', value: 'https://example.com/list.txt', outbound: 'HK' }] }, policies: [] }
  assert.ok(collectRuleListUrls(routing).some((x) => x.url === 'https://example.com/list.txt'))
})

test('端口这一档的值:单个进 port,范围进 port_range,逗号 / 空格分隔;越界、反向、非数字整体判错', () => {
  assert.deepEqual(parsePortSpec('51820'), { port: [51820] })
  assert.deepEqual(parsePortSpec('1000-2000'), { port_range: ['1000:2000'] })
  assert.deepEqual(parsePortSpec('51820, 443 1000-2000'), { port: [51820, 443], port_range: ['1000:2000'] })
  assert.deepEqual(parsePortSpec('80-80'), { port: [80] })
  assert.deepEqual(parsePortSpec('80,'), { port: [80] }) // 末尾多个逗号不较真
  for (const bad of ['', '0', '65536', '2000-1000', 'abc', '80-', '1-2-3']) {
    assert.equal(parsePortSpec(bad), null, bad)
  }
})

test('原生旁路遵守站点集顺序:前面有走代理 / 拒绝的站点集,后面直连站点集的集合不能在入口先放走(复审 R2)', () => {
  const same = { fallbackDefault: 'direct', policies: [
    { id: 'first', name: 'CN-proxy-first', default: '香港-自动', rulesets: ['geoip-cn'] },
    { id: 'second', name: 'CN-direct-second', default: 'direct', rulesets: ['geoip-cn'] },
  ] }
  const r = nativeBypassPlan(same, { members: MEMBERS })
  assert.equal(r.enabled, false)
  // 前面那条只按 IP 分:留给部署时核对重叠(同一个集合必然重叠,那时会关掉),计划阶段不直接放行
  assert.equal(r.pending.length, 1)
  assert.match(r.reason, /CN-direct-second.*CN-proxy-first/)
  // 拒绝在前同理
  const blockFirst = nativeBypassPlan({ fallbackDefault: 'direct', policies: [
    { id: 'a', name: 'Ads', default: 'block', domainSuffix: ['ads.example'] },
    { id: 'b', name: '国内', default: 'direct', rulesets: ['geoip-cn'] },
  ] }, { members: MEMBERS })
  assert.equal(blockFirst.enabled, false)
  // 较早的纯域名代理站点集也算:域名解析出来的 IP 在入口分不出来,不能猜它不会落在集合里
  const domainFirst = nativeBypassPlan({ fallbackDefault: 'direct', policies: [
    { id: 'g', name: 'Google', default: '香港-自动', rulesets: ['geosite-google'] },
    { id: 'b', name: '国内', default: 'direct', rulesets: ['geoip-cn'] },
  ] }, { members: MEMBERS })
  assert.equal(domainFirst.enabled, false)
  // 直连在前、代理在后:直连集合可以旁路(首条命中本来就是它)
  const directFirst = nativeBypassPlan({ fallbackDefault: 'direct', policies: [
    { id: 'b', name: '国内', default: 'direct', rulesets: ['geoip-cn'] },
    { id: 'g', name: 'Google', default: '香港-自动', rulesets: ['geosite-google'] },
    { id: 'c', name: '国内2', default: 'direct', rulesets: ['geoip-hk'] },   // 排在 Google 之后:不进
  ] }, { members: MEMBERS })
  assert.deepEqual(directFirst.sets, ['geoip-cn'])
  assert.match(directFirst.reason, /国内2/)
})

test('转发计划把要拒绝的域名也交给内核(留在原上游会被正常解析);拒绝的关键词 / 规则集、广告拦截只能全量(复审 R7)', () => {
  const plan = dnsmasqForwardPlan({
    fallbackDefault: 'direct',
    policies: [{ id: 'yt', name: 'Youtube', default: '香港-自动', domainSuffix: ['youtube.com'] }],
    custom: { rules: [{ type: 'domainSuffix', value: 'ads.example', outbound: 'block' }] },
  }, MEMBERS)
  assert.equal(plan.mode, 'domains')
  assert.deepEqual([...plan.domains].sort(), ['ads.example', 'youtube.com'])
  const kw = dnsmasqForwardPlan({ fallbackDefault: 'direct', custom: { rules: [{ type: 'domainKeyword', value: 'ads', outbound: 'block' }] } }, MEMBERS)
  assert.equal(kw.mode, 'all')
  assert.match(kw.reason, /要拒绝的/)
  const ad = dnsmasqForwardPlan({ fallbackDefault: 'direct', adBlock: true, policies: [] }, MEMBERS)
  assert.equal(ad.mode, 'all')
  assert.match(ad.reason, /广告拦截/)
})

test('原生旁路 + FakeIP(隔离试验开关):较早的纯域名代理站点集不再挡路,前提写进原因;DNS 禁用模式下不作前提,按真实 IP 算(第四轮 T4)', () => {
  const domainFirst = { fallbackDefault: 'direct', policies: [
    { id: 'g', name: 'Google', default: '香港-自动', rulesets: ['geosite-google'] },
    { id: 'b', name: '国内', default: 'direct', rulesets: ['geoip-cn', 'geosite-cn'] },
  ] }
  assert.equal(nativeBypassPlan(domainFirst, { members: MEMBERS }).enabled, false)
  const fake = nativeBypassPlan(domainFirst, { members: MEMBERS, fakeIp: true })
  assert.equal(fake.enabled, true)
  assert.deepEqual(fake.sets, ['geoip-cn'])
  assert.equal(fake.fakeIp, true)
  assert.match(fake.reason, /FakeIP 试验开着.*不在此保证内/)
  // DNS 禁用模式:终端的查询不一定经内核,占位地址不成立 → 域名站点集照样挡住
  const off = nativeBypassPlan(domainFirst, { members: MEMBERS, fakeIp: true, dnsMode: 'off' })
  assert.equal(off.enabled, false)
  assert.equal(off.fakeIp, false)
  assert.match(off.reason, /DNS 禁用模式/)
  // FakeIP 下带 IP 条件的较早规则仍要核对;前置分流的域名行不挡、ip_cidr 行核对、端口行不开
  const ipFirst = { fallbackDefault: 'direct', policies: [
    { id: 't', name: '电报', default: '香港-自动', rulesets: ['geoip-telegram'], ipCidr: ['1.2.3.0/24'] },
    { id: 'b', name: '国内', default: 'direct', rulesets: ['geoip-cn'] },
  ] }
  assert.deepEqual(nativeBypassPlan(ipFirst, { members: MEMBERS, fakeIp: true }).pending, [{ policy: '国内', sets: ['geoip-cn'], against: [{ name: '电报', geoip: ['geoip-telegram'], cidrs: ['1.2.3.0/24'] }] }])
  assert.deepEqual(nativeBypassPlan({ ...domainFirst, custom: { rules: [{ type: 'domainSuffix', value: 'a.cn', outbound: '香港-自动' }] } }, { members: MEMBERS, fakeIp: true }).sets, ['geoip-cn'])
  assert.equal(nativeBypassPlan({ ...domainFirst, custom: { rules: [{ type: 'port', value: '443', outbound: '香港-自动' }] } }, { members: MEMBERS, fakeIp: true }).enabled, false)
  // 走代理的终端 / 广告拦截仍然不开(它们不按目标分)
  assert.equal(nativeBypassPlan(domainFirst, { members: MEMBERS, fakeIp: true, clientRoutes: [{ sources: ['192.168.3.9/32'], outbound: '香港-自动' }] }).enabled, false)
  assert.equal(nativeBypassPlan({ ...domainFirst, adBlock: true }, { members: MEMBERS, fakeIp: true }).enabled, false)
})
