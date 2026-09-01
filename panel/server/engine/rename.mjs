export { DEFAULT_REGION_DICT, DEFAULT_FEATURE_KEYWORDS, DEFAULT_EXCLUDE_KEYWORDS } from './dictionaries.mjs'
import {
  DEFAULT_REGION_DICT as REGIONS,
  DEFAULT_FEATURE_KEYWORDS as FEATURES,
  DEFAULT_EXCLUDE_KEYWORDS as EXCLUDES,
} from './dictionaries.mjs'

// 纯 ASCII 短码(如 us/hk/jp/uk/de,长度 2~3)容易在 Russia/Sweden/Ukraine/Australia
// 等词中被 includes 子串误配,需要 token 边界匹配(前后是非字母或字符串边界)。
// CJK/城市名/emoji 关键字不受此影响,继续用 includes。
const SHORT_ASCII_CODE = /^[a-z]{2,3}$/i

// 国旗 emoji 本质就是两个「区域指示符」字母:🇭🇰 = U+1F1ED U+1F1F0 = H,K。
// 匹配前把它们还原成 ASCII 字母,于是 "🇭🇰香港 01" 天然被已有的关键词 "hk" 命中,
// 词典里就不必再收一份没法用键盘输入的国旗(用户反馈:规则里国旗没法输入)。
// 两侧都要归一:老用户已存的词典里可能还留着国旗关键词,归一后它变成 "hk",
// 照样能匹配上,不会因为这次改动突然失效。
// 左右补空格是为了保住 token 边界——两个国旗连着写(🇭🇰🇨🇳)否则会粘成 "hkcn",
// 而 hk 的短码匹配要求前后不是字母。
const REGIONAL_INDICATOR_PAIR = /[\u{1F1E6}-\u{1F1FF}]{2}/gu
export const normalizeForMatch = (text) =>
  String(text || '')
    .replace(REGIONAL_INDICATOR_PAIR, (flag) =>
      ' ' + [...flag].map((c) => String.fromCharCode(c.codePointAt(0) - 0x1f1e6 + 97)).join('') + ' ',
    )
    .toLowerCase()

