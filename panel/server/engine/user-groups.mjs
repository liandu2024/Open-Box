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
import { parseDuration } from './duration.mjs'

// failover(故障转移)是应用层类型:内核里生成的是一个 selector(父组)+ 每个多节点页签一个私有 urltest
// 子组,主备决策由面板服务端的 system/failover-manager.mjs 做,不向内核写 type: failover / fallback
export const GROUP_TYPES = Object.freeze(['urltest', 'selector', 'failover'])

// 故障转移的内部出站(页签子组、内置拒绝停用时的兜底拒绝)都带这个前缀:它们要进内核配置、要能被链路
// 解析,但不是用户组——不进节点管理列表、不进站点集出口候选、不进别的组的候选(见 isInternalTag)
export const FAILOVER_INTERNAL_PREFIX = '__fo:'
export const FAILOVER_REJECT_TAG = `${FAILOVER_INTERNAL_PREFIX}reject`
export const isInternalTag = (tag) => typeof tag === 'string' && tag.startsWith(FAILOVER_INTERNAL_PREFIX)
// 页签子组的 tag 由稳定的父组 id 和页签 id 派生,不用「主用 / 备用 1」或下标当身份
export const laneSubTag = (groupId, laneId) => `${FAILOVER_INTERNAL_PREFIX}${groupId}:${laneId}`
// 主备页签最多 3 个(主用 + 备用 1 + 备用 2):再多没有意义,页签栏也摆不下
export const FAILOVER_MAX_LANES = 3
export const FAILOVER_DEFAULTS = Object.freeze({
  interval: '30s',
  tolerance: 100,
  timeoutMs: 5000,
  failureThreshold: 2,
  restorePrimary: true,
  recoveryHoldMs: 60_000,
})
// 检测参数的合法范围(API 写入前校验用;归一化读取时越界回落默认)
export const FAILOVER_LIMITS = Object.freeze({
  intervalMs: [5_000, 24 * 3600_000],
  tolerance: [0, 60_000],
  timeoutMs: [1_000, 60_000],
  failureThreshold: [1, 20],
  recoveryHoldMs: [0, 24 * 3600_000],
})

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

// 默认测速地址在 engine/test-url.mjs(https;clash API 不认 http),这里转出去给老的引用方
export { DEFAULT_TEST_URL } from './test-url.mjs'
import { DEFAULT_TEST_URL } from './test-url.mjs'
// 新建自动择优组的默认:5 分钟测一次(面板服务端按这个间隔硬性定时测,见 system/latency-scheduler.mjs)、
// 容差 100ms(差不到 100ms 不换节点,免得几十毫秒的抖动让选中的节点跳来跳去)
export const DEFAULT_INTERVAL = '5m'
export const DEFAULT_TOLERANCE = 100
// 自动择优组多久不用就停止健康检查。内核的默认值是 30 分钟(constant.DefaultURLTestIdleTimeout):
// 一个组超过 30 分钟没有流量经过,它自己的定时检查就停了,再也不重测、也不重新择优——直到
// 下次有连接走它才重新启动(sing-box protocol/group/urltest.go 的 Touch / loopCheck)。
// 后果是:不常用的组会长期停在一个已经不通的节点上(内核在拨号失败时只删该节点的延迟记录,
// 并不重新择优),用户点开代理页看到的就是"选中的线路没有延迟、也不自动换"。
// 12 小时:一天之内用过一次的组就一直保持每 3 分钟一检。代价是这些组的成员会持续被测速,
// 但同一个节点的延迟记录是全局共享的,3 分钟内只会被测一次,不会因为组多就成倍增加。
export const DEFAULT_IDLE_TIMEOUT = '12h'
// sing-box 要求 interval ≤ idle_timeout,否则启动时 FATAL("interval must be less or equal than
// idle_timeout"),而 `sing-box check` 查不出这一条。用户把间隔设成一天时,idle_timeout 跟着抬到和
// interval 一样长;没设或设得比 interval 长的照用。
export const idleTimeoutFor = (idleTimeout, interval) => {
  const idle = idleTimeout || DEFAULT_IDLE_TIMEOUT
  const idleMs = parseDuration(idle)
  const intervalMs = parseDuration(interval)
  return intervalMs > 0 && idleMs > 0 && intervalMs > idleMs ? interval : idle
}

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
// (国旗满框、品牌标带留白),让用户自己拨一下。限在 ±20 之内:偏移按代理页 46px 的大图标算,
// -20 还剩一半多,+20 是 1.4 倍,再大就不是调图标了。前端 IconScaleInput.vue 的 LIMIT 同一个数。
export const ICON_SCALE_LIMIT = 20
export const normalizeIconScale = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(-ICON_SCALE_LIMIT, Math.min(ICON_SCALE_LIMIT, Math.round(n)))
}

