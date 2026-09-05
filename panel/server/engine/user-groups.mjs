// 用户自定义节点组(策略组)。
//
// 与 groups.mjs 里按地区自动切分的组不同,这些是用户在面板上手工建的:自己起名字、
// 自己挑成员(节点或别的组)、自己选类型。
//
// 类型只有两种,因为 sing-box 只有这两种(实测 1.13.14):
//   urltest  —— 定期测延迟,自动用最快的;有 interval(检测间隔)与 tolerance(容差)
//   selector —— 手动选,不自动切
// Clash 里的 fallback(按顺序取第一个可用的)在 sing-box 里**不存在**——
// `unknown outbound type: fallback`。所以界面上不提供它,而不是偷偷映射成别的类型
// 假装支持。
//
// 三条必须由这里保证的不变量(实测 sing-box check 只能挡住第一条):
//   1. 组的成员不能为空 —— 内核直接 FATAL: "initialize outbound[N]: missing tags"
//   2. 成员必须真实存在 —— 引用一个不存在的出站,check **照样通过**,问题留到运行时
//   3. 不能有环(自引用或互相引用)—— check 同样不拦
// 也就是说"生成的配置能过 check"并不足以保证这几点,只能在生成时自己挡。

import { keywordMatches, normalizeForMatch } from './rename.mjs'

export const GROUP_TYPES = Object.freeze(['urltest', 'selector'])

// 成员怎么来:
//   static  —— 手工挑,members 里存的是节点名/组名(下面那套左右穿梭选出来的)
//   dynamic —— 按关键词现算,keywords 命中哪些节点就是哪些成员
// 动态组的意义在于"以后加的订阅也自动进来":成员是在生成配置时按当前节点算的,
// 新订阅刷进来只要名字命中关键词,下次部署就自动在组里,不用回来重新勾一遍。
export const GROUP_MODES = Object.freeze(['static', 'dynamic'])

// 两个内置出站:直连(direct)和拒绝(block)。它们和节点组放在同一张「节点管理」列表里
// ——可以改名、换图标、拖顺序、停用,但删不掉:内核里 direct 出站必须存在(内网直连、
// DNS 直连解析都指向它),block 则是站点集里「拒绝」这一项的实体。
// 名字就是内核里的出站 tag(改名会跟着变),所以档案里存的 'direct' / 'block' 是占位,
// 生成配置时再按当时的名字换算(见 routing-model.mjs 的 effectiveOutbound)。
export const BUILTIN_IDS = Object.freeze({ direct: 'builtin-direct', block: 'builtin-block' })
export const BUILTIN_KINDS = Object.freeze(['direct', 'block'])

export const builtinDefaults = () => ([
  { id: BUILTIN_IDS.direct, kind: 'direct', name: '直连', type: 'selector', mode: 'static', icon: 'misc:dart', keywords: [], members: [], enabled: true },
  { id: BUILTIN_IDS.block, kind: 'block', name: '拒绝', type: 'selector', mode: 'static', icon: 'misc:cross', keywords: [], members: [], enabled: true },
])

export const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204'
export const DEFAULT_INTERVAL = '3m'
export const DEFAULT_TOLERANCE = 50
// 自动择优组多久不用就停止健康检查。内核的默认值是 30 分钟(constant.DefaultURLTestIdleTimeout):
// 一个组超过 30 分钟没有流量经过,它自己的定时检查就停了,再也不重测、也不重新择优——直到
// 下次有连接走它才重新启动(sing-box protocol/group/urltest.go 的 Touch / loopCheck)。
// 后果是:不常用的组会长期停在一个已经不通的节点上(内核在拨号失败时只删该节点的延迟记录,
// 并不重新择优),用户点开代理页看到的就是"选中的线路没有延迟、也不自动换"。
// 12 小时:一天之内用过一次的组就一直保持每 3 分钟一检。代价是这些组的成员会持续被测速,
// 但同一个节点的延迟记录是全局共享的,3 分钟内只会被测一次,不会因为组多就成倍增加。
export const DEFAULT_IDLE_TIMEOUT = '12h'

