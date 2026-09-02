// 把图标选择器里的值(HK / globe:asia / brand:google / misc:direct)变成一个能塞进
// <img :src> 的地址。代理页的卡片(ProxyIcon.vue)只认 URL,不认这些短码。
// 国旗/地球/通用图标是文件,直接给 Vite 处理出来的 URL;公司标识在 constant/brands.ts
// 里是 svg 标记或单色路径,拼成 data: URI。
import { findBrand } from '@/constant/brands'
import { isGlobeIcon } from '@/constant/countries'
import { isMiscIcon } from '@/constant/misc-icons'

// 和 components/common/CountryFlag.vue 同一批目录;import.meta.glob 的路径必须是字面量,
// 没法从那边导出来复用
const FLAG_URL = import.meta.glob<string>('../assets/flags/*.svg', { eager: true, query: '?url', import: 'default' })
const GLOBE_URL = import.meta.glob<string>('../assets/globes/*.svg', { eager: true, query: '?url', import: 'default' })
const MISC_URL = import.meta.glob<string>('../assets/misc/*.svg', { eager: true, query: '?url', import: 'default' })

export const iconUrlFor = (code?: string): string => {
  const value = String(code || '').trim()
  if (!value) return ''
  if (isGlobeIcon(value)) return GLOBE_URL[`../assets/globes/${value.slice('globe:'.length).toLowerCase()}.svg`] || ''
  if (isMiscIcon(value)) return MISC_URL[`../assets/misc/${value.slice('misc:'.length).toLowerCase()}.svg`] || ''
  const brand = findBrand(value)
  if (brand) {
    if (brand.svg) return `data:image/svg+xml;utf8,${encodeURIComponent(brand.svg)}`
    if (brand.path) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${brand.hex || '#888'}" d="${brand.path}"/></svg>`
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
    }
    return ''
  }
  return FLAG_URL[`../assets/flags/${value.toLowerCase()}.svg`] || ''
}
