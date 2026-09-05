import { LANG, MIN_PROXY_CARD_WIDTH, PROXY_CARD_SIZE } from '@/constant'
import { getManagedStorageSnapshot } from '@/helper/persistentStorage'
import { useMediaQuery } from '@vueuse/core'
import dayjs from 'dayjs'
import prettyBytes, { type Options } from 'pretty-bytes'

export const isPreferredDark = useMediaQuery('(prefers-color-scheme: dark)')

/**
 * Maps a raw `navigator.language` value to one of the three supported UI
 * languages, by prefix:
 *   - zh-TW / zh-HK / zh-Hant* -> zh-tw
 *   - any other zh*           -> zh
 *   - everything else         -> en
 */
export const detectDefaultLanguage = (navigatorLanguage: string): LANG => {
  const lang = (navigatorLanguage || '').toLowerCase()

  if (!lang.startsWith('zh')) {
    return LANG.EN_US
  }

  if (lang.includes('tw') || lang.includes('hk') || lang.includes('hant')) {
    return LANG.ZH_TW
  }

  return LANG.ZH_CN
}

export const isMiddleScreen = useMediaQuery('(max-width: 768px)')
export const isPWA = (() => {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone
})()

// daisyUI 的颜色是 oklch 写法。浏览器本身认,但 ECharts(zrender)自己解析颜色——悬停高亮时要把线条
// 提亮一档——解析不了 oklch 就得到空色,曲线一悬停就整条消失。这里让浏览器用 canvas 折算成 rgb / rgba,
// 带透明度的保留透明度。转不了(比如空串)就原样返回。
let colorCtx: CanvasRenderingContext2D | null | undefined
export const cssColorToRgb = (cssColor: string) => {
  const color = cssColor.trim()
  if (!color) return color
  if (colorCtx === undefined) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    colorCtx = canvas.getContext('2d', { willReadFrequently: true })
  }
  if (!colorCtx) return color
  colorCtx.clearRect(0, 0, 1, 1)
  colorCtx.fillStyle = color
  colorCtx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = colorCtx.getImageData(0, 0, 1, 1).data
  return a >= 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`
}

export const prettyBytesHelper = (bytes: number, opts?: Options) => {
  return prettyBytes(bytes, {
    binary: false,
    ...opts,
  })
}

export const fromNow = (timestamp: string) => {
  return dayjs(timestamp).fromNow()
}

export const exportSettings = (options: { desensitized?: boolean } = {}) => {
  const settings = getManagedStorageSnapshot()

  void options.desensitized

  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ange-clashboard-settings'
  a.click()
  URL.revokeObjectURL(url)
}

export const getMinCardWidth = (size: PROXY_CARD_SIZE) => {
  return size === PROXY_CARD_SIZE.LARGE ? MIN_PROXY_CARD_WIDTH.LARGE : MIN_PROXY_CARD_WIDTH.SMALL
}

export const SCROLLABLE_PARENT_CLASS = 'scrollable-parent'

export const scrollIntoCenter = (el: HTMLElement) => {
  const scrollableParent = findScrollableParent(el)

  if (!scrollableParent) return

  const elRect = el.getBoundingClientRect()
  const parentRect = scrollableParent.getBoundingClientRect()

  if (elRect.top >= parentRect.top && elRect.bottom <= parentRect.bottom) return

  const parentTop = scrollableParent.offsetTop
  const childTop = el.offsetTop

  const centerOffset =
    childTop - parentTop - scrollableParent.clientHeight / 2 + el.clientHeight / 2

  scrollableParent.scrollTo({
    top: centerOffset,
    behavior: 'smooth',
  })
}

export const findScrollableParent = (el: HTMLElement | null): HTMLElement | null => {
  const parent = el?.parentElement

  if (
    parent?.classList.contains(SCROLLABLE_PARENT_CLASS) &&
    parent.scrollHeight > parent.clientHeight
  ) {
    return parent
  }

  return parent ? findScrollableParent(parent) : null
}
