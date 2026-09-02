// 分流模型的归一化与老档案迁移。
//
// 分流现在是两层:
//   地区分流(regionMode) —— 路由器本身在哪。它决定"没被策略挑走的流量"往哪走:
//     CN    中国大陆:geosite-cn/geoip-cn 直连,其余走代理
//     HKMO  香港澳门:只有策略挑走的走代理,其余全部直连
//     OTHER 其他地区:geosite-cn/geoip-cn 走代理(回国),其余直连
//   策略分流(policies) —— 一条策略就是一组匹配条件 + 内核里一个同名 selector。
//     策略里不指定具体节点:selector 的成员由「出站」页签决定(直连/节点组/拒绝),
//     用户在代理页点选,和 Clash 的用法一致。
//
// 这个模块只做"读出来归一化",不写回库:store 的 deepMerge 只能覆盖键、不能删键
// (见 store/openbox-store.mjs),硬清空老字段反而会让降级回旧版本的人丢数据。
// 老档案(categories/directRulesets/fallback)在这里翻译成新模型,行为保持不变。

// 中国大陆那两个规则集,三个内置地区都用得到,只是去向不同
export const CN_RULESETS = Object.freeze(['geosite-cn', 'geoip-cn'])

// 一条地区规则:类型 + 值 + 动作。顺序即匹配顺序(内核首条命中生效),所以它是数组
// 不是几个按类型分开的桶——把 geosite-cn 排在某条 domain 前面还是后面,结果是不同的。
// 类型对到 sing-box 的字段:
//   geosite/geoip → rule_set(值 cn 存成 geosite-cn,官方规则集就这两个前缀)
//   domain        → domain(完全匹配)
//   domainSuffix  → domain_suffix(域名本身和它的子域)
//   ipcidr        → ip_cidr
export const REGION_RULE_TYPES = Object.freeze(['geosite', 'geoip', 'domain', 'domainSuffix', 'ipcidr'])
export const REGION_RULE_ACTIONS = Object.freeze(['direct', 'proxy'])

// 内置的三个地区。它们只是"预置的几条",用户可以改、可以删、可以自己加(比如日本:
// geosite-jp 直连、其余走代理),所以存的是数据而不是三个写死的分支。
//   rules     按顺序匹配的规则表
//   catchAll  一条都没命中的流量走哪(direct / proxy)
const cnRules = (action) => [
  { type: 'geosite', value: 'cn', action },
  { type: 'geoip', value: 'cn', action },
]
export const BUILTIN_REGIONS = Object.freeze([
  { id: 'cn', name: '中国大陆', rules: cnRules('direct'), catchAll: 'proxy' },
  { id: 'hkmo', name: '香港澳门', rules: [], catchAll: 'direct' },
  { id: 'other', name: '其他地区', rules: cnRules('proxy'), catchAll: 'direct' },
])

// 内网直连那几条(127.0.0.0/8、10.0.0.0/8 ……)不放进这张表:生成配置时固定写在
// 所有规则之前(见 engine/routing.mjs 的 ip_is_private),用户删不掉也不用管。

// 老字段 regionMode 到内置地区的对照,用来迁移改版初期存下的那一版档案
const REGION_MODE_TO_ID = { CN: 'cn', HKMO: 'hkmo', OTHER: 'other' }

export const DEFAULT_OUTBOUND_OPTIONS = Object.freeze({ direct: true, reject: true, groups: true })

// 「拒绝」在内核里是一个 block 出站。sing-box 1.13.14 实测:block 出站能过 check,
// 而 selector 的成员必须非空(空 outbounds 直接 FATAL: missing tags)。
export const REJECT_TAG = 'block'

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0
const strList = (v) => (Array.isArray(v) ? v.filter(isNonEmptyString).map((s) => s.trim()) : [])

const TARGETS = ['direct', 'proxy']

// 规则集 tag:geosite/geoip 两类规则要下载对应的 .srs,其余类型没有 tag
export const regionRuleTag = (rule) =>
  rule.type === 'geosite' || rule.type === 'geoip' ? `${rule.type}-${rule.value}` : ''