const inRange = (v, [lo, hi], fallback) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.floor(n) : fallback
}
// 主备页签:id 稳定(拖拽排序、保存、运行状态都按它认),name / icon 可选(不决定主备顺序;icon 空 = 继承
// 父组的图标),members 只存节点名、同一页签内去重。老记录缺 id 的补一个,重复的 id 加后缀——运行映射按 id
// 对齐,重复了就分不清
export const normalizeLanes = (raw) => {
  const seen = new Set()
  return (Array.isArray(raw) ? raw : []).slice(0, FAILOVER_MAX_LANES).map((lane, i) => {
    let id = isNonEmptyString(lane?.id) ? lane.id.trim() : `lane-${i + 1}`
    while (seen.has(id)) id = `${id}~`
    seen.add(id)
    const members = []
    for (const m of Array.isArray(lane?.members) ? lane.members : []) {
      if (isNonEmptyString(m) && !members.includes(m.trim())) members.push(m.trim())
    }
    return { id, name: isNonEmptyString(lane?.name) ? lane.name.trim() : '', icon: isNonEmptyString(lane?.icon) ? lane.icon.trim() : '', members }
  })
}

// 把外部传进来的一条组定义收敛成内部形状;不合法的字段回落默认值而不是抛错——
// 这个函数同时用于读取历史数据,老记录缺字段是正常的。
export const normalizeGroup = (raw, index = 0) => {
  const type = GROUP_TYPES.includes(raw?.type) ? raw.type : 'selector'
  // allNodes 是 mode 之前的写法(只有"全部节点"这一种动态),等价于一个不带关键词的
  // 动态组。老记录照这个规则迁移,行为不变。故障转移只有静态一种,mode 固定
  const mode = type === 'failover' ? 'static' : GROUP_MODES.includes(raw?.mode) ? raw.mode : (raw?.allNodes === true ? 'dynamic' : 'static')
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
  if (type === 'failover') {
    // 主备定义只有 lanes 这一份真实来源:members / keywords 对故障转移没有意义,清空免得两份对不上
    group.keywords = []
    group.members = []
    group.lanes = normalizeLanes(raw?.lanes)
    group.testUrl = isNonEmptyString(raw?.testUrl) ? raw.testUrl.trim() : ''
    const interval = isNonEmptyString(raw?.interval) ? raw.interval.trim() : ''
    const intervalMs = parseDuration(interval)
    group.interval = intervalMs >= FAILOVER_LIMITS.intervalMs[0] && intervalMs <= FAILOVER_LIMITS.intervalMs[1] ? interval : FAILOVER_DEFAULTS.interval
    group.tolerance = inRange(raw?.tolerance, FAILOVER_LIMITS.tolerance, FAILOVER_DEFAULTS.tolerance)
    const fo = raw?.failover && typeof raw.failover === 'object' ? raw.failover : {}
    group.failover = {
      timeoutMs: inRange(fo.timeoutMs, FAILOVER_LIMITS.timeoutMs, FAILOVER_DEFAULTS.timeoutMs),
      failureThreshold: inRange(fo.failureThreshold, FAILOVER_LIMITS.failureThreshold, FAILOVER_DEFAULTS.failureThreshold),
      restorePrimary: fo.restorePrimary !== false,
      recoveryHoldMs: inRange(fo.recoveryHoldMs, FAILOVER_LIMITS.recoveryHoldMs, FAILOVER_DEFAULTS.recoveryHoldMs),
    }
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
// matchText:节点名之外再带上识别出的地区名(rename.mjs 挂的 regionName)。订阅关了重命名、节点保留
// 机场原名(比如 "US-01")时,「美国-自动」这种按地区关键词选成员的组照样能选到它
const resolveMembers = (group, nodeTags, groupNameSet, matchText = new Map()) => {
  const nodeTagSet = new Set(nodeTags)
  if (group.mode === 'dynamic') {
    if (!group.keywords.length) return [...nodeTags]
    return nodeTags.filter((tag) => {
      const lower = matchText.get(tag) ?? normalizeForMatch(tag)
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
      // 动态组只挑节点;故障转移的页签也只引用真实节点——都没有组依赖,不可能成环
      const groupDeps = g.mode === 'dynamic' || g.type === 'failover'
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
  const matchText = new Map((nodes || []).map((n) => [n.tag, normalizeForMatch(`${n.regionName || ''} ${n.tag}`)]))

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

  // 故障转移:内部出站(页签子组 / 兜底拒绝)的 tag,和每个父组的运行映射(给后台管理器和界面用)
  const internal = new Set()
  const failover = []
  const nodeTagSet = new Set(nodeTags)
  const usedTags = new Set([...nodeTags, ...normalized.map((g) => g.name)])
  // 内置拒绝在配置里就用它当兜底;被停用(不进配置)时补一个内部的 block 出站,不能用直连占位
  let rejectTag = builtin.blockEnabled ? builtin.block : FAILOVER_REJECT_TAG
  const emitFailover = (g) => {
    const lanes = []
    const refs = []
    g.lanes.forEach((lane, index) => {
      // 只认真实节点:引用组 / 已删掉的节点一律不算有效成员(失效引用留在 members 里给界面显示)
      const valid = lane.members.filter((m) => nodeTagSet.has(m))
      if (!valid.length) {
        lanes.push({ id: lane.id, name: lane.name, icon: lane.icon || '', index, members: lane.members, valid, mode: 'empty', ref: null, subTag: null })
        return
      }
      if (valid.length === 1) {
        lanes.push({ id: lane.id, name: lane.name, icon: lane.icon || '', index, members: lane.members, valid, mode: 'single', ref: valid[0], subTag: null })
        refs.push(valid[0])
        return
      }
      let subTag = laneSubTag(g.id, lane.id)
      while (usedTags.has(subTag)) subTag += '~'
      usedTags.add(subTag)
      internal.add(subTag)
      // 内部子组共用父组的检测参数;idle_timeout 抬到不低于 interval(内核硬性要求)
      outbounds.push({
        type: 'urltest', tag: subTag, outbounds: valid,
        url: g.testUrl || testUrl, interval: g.interval || FAILOVER_DEFAULTS.interval, tolerance: g.tolerance ?? FAILOVER_DEFAULTS.tolerance,
        idle_timeout: idleTimeoutFor(DEFAULT_IDLE_TIMEOUT, g.interval || FAILOVER_DEFAULTS.interval),
      })
      lanes.push({ id: lane.id, name: lane.name, icon: lane.icon || '', index, members: lane.members, valid, mode: 'urltest', ref: subTag, subTag })
      refs.push(subTag)
    })
    // 不同单节点页签引用同一个节点:父 selector 的成员去重,页签定义不合并
    const memberTags = [...new Set(refs)]
    if (rejectTag === FAILOVER_REJECT_TAG && !outbounds.some((o) => o.tag === FAILOVER_REJECT_TAG)) {
      outbounds.push({ type: 'block', tag: FAILOVER_REJECT_TAG })
      internal.add(FAILOVER_REJECT_TAG)
    }
    // 全部页签都没有有效节点:父组仍是合法配置,只剩兜底拒绝,显示「全部不可用」;不补直连
    outbounds.push({
      type: 'selector', tag: g.name,
      outbounds: [...memberTags, rejectTag],
      default: memberTags[0] || rejectTag,
      // 主备真正切换时让旧连接重建(只影响这个 selector 的连接)
      interrupt_exist_connections: true,
    })
    const intervalMs = parseDuration(g.interval || FAILOVER_DEFAULTS.interval)
    failover.push({
      id: g.id, tag: g.name, lanes, rejectTag,
      settings: {
        interval: g.interval || FAILOVER_DEFAULTS.interval, intervalMs, tolerance: g.tolerance ?? FAILOVER_DEFAULTS.tolerance,
        testUrl: g.testUrl || testUrl, ...(g.failover || FAILOVER_DEFAULTS),
      },
    })
  }

  // 按列表顺序出:内置出站和节点组混排,用户拖成什么样内核里就是什么样
  for (const g of active) {
    if (g.kind === 'direct') { outbounds.push({ type: 'direct', tag: g.name }); continue }
    if (g.kind === 'block') { outbounds.push({ type: 'block', tag: g.name }); continue }
    if (!withoutCycles.includes(g)) continue
    if (g.type === 'failover') { emitFailover(g); continue }
    let members = resolveMembers(g, nodeTags, groupNameSet, matchText)
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
        idle_timeout: idleTimeoutFor(g.idleTimeout, g.interval || DEFAULT_INTERVAL),
      })
    } else {
      outbounds.push({ type: 'selector', tag: g.name, outbounds: members })
    }
  }

  // publicTags:能出现在节点管理列表、站点集出口候选、别的组候选里的出站(内置 + 用户组的父组);
  // 内部子组 / 兜底拒绝只在 outbounds 里,不在这份清单里
  const publicTags = outbounds.filter((o) => !internal.has(o.tag)).map((o) => o.tag)
  return { outbounds, dropped, placeholders, builtin, internalTags: [...internal], publicTags, failover }
}
