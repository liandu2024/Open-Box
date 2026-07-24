export { DEFAULT_REGION_DICT, DEFAULT_FEATURE_DICT } from './dictionaries.mjs'

export const matchRegion = (name, dict) => {
  const lower = String(name || '').toLowerCase()
  for (const region of dict) {
    for (const kw of region.keywords) {
      if (lower.includes(String(kw).toLowerCase())) return { code: region.code, name: region.name }
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
