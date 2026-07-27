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