const normalizeRegionRule = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  if (!REGION_RULE_TYPES.includes(raw.type)) return null
  if (!isNonEmptyString(raw.value)) return null
  return {
    type: raw.type,
    value: raw.value.trim(),
    action: REGION_RULE_ACTIONS.includes(raw.action) ? raw.action : 'direct',
  }
}

// 改版前的地区形状:一组规则集 + 它们走哪(target) + 其余走哪(fallback)。
// 翻译成规则表,行为不变。
const migrateRegionRules = (raw) => {
  const target = TARGETS.includes(raw?.target) ? raw.target : 'direct'
  return strList(raw?.rulesets).map((tag) => {
    const type = tag.startsWith('geoip-') ? 'geoip' : 'geosite'
    const value = tag.startsWith(`${type}-`) ? tag.slice(type.length + 1) : tag
    return { type, value, action: target }
  })
}

export const normalizeRegion = (raw, index = 0) => ({
  id: isNonEmptyString(raw?.id) ? raw.id.trim() : `region-${index}`,
  name: isNonEmptyString(raw?.name) ? raw.name.trim() : `地区-${index + 1}`,
  rules: Array.isArray(raw?.rules)
    ? raw.rules.map(normalizeRegionRule).filter(Boolean)
    : migrateRegionRules(raw),
  catchAll: TARGETS.includes(raw?.catchAll)
    ? raw.catchAll
    : TARGETS.includes(raw?.fallback)
      ? raw.fallback
      : 'proxy',
})

export const normalizePolicy = (raw, index = 0) => ({
  id: isNonEmptyString(raw?.id) ? raw.id.trim() : `policy-${index}`,
  name: isNonEmptyString(raw?.name) ? raw.name.trim() : `策略-${index + 1}`,
  // 图标是纯界面的东西(国家代码或 globe:xxx),不进内核配置
  icon: isNonEmptyString(raw?.icon) ? raw.icon.trim() : '',
  // selector 首次生成时的默认选中项;空则由 config.mjs 用成员表里的第一个兜底
  default: isNonEmptyString(raw?.default) ? raw.default.trim() : '',
  rulesets: strList(raw?.rulesets),
  domain: strList(raw?.domain),
  domainSuffix: strList(raw?.domainSuffix),
  domainKeyword: strList(raw?.domainKeyword),
  ipCidr: strList(raw?.ipCidr),
})

// 一条策略至少要有一个匹配条件,否则它生成的规则会匹配不到任何东西(或者更糟:
// 一条空条件的规则在 sing-box 里等价于"全部命中",把后面的规则全盖住)。
export const policyHasCondition = (p) =>
  p.rulesets.length > 0 ||
  p.domain.length > 0 ||
  p.domainSuffix.length > 0 ||
  p.domainKeyword.length > 0 ||
  p.ipCidr.length > 0

// 老档案 → 新模型。只在没有 policies 字段时走这条路。
const migrateLegacy = (routing) => {
  const categories = Array.isArray(routing?.categories) ? routing.categories : []
  const directRulesets = strList(routing?.directRulesets)
  const fallback = isNonEmptyString(routing?.fallback) ? routing.fallback.trim() : ''

  // 老的"始终直连"里带 geosite-cn 就是国内玩法;否则看兜底:兜底是 direct 说明
  // 用户已经在"只有指定的走代理"的模式下了,对应香港澳门那一档。
  const hasCn = directRulesets.some((t) => CN_RULESETS.includes(t))
  const regionId = hasCn ? 'cn' : fallback === 'direct' ? 'hkmo' : 'cn'

  const policies = []
  for (const cat of categories) {
    if (!isNonEmptyString(cat?.ruleset)) continue
    policies.push(
      normalizePolicy(
        {
          id: `legacy-${cat.ruleset}`,
          name: cat.ruleset,
          default: isNonEmptyString(cat.target) ? cat.target : '',
          rulesets: [cat.ruleset],
        },
        policies.length,
      ),
    )
  }
  // 老的"始终直连"里除 cn 之外的规则集:翻译成一条默认走直连的策略,行为不变
  const extraDirect = directRulesets.filter((t) => !CN_RULESETS.includes(t))
  if (extraDirect.length) {
    policies.push(
      normalizePolicy(
        { id: 'legacy-direct', name: '始终直连', default: 'direct', rulesets: extraDirect },
        policies.length,
      ),
    )
  }
  return { regionId, policies }
}