// 两个开箱即用的组:一份自动择优、一份手动指定,成员都是"当前所有有效节点"。
// allNodes 是动态的——订阅刷新后节点变了,组的成员跟着变,不需要用户回来重新勾一遍。
export const defaultGroups = () => ([
  builtinDefaults()[0],
  {
    id: 'all-auto',
    name: '所有-自动',
    type: 'urltest',
    // 这两个组是跨地区的,配国旗都不对,默认就给地球;不给的话新装出来是两个空图标,
    // 每个人都得自己去挑一次
    icon: 'globe:earth-asia',
    mode: 'dynamic',
    keywords: [],
    members: [],
    interval: DEFAULT_INTERVAL,
    tolerance: DEFAULT_TOLERANCE,
    idleTimeout: DEFAULT_IDLE_TIMEOUT,
  },
  {
    id: 'all-manual',
    name: '所有-手动',
    type: 'selector',
    icon: 'globe:earth-meridians',
    mode: 'dynamic',
    keywords: [],
    members: [],
  },
  builtinDefaults()[1],
])

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0

// 图标既可能是两位国家代码,也可能是 globe:asia / brand:google 这种非国家图标。
// 只有前者该转大写
// ——把 globe:asia 转成 GLOBE:ASIA 的话,界面按值查不到对应图标,直接变成空白。
const normalizeIcon = (raw) => {
  if (!isNonEmptyString(raw)) return ''
  const v = raw.trim()
  // 国家代码统一大写(hk -> HK),地球和公司图标统一小写(GLOBE:ASIA -> globe:asia,
  // BRAND:Google -> brand:google)。都要归一,是因为界面按这个值去查图标:大小写不
  // 一致就查不到,直接显示成空白。
  if (/^(globe|brand|misc):/i.test(v)) return v.toLowerCase()
  return /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : v
}

// 图标缩放:整数像素偏移,0 = 不缩放,+1 大 1px,-1 小 1px。不同来源的图标视觉大小不一
// (国旗满框、品牌标带留白),让用户自己拨一下。限在 ±8 之内,再大就不是"微调"了。
export const ICON_SCALE_LIMIT = 8
export const normalizeIconScale = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(-ICON_SCALE_LIMIT, Math.min(ICON_SCALE_LIMIT, Math.round(n)))
}

// 把外部传进来的一条组定义收敛成内部形状;不合法的字段回落默认值而不是抛错——
// 这个函数同时用于读取历史数据,老记录缺字段是正常的。
export const normalizeGroup = (raw, index = 0) => {
  const type = GROUP_TYPES.includes(raw?.type) ? raw.type : 'selector'
  // allNodes 是 mode 之前的写法(只有"全部节点"这一种动态),等价于一个不带关键词的
  // 动态组。老记录照这个规则迁移,行为不变。
  const mode = GROUP_MODES.includes(raw?.mode) ? raw.mode : (raw?.allNodes === true ? 'dynamic' : 'static')
  const group = {
    id: isNonEmptyString(raw?.id) ? raw.id.trim() : `group-${index}`,
    name: isNonEmptyString(raw?.name) ? raw.name.trim() : `分组-${index + 1}`,
    type,
    mode,
    // 停用 = 不写进配置、站点集里也选不到。默认启用;老记录没这个字段。
    enabled: raw?.enabled !== false,
    // 图标:国家代码(ISO 3166-1 alpha-2),空表示不显示。纯界面用,不进 sing-box 配置
    // ——那边没有这个字段,写进去内核直接报未知字段。
    // 国家代码统一成大写(hk -> HK);地球图标是 globe:xxx 这种,原样留着不能动
    icon: normalizeIcon(raw?.icon),
    iconScale: normalizeIconScale(raw?.iconScale),
    keywords: Array.isArray(raw?.keywords) ? raw.keywords.filter(isNonEmptyString).map((k) => k.trim()) : [],
    members: Array.isArray(raw?.members) ? raw.members.filter(isNonEmptyString).map((m) => m.trim()) : [],
  }
  if (type === 'urltest') {
    // 每个组可以有自己的测速地址;空 = 用档案里的全局地址
    group.testUrl = isNonEmptyString(raw?.testUrl) ? raw.testUrl.trim() : ''
    group.interval = isNonEmptyString(raw?.interval) ? raw.interval.trim() : DEFAULT_INTERVAL
    const tol = Number(raw?.tolerance)
    group.tolerance = Number.isFinite(tol) && tol >= 0 ? Math.floor(tol) : DEFAULT_TOLERANCE
    group.idleTimeout = isNonEmptyString(raw?.idleTimeout) ? raw.idleTimeout.trim() : DEFAULT_IDLE_TIMEOUT
  }
  return group
}

