<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type Ref, watch } from 'vue'
import { RouterView } from 'vue-router'
import { useKeyboard } from './composables/keyboard'
import { EMOJIS, FONTS, IS_APPLE_DEVICE } from './constant'
import { autoImportSettings, importSettingsFromUrl } from './helper/autoImportSettings'
import { backgroundImage } from './helper/indexeddb'
import { initNotification } from './helper/notification'
import { getBackendFromUrl, isMiddleScreen, isPreferredDark } from './helper/utils'
import { initializeWindowResizeState, isWindowResizing } from './helper/windowResizeState'
import {
  blurIntensity,
  dashboardTransparent,
  disablePullToRefresh,
  emoji,
  font,
  globalRadius,
  theme,
} from './store/settings'
import { activeUuid, backendList } from './store/setup'
import type { Backend } from './types'

const app = ref<HTMLElement>()
const toast = ref<HTMLElement>()
let cleanupWindowResizeState: (() => void) | undefined

initNotification(toast as Ref<HTMLElement>)

// 字体类名映射表
const FONT_CLASS_MAP = {
  [EMOJIS.TWEMOJI]: {
    [FONTS.MI_SANS]: 'font-MiSans-Twemoji',
    [FONTS.SARASA_UI]: 'font-SarasaUI-Twemoji',
    [FONTS.PING_FANG]: 'font-PingFang-Twemoji',
    [FONTS.FIRA_SANS]: 'font-FiraSans-Twemoji',
    [FONTS.SYSTEM_UI]: 'font-SystemUI-Twemoji',
  },
  [EMOJIS.NOTO_COLOR_EMOJI]: {
    [FONTS.MI_SANS]: 'font-MiSans-NotoEmoji',
    [FONTS.SARASA_UI]: 'font-SarasaUI-NotoEmoji',
    [FONTS.PING_FANG]: 'font-PingFang-NotoEmoji',
    [FONTS.FIRA_SANS]: 'font-FiraSans-NotoEmoji',
    [FONTS.SYSTEM_UI]: 'font-SystemUI-NotoEmoji',
  },
} as const

const fontClassName = computed(() => {
  return (
    FONT_CLASS_MAP[emoji.value]?.[font.value] || FONT_CLASS_MAP[EMOJIS.TWEMOJI][FONTS.SYSTEM_UI]
  )
})

const setThemeColor = () => {
  const themeColor = getComputedStyle(app.value!).getPropertyValue('background-color').trim()
  const metaThemeColor = document.querySelector('meta[name="theme-color"]')
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', themeColor)
  }
}

watch(isPreferredDark, setThemeColor)

const prefersCoarsePointer = window.matchMedia('(hover: none) and (pointer: coarse)')
const isAppleMobileDevice = computed(() => {
  return IS_APPLE_DEVICE && isMiddleScreen.value && prefersCoarsePointer.matches
})

watch(
  isAppleMobileDevice,
  () => {
    document.documentElement.classList.toggle('apple-mobile-ui', isAppleMobileDevice.value)
  },
  {
    immediate: true,
  },
)

watch(
  disablePullToRefresh,
  () => {
    const body = document.body
    if (disablePullToRefresh.value) {
      body.style.overscrollBehavior = 'none'
      body.style.overflow = 'hidden'
    } else {
      body.style.overscrollBehavior = ''
      body.style.overflow = ''
    }
  },
  {
    immediate: true,
  },
)

const isSameBackend = (b1: Omit<Backend, 'uuid'>, b2: Omit<Backend, 'uuid'>) => {
  return (
    b1.host === b2.host &&
    b1.port === b2.port &&
    b1.password === b2.password &&
    b1.protocol === b2.protocol &&
    b1.secondaryPath === b2.secondaryPath
  )
}

const autoSwitchToURLBackendIfExists = () => {
  const backend = getBackendFromUrl()

  if (backend) {
    for (const b of backendList.value) {
      if (isSameBackend(b, backend)) {
        activeUuid.value = b.uuid
        return
      }
    }
  }
}

autoSwitchToURLBackendIfExists()

onMounted(() => {
  cleanupWindowResizeState = initializeWindowResizeState()

  if (autoImportSettings.value) {
    importSettingsFromUrl()
  }
  watch(
    theme,
    () => {
      document.body.setAttribute('data-theme', theme.value)
      setThemeColor()
    },
    {
      immediate: true,
    },
  )
})

onUnmounted(() => {
  cleanupWindowResizeState?.()
  cleanupWindowResizeState = undefined
  document.documentElement.classList.remove('apple-mobile-ui')
})

const blurClass = computed(() => {
  if (!backgroundImage.value || blurIntensity.value === 0 || isWindowResizing.value) {
    return ''
  }

  return `blur-intensity-${blurIntensity.value}`
})

const appStyles = computed(() => {
  const panelRadius = `${Math.min(Math.round(globalRadius.value * 1.05 * 10) / 10, 16)}px`
  const boxRadius = `${Math.min(Math.round(globalRadius.value * 0.85 * 10) / 10, 14)}px`
  const navRadius = `${Math.min(Math.round(globalRadius.value * 0.75 * 10) / 10, 13)}px`
  const fieldRadius = `${Math.min(Math.round(globalRadius.value * 0.58 * 10) / 10, 12)}px`
  const compactRadius = `${Math.min(Math.round(globalRadius.value * 0.4 * 10) / 10, 9)}px`

  return [
    backgroundImage.value,
    {
      '--app-space': '0.75rem',
      '--radius-box': boxRadius,
      '--radius-selector': fieldRadius,
      '--radius-field': fieldRadius,
      '--app-radius-panel': panelRadius,
      '--app-radius-box': boxRadius,
      '--app-radius-nav': navRadius,
      '--app-radius-field': fieldRadius,
      '--app-radius-compact': compactRadius,
    },
  ]
})

useKeyboard()
</script>

<template>
  <div
    ref="app"
    id="app-content"
    :class="[
      'bg-base-100 flex h-dvh w-screen overflow-hidden',
      isWindowResizing && 'is-window-resizing',
      fontClassName,
      backgroundImage &&
        `custom-background-${dashboardTransparent} custom-background bg-cover bg-center`,
      blurClass,
    ]"
    :style="appStyles"
  >
    <RouterView />
    <div
      ref="toast"
      class="toast-sm toast toast-end toast-top z-[100000] max-w-80 text-sm md:max-w-96 md:translate-y-8"
    />
  </div>
</template>
