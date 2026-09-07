import { isRuleListTag, listTagForUrl, ruleListIpTag } from './rule-list.mjs'
// 分流模型的归一化与老档案迁移。
//
// 现在只有一层:**站点集**。一个站点集 = 一组匹配规则 + 内核里一个同名 selector,
// 走哪条线路由用户在代理页点选(成员由「出站」页签决定:直连/节点组/拒绝)。
// 站点集按顺序匹配,首条命中生效。
//
// 最后固定跟一个系统生成的兜底站点集「其他」:上面都没命中的流量走它。它必须存在
// ——内核的 route.final 得指向某个出站——所以它不在 policies 里,由这里合成,
// 界面上也删不掉、拖不动。
//
// 改版前是两层:
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

// 兜底站点集:上面都没命中的流量。名字直接当内核里的出站 tag 用,所以它是数据
// 不是文案(改名会让代理页上原来的选择对不上号)。图标是彩色地球。
export const FALLBACK_TAG = '其他'
export const FALLBACK_ICON = 'globe:earth-meridians'

// 前置自定义分流:固定置顶、删不掉的一条,排在所有站点集之前(所以叫"前置")。
// 和站点集的区别只有一处,也是它存在的理由:站点集在内核里是一个同名 selector,走哪条线
// 由用户在代理页点选;这一条不生成 selector,出口在设置里就定死成某个**节点**或节点组
// ——站点集只能选到节点组,选不到具体节点。
// 它单独存在 routing.custom 里而不是混进 policies:混进去就得靠标记位防删、防拖动,
// 单独存一份天然删不掉。
export const CUSTOM_POLICY_NAME = '前置自定义分流'

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

