// geosite / geoip 分类说明的取法,全项目共用:值选择器的下拉行、站点集详情弹窗都从这里取,
// 别再各自造一遍。行的形状是 [名称, 简体, 英文, 繁体?](constant/geo-catalog.ts)。
import type { GeoCategoryRow } from '@/constant/geo-catalog'

export type GeoKind = 'geosite' | 'geoip'

// 按当前语言挑一列;繁体缺省时退回简体,英文缺省时也退回简体
export const pickGeoNote = (row: GeoCategoryRow, locale: string): string => {
  if (locale === 'zh-TW') return row[3] || row[1] || ''
  if (locale.startsWith('zh')) return row[1] || ''
  return row[2] || row[1] || ''
}

// 上游有几百个 `<基名>@<属性>` 的子集(google@ads、ccb@!cn、chinamobile@cn……),分类注释库里
// 没有独立条目——与其让它们空着,不如就地拼:基名的说明 + 属性是什么。
const ATTR_KEY: Record<string, string> = {
  ads: 'geoCategoryAttrAds',
  cn: 'geoCategoryAttrCn',
  '!cn': 'geoCategoryAttrNotCn',
}

export const composeGeoNote = (
  row: GeoCategoryRow,
  rowsByName: Map<string, GeoCategoryRow>,
  locale: string,
  t: (key: string) => string,
): string => {
  const own = pickGeoNote(row, locale)
  if (own) return own
  const at = row[0].indexOf('@')
  if (at < 0) return ''
  const attrKey = ATTR_KEY[row[0].slice(at + 1)]
  if (!attrKey) return ''
  const base = rowsByName.get(row[0].slice(0, at))
  const baseNote = base ? pickGeoNote(base, locale) : ''
  return baseNote ? `${baseNote} · ${t(attrKey)}` : t(attrKey)
}

// 目录是懒加载的(两千多行,不该进首屏包);这里统一缓存
const cache: Partial<Record<GeoKind, readonly GeoCategoryRow[]>> = {}
export const loadGeoCatalog = async (kind: GeoKind): Promise<readonly GeoCategoryRow[]> => {
  if (!cache[kind]) {
    const mod = await import('@/constant/geo-catalog')
    cache.geosite = mod.GEOSITE_CATEGORIES
    cache.geoip = mod.GEOIP_CATEGORIES
  }
  return cache[kind] || []
}

// 给一个完整 tag(geosite-google@ads)找说明
export const geoTagNote = async (tag: string, locale: string, t: (key: string) => string): Promise<string> => {
  const m = /^(geosite|geoip)-(.+)$/.exec(tag)
  if (!m) return ''
  const rows = await loadGeoCatalog(m[1] as GeoKind)
  const byName = new Map(rows.map((r) => [r[0], r]))
  const row = byName.get(m[2])
  return row ? composeGeoNote(row, byName, locale, t) : ''
}