// kind 只由固定 id 决定,不信任传进来的值:普通组写个 kind:'direct' 混进来,内核里就会
// 多出一个 direct 出站。
// 内置出站的默认图标换过一次(公路/禁止 → 靶心/叉):档案里还是旧默认的一并换掉,
// 用户自己挑过别的图标就不动。
// 用户存了什么图标就用什么;只有空的才补默认。以前这里会把 misc:direct / misc:reject
// 当「退役的旧默认值」改写成新默认——但这两个现在是图标库里可选的变体,再改写的话用户
// 选中它们保存后会被悄悄换回去,看起来就是"换不掉"。
const withKind = (g) => {
  const kind = Object.entries(BUILTIN_IDS).find(([, id]) => id === g.id)?.[0]
  if (!kind) return g
  const fresh = builtinDefaults().find((b) => b.kind === kind)
  const icon = g.icon || fresh.icon
  return { ...g, kind, icon, type: 'selector', mode: 'static', keywords: [], members: [] }
}

// 两个内置出站永远在列表里:老档案没有就补上——直连放最前、拒绝放最后(和以前站点集
// 成员表"直连 → 各组 → 拒绝"的顺序一样);有就照用户排的位置。
export const normalizeGroups = (list) => {
  const normalized = (Array.isArray(list) ? list : []).map((g, i) => withKind(normalizeGroup(g, i)))
  const [direct, block] = builtinDefaults()
  const has = (b) => normalized.some((g) => g.id === b.id)
  return [...(has(direct) ? [] : [direct]), ...normalized, ...(has(block) ? [] : [block])]
}

// 生成配置时要用的两样:两个内置出站现在叫什么、有没有被停用。
export const builtinTags = (groups) => {
  const normalized = normalizeGroups(groups)
  const direct = normalized.find((g) => g.kind === 'direct')
  const block = normalized.find((g) => g.kind === 'block')
  return {
    direct: direct.name,
    block: block.name,
    directEnabled: direct.enabled,
    blockEnabled: block.enabled,
  }
}

// 解析成员:
//   dynamic —— 按关键词从当前节点里现挑(不带关键词 = 全部节点)。只认节点,不认别的
//              组:组名同样可能命中关键词,那样会凭空长出环来,而"按名字挑一批节点"
//              本来也不需要把组算进去。
//   static  —— 用显式成员,剔除"指向不存在的东西"的条目;组之间可以互相引用,但引用
//              必须最终落到真实存在的组上。
const resolveMembers = (group, nodeTags, groupNameSet) => {
  const nodeTagSet = new Set(nodeTags)
  if (group.mode === 'dynamic') {
    if (!group.keywords.length) return [...nodeTags]
    return nodeTags.filter((tag) => {
      const lower = normalizeForMatch(tag)
      return group.keywords.some((kw) => keywordMatches(lower, kw))
    })
  }
  const seen = new Set()
  const out = []
  for (const m of group.members) {
    if (seen.has(m)) continue          // 同一个成员写两遍,sing-box 不会去重
    if (m === group.name) continue     // 自引用
    if (!nodeTagSet.has(m) && !groupNameSet.has(m)) continue // 悬空引用(check 不拦)
    seen.add(m)
    out.push(m)
  }
  return out
}

