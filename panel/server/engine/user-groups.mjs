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

export const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204'
export const DEFAULT_INTERVAL = '3m'
export const DEFAULT_TOLERANCE = 50

// 两个开箱即用的组:一份自动择优、一份手动指定,成员都是"当前所有有效节点"。
// allNodes 是动态的——订阅刷新后节点变了,组的成员跟着变,不需要用户回来重新勾一遍。
export const defaultGroups = () => ([
  {
    id: 'all-auto',
    name: '所有-自动',
    type: 'urltest',
    mode: 'dynamic',
    keywords: [],
    members: [],
    interval: DEFAULT_INTERVAL,
    tolerance: DEFAULT_TOLERANCE,
  },
  {
    id: 'all-manual',
    name: '所有-手动',
    type: 'selector',
    mode: 'dynamic',
    keywords: [],
    members: [],
  },
])

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0

// 图标既可能是两位国家代码,也可能是 globe:asia 这种非国家图标。只有前者该转大写
// ——把 globe:asia 转成 GLOBE:ASIA 的话,界面按值查不到对应图标,直接变成空白。
const normalizeIcon = (raw) => {
  if (!isNonEmptyString(raw)) return ''
  const v = raw.trim()
  // 国家代码统一大写(hk -> HK),地球图标统一小写(GLOBE:ASIA -> globe:asia)。
  // 两种都归一,是因为界面按这个值去查图标:大小写不一致就查不到,直接显示成空白。
  if (/^globe:/i.test(v)) return v.toLowerCase()
  return /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : v
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
    // 图标:国家代码(ISO 3166-1 alpha-2),空表示不显示。纯界面用,不进 sing-box 配置
    // ——那边没有这个字段,写进去内核直接报未知字段。
    // 国家代码统一成大写(hk -> HK);地球图标是 globe:xxx 这种,原样留着不能动
    icon: normalizeIcon(raw?.icon),
    keywords: Array.isArray(raw?.keywords) ? raw.keywords.filter(isNonEmptyString).map((k) => k.trim()) : [],
    members: Array.isArray(raw?.members) ? raw.members.filter(isNonEmptyString).map((m) => m.trim()) : [],
  }
  if (type === 'urltest') {
    group.interval = isNonEmptyString(raw?.interval) ? raw.interval.trim() : DEFAULT_INTERVAL
    const tol = Number(raw?.tolerance)
    group.tolerance = Number.isFinite(tol) && tol >= 0 ? Math.floor(tol) : DEFAULT_TOLERANCE
  }
  return group
}

export const normalizeGroups = (list) =>
  (Array.isArray(list) ? list : []).map((g, i) => normalizeGroup(g, i))

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

  const withoutCycles = dropCycles(normalized)
  const droppedByCycle = normalized.filter((g) => !withoutCycles.includes(g))

  const groupNameSet = new Set(withoutCycles.map((g) => g.name))
  const outbounds = []
  const dropped = droppedByCycle.map((g) => ({ name: g.name, reason: 'cycle' }))

  for (const g of withoutCycles) {
    const members = resolveMembers(g, nodeTags, groupNameSet)
    if (!members.length) {
      dropped.push({ name: g.name, reason: 'empty' })
      continue
    }
    if (g.type === 'urltest') {
      outbounds.push({
        type: 'urltest',
        tag: g.name,
        outbounds: members,
        url: testUrl,
        interval: g.interval || DEFAULT_INTERVAL,
        tolerance: g.tolerance ?? DEFAULT_TOLERANCE,
      })
    } else {
      outbounds.push({ type: 'selector', tag: g.name, outbounds: members })
    }
  }

  return { outbounds, dropped }
}