export const normalizeRouting = (routing) => {
  const raw = routing && typeof routing === 'object' ? routing : {}
  const migrated = Array.isArray(raw.policies) ? null : migrateLegacy(raw)

  // 地区列表:用户没自定义过就用内置的三条
  const regions = Array.isArray(raw.regions) && raw.regions.length
    ? raw.regions.map(normalizeRegion)
    : BUILTIN_REGIONS.map(normalizeRegion)

  // 选中哪一条。regionMode 是改版初期的写法,一并认下来。
  const wanted = isNonEmptyString(raw.regionId)
    ? raw.regionId.trim()
    : isNonEmptyString(raw.regionMode)
      ? REGION_MODE_TO_ID[raw.regionMode] || ''
      : migrated
        ? migrated.regionId
        : ''
  const region = regions.find((r) => r.id === wanted) || regions[0]

  const policies = (migrated ? migrated.policies : raw.policies.map(normalizePolicy)).filter(
    policyHasCondition,
  )

  const opts = raw.outboundOptions && typeof raw.outboundOptions === 'object' ? raw.outboundOptions : {}
  const outboundOptions = {
    direct: opts.direct !== false,
    reject: opts.reject !== false,
    groups: opts.groups !== false,
  }

  return {
    proxyTag: isNonEmptyString(raw.proxyTag) ? raw.proxyTag.trim() : 'PROXY',
    regions,
    regionId: region ? region.id : '',
    region,
    outboundOptions,
    policies,
    adBlock: raw.adBlock === true,
    adRuleset: isNonEmptyString(raw.adRuleset) ? raw.adRuleset.trim() : 'geosite-category-ads-all',
  }
}

// 策略 selector 的成员表。顺序固定:直连 → 各节点组 → 拒绝,和界面上的顺序一致。
// 三个开关全关时回落成 ['direct']——空成员的组会让内核 FATAL(实测)。
export const policyOutboundOptions = (outboundOptions, groupTags) => {
  const list = []
  if (outboundOptions.direct) list.push('direct')
  if (outboundOptions.groups) list.push(...groupTags)
  if (outboundOptions.reject) list.push(REJECT_TAG)
  return list.length ? list : ['direct']
}

// dnsmasq 接管模式下该怎么转发查询。
//
// 现在的做法是把 dnsmasq 的上游整个换成 sing-box(noresolv + 唯一上游),所有查询都进
// Open-Box。要做到"直连的 DNS 根本不经过 Open-Box",只能反过来:只把代理侧的域名按
// `server=/域名/127.0.0.1#7853` 逐条转给它,其余的 dnsmasq 自己解析。
//
// 但这只在"代理面能被逐条列出来"时成立:
//   CN    —— 代理面是"除中国以外的一切",没法枚举
//   OTHER —— 中国站点要回国,而 geosite-cn 是个二进制规则集,喂不进 dnsmasq
//   HKMO  —— 代理面就是那几条策略;只要策略只用了域名/后缀(没有规则集、没有关键词,
//            dnsmasq 两者都不支持),就能逐条列出来
// 列不出来就返回空数组,调用方回落到现在的全局转发。
export const dnsmasqForwardDomains = (routing) => {
  const conf = normalizeRouting(routing)
  // 只有"其余流量直连、且这个地区自己没有任何走代理的规则"时,代理面才等于那几条策略
  if (!conf.region || conf.region.catchAll !== 'direct') return []
  if (conf.region.rules.some((r) => r.action === 'proxy')) return []
  const domains = []
  for (const p of conf.policies) {
    if (p.rulesets.length || p.domainKeyword.length) return []
    domains.push(...p.domain, ...p.domainSuffix)
  }
  // 一条都没有的话没必要走这条路径:那意味着全部直连,全局转发反而更简单可靠
  return [...new Set(domains)]
}