export const normalizePolicy = (raw, index = 0) => {
  // 规则集链接:存的是网址,部署时下回来编成 <listTagForUrl(url)>.srs(见
  // system/rule-lists.mjs)。这里就把它折算成规则集名字并进 rulesets——下游的路由规则、
  // DNS 规则、域名穿透一律按"这个站点集引用了哪些规则集"办事,不必各自再认一遍链接。
  const ruleUrls = strList(raw?.ruleUrls).filter((u) => /^https?:\/\//i.test(u))
  return {
    id: isNonEmptyString(raw?.id) ? raw.id.trim() : `policy-${index}`,
    name: isNonEmptyString(raw?.name) ? raw.name.trim() : `策略-${index + 1}`,
    // 图标是纯界面的东西(国家代码或 globe:xxx),不进内核配置
    icon: isNonEmptyString(raw?.icon) ? raw.icon.trim() : '',
    // selector 首次生成时的默认选中项;空则由 config.mjs 用成员表里的第一个兜底
    default: isNonEmptyString(raw?.default) ? raw.default.trim() : '',
    // 停用的站点集留在档案里、界面上能看到,但不进内核配置(没有 selector、没有规则)
    enabled: raw?.enabled !== false,
    ruleUrls,
    rulesets: [...new Set([...strList(raw?.rulesets), ...ruleUrls.map(listTagForUrl)])],
    domain: strList(raw?.domain),
    domainSuffix: strList(raw?.domainSuffix),
    domainKeyword: strList(raw?.domainKeyword),
    ipCidr: strList(raw?.ipCidr),
  }
}

// 没传 builtin 时的默认(测试、预览):直连叫 direct、拒绝叫 block,都启用
export const DEFAULT_BUILTIN = Object.freeze({ direct: 'direct', block: 'block', directEnabled: true, blockEnabled: true })

export const normalizeCustomPolicy = (raw) => {
  const r = raw && typeof raw === 'object' ? raw : {}
  const ruleUrls = strList(r.ruleUrls).filter((u) => /^https?:\/\//i.test(u))
  return {
    name: isNonEmptyString(r.name) ? r.name.trim() : CUSTOM_POLICY_NAME,
    icon: isNonEmptyString(r.icon) ? r.icon.trim() : '',
    iconScale: Number.isInteger(r.iconScale) ? r.iconScale : 0,
    enabled: r.enabled !== false,
    // 固定出口:一个出站 tag(节点名 / 节点组名),或 direct / block 这两个占位
    // (内置出站可以改名,生成配置时再换算成当时的名字)。空 = 还没选,这条不出规则。
    outbound: isNonEmptyString(r.outbound) ? r.outbound.trim() : '',
    ruleUrls,
    rulesets: [...new Set([...strList(r.rulesets), ...ruleUrls.map(listTagForUrl)])],
    domain: strList(r.domain),
    domainSuffix: strList(r.domainSuffix),
    domainKeyword: strList(r.domainKeyword),
    ipCidr: strList(r.ipCidr),
  }
}

// 三个条件都满足才真的出一条规则:启用着、选了出口、至少有一个匹配条件。
// 少了最后一条会更糟:空条件的规则在 sing-box 里等价于"全部命中",排在最前面
// 就把后面所有站点集全盖住了。
export const customPolicyActive = (custom) =>
  Boolean(custom) && custom.enabled !== false && isNonEmptyString(custom.outbound) && policyHasCondition(custom)

// 固定出口存的可能是 direct / block 占位,换算成内核里此刻的实际 tag
export const customOutboundTag = (custom, builtin = DEFAULT_BUILTIN) =>
  custom.outbound === 'direct' ? builtin.direct : custom.outbound === 'block' ? builtin.block : custom.outbound

// 整份档案里用到的规则集链接:部署时要按这张表把它们下回来编译(见 system/rule-lists.mjs)。
// 停用的站点集不算——它本来就不进配置。
export const collectRuleListUrls = (routing) => {
  const seen = new Map()
  const conf = normalizeRouting(routing)
  // 前置自定义分流用到的名单也要下回来,它和站点集一样会引用规则集链接
  const lists = [...(customPolicyActive(conf.custom) ? [conf.custom] : []), ...conf.activePolicies]
  for (const p of lists) {
    for (const url of p.ruleUrls) if (!seen.has(url)) seen.set(url, listTagForUrl(url))
  }
  return [...seen.entries()].map(([url, tag]) => ({ url, tag }))
}

// 站点集引用的规则集,分别翻成路由规则和 DNS 规则各自该引用的 .srs 名字。
//
// ruleLists 是部署时从 rule-lists.json 得来的形状表:{ [list-xxxxxxxx]: { domain, ip } }
// (见 system/rule-lists.mjs 的 ensureRuleLists)。一条规则集链接编成域名 / IP 两份文件,
// 哪份存在就引用哪份;没有形状信息(预览、还没拉过)就按老样子引用一份。
export const routeRulesetTags = (policy, ruleLists = {}) => policy.rulesets.flatMap((tag) => {
  if (!isRuleListTag(tag)) return [tag]
  const shape = ruleLists && ruleLists[tag]
  if (!shape) return [tag]
  return [...(shape.domain ? [tag] : []), ...(shape.ip ? [ruleListIpTag(tag)] : [])]
})

// DNS 规则只要纯域名的规则集。geoip-* 和规则集链接的 IP 那份不能进来:sing-box 对含 IP 的
// 规则集是"先按这条规则的服务器解析一次、拿结果 IP 去对、对不上就丢掉重查"——等于每个路过的
// 域名都被这条策略的线路白查一遍,排在后面的规则再查第二遍。正式路由器上实测过:Netflix
// 站点集带着 geoip-netflix 排在 Speed 前面,Speed 名单里的域名先经台湾节点查(落到 Cloudflare
// 香港)、再经美国节点查,browserleaks 显示两个出口;「国内」带着 geoip-cn 更会把没列名的
// 国外域名明文送到运营商 DNS 问一遍。IP 该怎么分流,由路由规则里的同一批规则集去管。
export const dnsRulesetTags = (policy, ruleLists = {}) => policy.rulesets.filter((tag) => {
  if (tag.startsWith('geoip-')) return false
  if (!isRuleListTag(tag)) return true
  const shape = ruleLists && ruleLists[tag]
  return !shape || shape.domain
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

// 地区层退役了:选中的那条地区,按动作拆成一到两个站点集接在用户的站点集后面
// (地区规则本来就排在策略之后),兜底则变成兜底站点集的默认选中项。行为不变。
const migrateRegion = (raw) => {
  // 档案里压根没有地区数据(全新安装的种子在 store 的 DEFAULT_PROFILE 里)就不迁移,
  // 免得凭空长出两个站点集
  const hasRegionData =
    (Array.isArray(raw.regions) && raw.regions.length > 0) ||
    isNonEmptyString(raw.regionId) ||
    isNonEmptyString(raw.regionMode)
  if (!hasRegionData) return { policies: [], fallbackDefault: '' }

  const regions = Array.isArray(raw.regions) && raw.regions.length
    ? raw.regions.map(normalizeRegion)
    : BUILTIN_REGIONS.map(normalizeRegion)
  const wanted = isNonEmptyString(raw.regionId)
    ? raw.regionId.trim()
    : isNonEmptyString(raw.regionMode)
      ? REGION_MODE_TO_ID[raw.regionMode] || ''
      : ''
  const region = regions.find((r) => r.id === wanted) || regions[0]
  if (!region) return { policies: [], fallbackDefault: '' }

  const policies = []
  for (const action of ['direct', 'proxy']) {
    const rules = region.rules.filter((r) => r.action === action)
    if (!rules.length) continue
    policies.push(
      normalizePolicy({
        id: `region-${region.id}-${action}`,
        name: `${region.name}·${action === 'direct' ? '直连' : '代理'}`,
        icon: FALLBACK_ICON,
        default: action,
        rulesets: rules.filter((r) => r.type === 'geosite' || r.type === 'geoip').map(regionRuleTag),
        domain: rules.filter((r) => r.type === 'domain').map((r) => r.value),
        domainSuffix: rules.filter((r) => r.type === 'domainSuffix').map((r) => r.value),
        ipCidr: rules.filter((r) => r.type === 'ipcidr').map((r) => r.value),
      }, policies.length),
    )
  }
  return { policies, fallbackDefault: region.catchAll === 'proxy' ? 'proxy' : 'direct' }
}

export const normalizeRouting = (routing) => {
  const raw = routing && typeof routing === 'object' ? routing : {}
  // store 的 deepMerge 会把 DEFAULT_PROFILE 里的 `policies: []` 补给老档案,所以
  // 不能只看"有没有 policies 字段":空数组 + 有老字段,同样是一份没迁过的老档案。
  const hasLegacy =
    (Array.isArray(raw.categories) && raw.categories.length > 0) ||
    (Array.isArray(raw.directRulesets) && raw.directRulesets.some((t) => !CN_RULESETS.includes(t)))
  const migrated = !Array.isArray(raw.policies) || (raw.policies.length === 0 && hasLegacy)
    ? migrateLegacy(raw)
    : null

  // 地区层已经退役:档案里还留着 regions/regionId 就把它翻译成站点集接在后面。
  // fallbackDefault 一旦写进档案,就说明这份档案已经迁过了,不再重复翻译。
  const migratedRegion = isNonEmptyString(raw.fallbackDefault) ? null : migrateRegion(raw)

  // 兜底站点集:名字和图标可以改(名字就是内核里的出站 tag),只有存在本身是固定的
  const fallbackName = isNonEmptyString(raw.fallbackName) ? raw.fallbackName.trim() : FALLBACK_TAG
  const fallbackIcon = isNonEmptyString(raw.fallbackIcon) ? raw.fallbackIcon.trim() : FALLBACK_ICON

  const policies = [
    ...(migrated ? migrated.policies : raw.policies.map(normalizePolicy)),
    ...(migratedRegion ? migratedRegion.policies : []),
  ].filter(policyHasCondition).filter((p) => p.name !== FALLBACK_TAG && p.name !== fallbackName)
  // 真正进内核的那部分:停用的不算
  const activePolicies = policies.filter((p) => p.enabled !== false)

  const opts = raw.outboundOptions && typeof raw.outboundOptions === 'object' ? raw.outboundOptions : {}
  const outboundOptions = {
    direct: opts.direct !== false,
    reject: opts.reject !== false,
    groups: opts.groups !== false,
  }

  const fallback = {
    name: fallbackName,
    icon: fallbackIcon,
    default: isNonEmptyString(raw.fallbackDefault)
      ? raw.fallbackDefault.trim()
      : migratedRegion
        ? migratedRegion.fallbackDefault
        : 'direct',
  }

  return {
    proxyTag: isNonEmptyString(raw.proxyTag) ? raw.proxyTag.trim() : 'PROXY',
    outboundOptions,
    custom: normalizeCustomPolicy(raw.custom),
    policies,
    activePolicies,
    fallback,
    adBlock: raw.adBlock === true,
    adRuleset: isNonEmptyString(raw.adRuleset) ? raw.adRuleset.trim() : 'geosite-category-ads-all',
  }
}

// 站点集 selector 的成员表:「节点管理」里启用着的条目,按那里的顺序(内置的直连/
// 拒绝和节点组混排)。要不要某一项,就在节点管理里启用/停用它——原来「出站」页签那套
// 开关已退役,outboundOptions 参数留着只是不改所有调用方的签名。
// 一个都不剩时回落成直连——空成员的组会让内核 FATAL(实测)。
//   groupTags  节点管理里出到配置的条目,按顺序;内置的两个也在其中,由 builtin 标出
//   builtin    { direct, block, directEnabled, blockEnabled }(见 user-groups.mjs)
export const policyOutboundOptions = (_outboundOptions, groupTags, builtin = DEFAULT_BUILTIN) => {
  const list = groupTags.filter((tag) => {
    if (tag === builtin.direct) return builtin.directEnabled
    if (tag === builtin.block) return builtin.blockEnabled
    return true
  })
  return list.length ? list : [builtin.direct]
}

// 迁移用的占位:老档案里地区的兜底只有"直连/代理"两种说法,而 selector 的成员是
// 具体的出站名。'proxy' 存进去表示"第一个节点组",真正是哪个组由生成配置时按成员表
// 定——用户在代理页点一下就变成具体的名字了。
export const PROXY_SENTINEL = 'proxy'

// 一个站点集实际会走哪个出站。default 空着(或指向一个已经不存在的组)时,内核会
// 落到成员表里的第一项——这里跟着算同一个结果,不然界面/DNS 的判断会和内核对不上。
// 档案里存的 'direct' / 'block' 是占位:内置出站可以改名,生成时换算成当时的名字。
export const effectiveOutbound = (policyDefault, members, builtin = DEFAULT_BUILTIN) => {
  const want = policyDefault === 'direct' ? builtin.direct : policyDefault === 'block' ? builtin.block : policyDefault
  if (members.includes(want)) return want
  if (policyDefault === PROXY_SENTINEL) {
    const group = members.find((m) => m !== builtin.direct && m !== builtin.block)
    if (group) return group
  }
  return members[0]
}

// dnsmasq 接管模式下该怎么转发查询。
//
// 默认做法是把 dnsmasq 的上游整个换成 sing-box(noresolv + 唯一上游),所有查询都进
// Open-Box。要做到"直连的 DNS 根本不经过 Open-Box",只能反过来:只把要走代理的域名按
// `server=/域名/127.0.0.1#7853` 逐条转给它,其余的 dnsmasq 自己解析、自己出网。
//
// 只在"代理面能被逐条列出来"时成立:
//   · 兜底走代理 —— 代理面是"除了列出来的一切",没法枚举
//   · 某个走代理的站点集用了 geosite/geoip 或域名关键词 —— dnsmasq 展开不了二进制
//     规则集,也不支持关键词匹配
// 列不出来就返回空数组,调用方回落到全局转发。
//
// 这份名单是**生成配置时**算的,和 DNS 规则一样按内核里此刻的选择(selections)判断
// 谁走代理;两次重启之间在代理页切了直连/代理,转发表要等下次重启才跟上——切换本身仍然
// 生效(流量照样走代理),只是那些域名这一轮还是本地解析的。
// members 是内核里那些 selector 的成员表(生成配置时算出来的那一份,直接传进来,
// 不在这里重算一遍——两处各算一次迟早会算歪)。
// 顺着内核里各 selector 的当前选择(selections:tag → now)一路下钻到叶子。
// DNS 规则和 dnsmasq 转发表都要按"此刻真走哪"判断,两处共用这一个,免得算歪。
export const resolveSelectionLeaf = (selections, name) => {
  const map = selections && typeof selections === 'object' ? selections : {}
  let current = name
  const seen = new Set()
  for (let i = 0; i < 16 && Object.prototype.hasOwnProperty.call(map, current) && !seen.has(current); i++) {
    seen.add(current)
    current = map[current]
  }
  return current
}

// 某个站点集(或兜底)此刻是不是直连:内核在跑就按它当前的选择,否则按档案默认
export const policyGoesDirect = (name, policyDefault, members, builtin, selections) => {
  const chosen = selections && Object.prototype.hasOwnProperty.call(selections, name)
    ? resolveSelectionLeaf(selections, name)
    : effectiveOutbound(policyDefault, members, builtin)
  return chosen === builtin.direct
}

export const dnsmasqForwardDomains = (routing, members = ['direct'], builtin = DEFAULT_BUILTIN, selections = {}) => {
  const conf = normalizeRouting(routing)
  if (!policyGoesDirect(conf.fallback.name, conf.fallback.default, members, builtin, selections)) return []
  const domains = []
  for (const p of conf.activePolicies) {
    if (policyGoesDirect(p.name, p.default, members, builtin, selections)) continue
    // 这个集合要走代理,但它的规则 dnsmasq 展不开 → 只能全局转发
    if (p.rulesets.length || p.domainKeyword.length) return []
    domains.push(...p.domain, ...p.domainSuffix)
  }
  // 一条都没有的话没必要走这条路径:那意味着全部直连,全局转发反而更简单可靠
  return [...new Set(domains)]
}