// 去环:按依赖顺序逐个接纳组,只允许引用"已经被接纳的组"或真实节点。
// 这样任何环里的组都会因为它依赖的另一半还没被接纳而暂时留下,直到某一轮不再有
// 新组被接纳为止——剩下的就是环,整组丢弃。
const dropCycles = (groups) => {
  // 只有"引用别的组"才构成依赖。引用节点不算;引用一个既不是节点也不是组的名字
  // (悬空)同样不算——那种成员由 resolveMembers 过滤掉即可,不该连累整个组被当成环。
  const allGroupNames = new Set(groups.map((g) => g.name))
  const accepted = []
  const acceptedNames = new Set()
  const pending = [...groups]
  let progressed = true
  while (progressed && pending.length) {
    progressed = false
    for (let i = 0; i < pending.length; i++) {
      const g = pending[i]
      // 动态组只挑节点,不引用别的组,所以永远没有依赖,也就不可能成环
      const groupDeps = g.mode === 'dynamic'
        ? []
        : g.members.filter((m) => m !== g.name && allGroupNames.has(m))
      if (groupDeps.some((d) => !acceptedNames.has(d))) continue
      accepted.push(g)
      acceptedNames.add(g.name)
      pending.splice(i, 1)
      i--
      progressed = true
    }
  }
  // 循环结束后仍留在 pending 里的,就是互相咬住的那一撮
  return accepted
}

// 生成 sing-box 出站。成员解析后为空的组直接丢弃——留着会让内核 FATAL,
// 而一个空组对用户也没有任何意义。返回同时给出被丢弃的组,供调用方如实告知。
export const emitUserGroups = (groups, nodes, options = {}) => {
  const testUrl = options.testUrl || DEFAULT_TEST_URL
  const normalized = normalizeGroups(groups)
  // 保持节点原有顺序:节点已经按地区词典排过序了(见 rename.mjs),组里的成员顺序
  // 跟着它走,策略组列表看起来才和节点列表一致。
  const nodeTags = (nodes || []).map((n) => n.tag)

  const builtin = builtinTags(normalized)
  // 停用的组不进配置。内置的直连例外:内核里 direct 出站必须存在(内网直连、DNS 直连
  // 解析、空组占位都指向它),"停用直连"的含义只是站点集里选不到它。
  const active = normalized.filter((g) => g.enabled || g.kind === 'direct')
  const withoutCycles = dropCycles(active.filter((g) => !g.kind))
  const droppedByCycle = active.filter((g) => !g.kind && !withoutCycles.includes(g))

  const groupNameSet = new Set(withoutCycles.map((g) => g.name))
  const outbounds = []
  const dropped = droppedByCycle.map((g) => ({ name: g.name, reason: 'cycle' }))

  // 一个都没命中的组挂直连占位:配置里一定有它,而且它不会反过来引用任何组
  const placeholderTag = builtin.direct
  const placeholders = []

  // 按列表顺序出:内置出站和节点组混排,用户拖成什么样内核里就是什么样
  for (const g of active) {
    if (g.kind === 'direct') { outbounds.push({ type: 'direct', tag: g.name }); continue }
    if (g.kind === 'block') { outbounds.push({ type: 'block', tag: g.name }); continue }
    if (!withoutCycles.includes(g)) continue
    let members = resolveMembers(g, nodeTags, groupNameSet)
    if (!members.length) {
      // 空组不能原样写进配置——内核会 FATAL(1.13.14 实测:
      // "initialize outbound[N]: missing tags")。但也不该把整个组丢掉:用户建
      // 「爱尔兰-自动」就是在等以后有爱尔兰节点,组没了的话,指向它的分流规则
      // 还得回去重挑一次目标。
      // 折中是挂一个 direct 占位:组本身在配置里、在代理页里都还在,等订阅刷出
      // 匹配的节点,下次启动自动换成真成员。
      members = [placeholderTag]
      placeholders.push(g.name)
    }
    if (g.type === 'urltest') {
      outbounds.push({
        type: 'urltest',
        tag: g.name,
        outbounds: members,
        url: g.testUrl || testUrl,
        interval: g.interval || DEFAULT_INTERVAL,
        tolerance: g.tolerance ?? DEFAULT_TOLERANCE,
        idle_timeout: g.idleTimeout || DEFAULT_IDLE_TIMEOUT,
      })
    } else {
      outbounds.push({ type: 'selector', tag: g.name, outbounds: members })
    }
  }

  return { outbounds, dropped, placeholders, builtin }
}
