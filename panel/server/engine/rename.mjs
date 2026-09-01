export { DEFAULT_REGION_DICT, DEFAULT_FEATURE_KEYWORDS } from './dictionaries.mjs'
import { DEFAULT_REGION_DICT as REGIONS, DEFAULT_FEATURE_KEYWORDS as FEATURES } from './dictionaries.mjs'

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

export const renameNodes = (nodes, options = {}) => {
  const regionDict = options.regionDict || REGIONS
  // featureKeywords 是新写法(扁平关键词表);featureDict 是老档案里的两层结构,
  // extractFeatures 内部会扁平化,这里只负责挑一个非空的来源。
  const featureDict = options.featureKeywords || options.featureDict || FEATURES
  const template = options.template || '{region}-{feature}-{seq}'
  const unknownLabel = options.unknownLabel || '其他'
  const seqPad = options.seqPad ?? 2
  const counters = new Map()

  return nodes.map((node) => {
    const region = matchRegion(node.originalTag, regionDict)
    const features = extractFeatures(node.originalTag, featureDict)
    const regionName = region ? region.name : unknownLabel
    // 未命中区域:把原名作为 feature 位保留
    const featureStr = region ? features.join('-') : node.originalTag
    // 序号分组只看首个命中的特征(而非完整拼接串),让 "专线" 与 "专线-2x" 共用同一组序号
    const keyFeature = region ? (features[0] || '') : node.originalTag
    const key = `${regionName}|${keyFeature}`
    const next = (counters.get(key) || 0) + 1
    counters.set(key, next)
    const seq = String(next).padStart(seqPad, '0')
    const tag = applyTemplate(template, regionName, featureStr, seq)
    return { ...node, tag }
  })
}

export const previewRename = (nodes, options = {}) =>
  renameNodes(nodes, options).map((n, i) => ({ originalTag: nodes[i].originalTag, newTag: n.tag }))