const keywordMatches = (lower, kw) => {
  const needle = normalizeForMatch(kw).trim()
  if (!needle) return false
  if (SHORT_ASCII_CODE.test(needle)) {
    const boundary = new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`, 'i')
    return boundary.test(lower)
  }
  return lower.includes(needle)
}

export const matchRegion = (name, dict) => {
  const lower = normalizeForMatch(name)
  for (const region of dict) {
    for (const kw of region.keywords) {
      if (keywordMatches(lower, kw)) return { code: region.code, name: region.name }
    }
  }
  return null
}

// 兼容旧档案:老的 featureDict 是 [{label, keywords}] 两层结构,扁平化成关键词表。
// 语义会随之改变(以前命中 iplc 显示「专线」,现在显示 IPLC),这正是本次要的效果。
export const toFeatureKeywords = (input) => {
  if (!Array.isArray(input)) return []
  const out = []
  for (const item of input) {
    if (typeof item === 'string') {
      if (item.trim()) out.push(item.trim())
    } else if (item && Array.isArray(item.keywords)) {
      for (const kw of item.keywords) if (String(kw).trim()) out.push(String(kw).trim())
    }
  }
  return out
}

// 命中哪个关键词就返回哪个关键词,统一转大写(中文没有大小写,原样保留)。
// 按关键词表的先后顺序输出,同一个词只出现一次——节点名里同时写了 IPLC 和 iplc
// 不该产出 "IPLC-IPLC"。
export const extractFeatures = (name, dict) => {
  const lower = normalizeForMatch(name)
  const hits = []
  for (const kw of toFeatureKeywords(dict)) {
    const needle = normalizeForMatch(kw).trim()
    if (!needle || !lower.includes(needle)) continue
    const shown = String(kw).toUpperCase()
    if (!hits.includes(shown)) hits.push(shown)
  }
  return hits
}

const applyTemplate = (template, region, feature, seq) => {
  // 先替换 {feature};无特征时把 "{feature}" 及其紧邻的一个分隔符一起去掉
  // 注意:替换值(feature/region/originalTag 等)可能含 $&、$1 等 String.replace 特殊
  // 替换模式字符,必须用函数形式替换,避免被当成替换模式解析而破坏输出。
  let out = template
  if (feature) {
    out = out.replace('{feature}', () => feature)
  } else {
    out = out.replace(/([-_/\s])?\{feature\}([-_/\s])?/, (m, a, b) => {
      // 保留一侧分隔符:若两侧都有分隔符,合并为一个
      if (a && b) return a
      return ''
    })
  }
  return out.replace('{region}', () => region).replace('{seq}', () => seq)
}

// 过滤:原始节点名命中任一关键词就整条丢弃。和区域匹配共用 keywordMatches,所以
// 纯 ASCII 短码(如 "vip")同样受 token 边界保护,不会因为出现在别的单词里就误伤——
// 这个功能会让节点凭空消失,误伤的代价比漏网大得多。
export const isExcludedName = (name, keywords) => {
  const list = Array.isArray(keywords) ? keywords : []
  if (!list.length) return false
  const lower = normalizeForMatch(name)
  return list.some((kw) => String(kw).trim() && keywordMatches(lower, kw))
}

// 在改名之前先过滤:renameNodes / previewRename 是按下标一一对应的,若在改名内部
// 丢条目,预览表的原名与新名就会错位。
export const excludeNodes = (nodes, options = {}) => {
  const keywords = options.excludeKeywords || EXCLUDES
  const kept = []
  const excluded = []
  for (const node of nodes) {
    if (isExcludedName(node.originalTag, keywords)) excluded.push(node)
    else kept.push(node)
  }
  return { kept, excluded }
}

export const renameNodes = (nodes, options = {}) => {
  const regionDict = options.regionDict || REGIONS
  // featureKeywords 是新写法(扁平关键词表);featureDict 是老档案里的两层结构,
  // extractFeatures 内部会扁平化,这里只负责挑一个非空的来源。
  const featureDict = options.featureKeywords || options.featureDict || FEATURES
  const template = options.template || '{region}-{feature}-{seq}'
  const unknownLabel = options.unknownLabel || '其他'
  const seqPad = options.seqPad ?? 2
  // 逐条手工改名:originalTag -> 用户指定的名字。改过名的节点不再消耗序号,否则同组
  // 里会出现 香港-01 / 我的香港 / 香港-03 这种跳号。
  const overrides = (options.overrides && typeof options.overrides === 'object') ? options.overrides : {}
  const counters = new Map()

  const renamed = nodes.map((node) => {
    const region = matchRegion(node.originalTag, regionDict)
    const features = extractFeatures(node.originalTag, featureDict)
    // 未命中区域就用「无法识别地区时的标签」,其余照常走模板——不再把原名整个塞进
    // feature 位。旧写法有两处坏处:节点名会变成「其他-🇫🇷法国01｜三网-01」这种又长又
    // 没规整的东西;而且序号是按"区域+首个特征"分组的,原名当特征等于每个节点各成一组,
    // 于是全都是 -01(真机上三条法国节点就是这样)。现在它们是 其他-01/02/03。
    const regionName = region ? region.name : unknownLabel
    const featureStr = features.join('-')
    // 序号分组只看首个命中的特征(而非完整拼接串),让 "专线" 与 "专线-2x" 共用同一组序号
    const keyFeature = features[0] || ''
    const override = typeof overrides[node.originalTag] === 'string' ? overrides[node.originalTag].trim() : ''
    let tag
    if (override) {
      tag = override
    } else {
      const key = `${regionName}|${keyFeature}`
      const next = (counters.get(key) || 0) + 1
      counters.set(key, next)
      tag = applyTemplate(template, regionName, featureStr, String(next).padStart(seqPad, '0'))
    }
    // regionRank 只用于排序,不进最终节点对象
    const regionRank = region ? regionDict.findIndex((r) => r.name === regionName) : -1
    return { node: { ...node, tag }, regionRank }
  })

  // 按地区词典的顺序排列,未识别的(「其他」)一律垫底。词典顺序是用户在规则页拖出来
  // 的,那既是匹配优先级,也理应是节点的呈现顺序——否则界面上排在最前的地区,到了
  // 节点列表和策略组里还是按订阅原始顺序乱着。
  // 用 Array.prototype.sort 的稳定性保证组内次序不变,序号(01/02/03)是在上面按原始
  // 顺序发的,排完仍然连续。
  return renamed
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => {
      const ra = a.regionRank < 0 ? Number.POSITIVE_INFINITY : a.regionRank
      const rb = b.regionRank < 0 ? Number.POSITIVE_INFINITY : b.regionRank
      return ra - rb || a.index - b.index
    })
    .map((item) => item.node)
}

// 用改名结果自带的 originalTag 配对,不再按下标去索引入参:renameNodes 现在会重排,
// 按下标配会把原名和新名错位。
export const previewRename = (nodes, options = {}) =>
  renameNodes(nodes, options).map((n) => ({ originalTag: n.originalTag, newTag: n.tag }))
