export { DEFAULT_REGION_DICT, DEFAULT_FEATURE_DICT } from './dictionaries.mjs'
import { DEFAULT_REGION_DICT as REGIONS, DEFAULT_FEATURE_DICT as FEATURES } from './dictionaries.mjs'

// 纯 ASCII 短码(如 us/hk/jp/uk/de,长度 2~3)容易在 Russia/Sweden/Ukraine/Australia
// 等词中被 includes 子串误配,需要 token 边界匹配(前后是非字母或字符串边界)。
// CJK/城市名/emoji 关键字不受此影响,继续用 includes。
const SHORT_ASCII_CODE = /^[a-z]{2,3}$/i

const keywordMatches = (lower, kw) => {
  const needle = String(kw).toLowerCase()
  if (SHORT_ASCII_CODE.test(needle)) {
    const boundary = new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`, 'i')
    return boundary.test(lower)
  }
  return lower.includes(needle)
}

export const matchRegion = (name, dict) => {
  const lower = String(name || '').toLowerCase()
  for (const region of dict) {
    for (const kw of region.keywords) {
      if (keywordMatches(lower, kw)) return { code: region.code, name: region.name }
    }
  }
  return null
}

export const extractFeatures = (name, dict) => {
  const lower = String(name || '').toLowerCase()
  const labels = []
  for (const feature of dict) {
    if (labels.includes(feature.label)) continue
    if (feature.keywords.some((kw) => lower.includes(String(kw).toLowerCase()))) {
      labels.push(feature.label)
    }
  }
  return labels
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
  const featureDict = options.featureDict || FEATURES
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
