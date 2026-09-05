<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type Ref, watch } from 'vue'
import { RouterView } from 'vue-router'
import OpenboxUpdateDialog from './components/kernel/OpenboxUpdateDialog.vue'
import { resumeUpdateWatch } from './composables/openboxUpdate'
import { useKeyboard } from './composables/keyboard'
import { EMOJIS, FONTS, IS_APPLE_DEVICE } from './constant'
import { autoImportSettings, importSettingsFromUrl } from './helper/autoImportSettings'
import { backgroundImage } from './helper/indexeddb'
import { initNotification } from './helper/notification'
import { isMiddleScreen, isPreferredDark } from './helper/utils'
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

const app = ref<HTMLElement>()
const toast = ref<HTMLElement>()
// 见模板里 OpenboxUpdateDialog 的说明:Teleport 目标就是根节点自己,得等它进了文档再挂
const appMounted = ref(false)
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

// 手机浏览器 / PWA 的状态栏颜色跟着 <meta name="theme-color"> 走。
// 以前直接拿根节点算出来的 background-color:设了背景图之后它是 bg-base-100/90 这种
// 半透明色,Android Chrome 不认带透明度的 theme-color,会退回 manifest 里的颜色,于是
// 亮色主题下顶部也是一条黑的。现在改成拿主题自己的 --color-base-100(不透明),再用
// canvas 折算成 rgb——daisyUI 的颜色是 oklch 写法,老一点的 WebView 不一定认。
const resolveOpaqueColor = (cssColor: string) => {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 1, 1)
  ctx.fillStyle = cssColor
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `rgb(${r}, ${g}, ${b})`
}

const setThemeColor = () => {
  const base = getComputedStyle(document.body).getPropertyValue('--color-base-100').trim()
  const fallback = app.value ? getComputedStyle(app.value).getPropertyValue('background-color').trim() : ''
  const themeColor = resolveOpaqueColor(base || fallback) || fallback
  const metaThemeColor = document.querySelector('meta[name="theme-color"]')
  if (metaThemeColor && themeColor) {
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

onMounted(() => {
  appMounted.value = true
  cleanupWindowResizeState = initializeWindowResizeState()

  // 后台可能正在升级(自己点的、定时任务发起的,或者刚被面板重启打断过):接着把弹窗显示出来
  void resumeUpdateWatch()

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
      // 全局间距 = 8px,和代理页写死的 p-2 / gap-2 一致(工具栏、日志行、连接表、虚拟列表都用它)
      '--app-space': '0.5rem',
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
    <!-- 升级弹窗挂在根上:升级期间面板和内核各会重启一次,不管用户在哪一页都盖上去。
         必须等 App 挂载完成再渲染:弹窗用 Teleport 送到 #app-content,而这个 id 就在上面这个
         div 上——首次渲染时它还没进文档,子组件此时挂载会拿不到目标,Vue 只警告一句
         "Failed to locate Teleport target" 然后什么都不渲染(v0.1.77/78 就是这样,点了升级
         没有弹窗)。路由页的弹窗不受影响,因为路由是懒加载的、挂载时根节点已经在文档里了。 -->
    <OpenboxUpdateDialog v-if="appMounted" />
    <div
      ref="toast"
      class="toast-sm toast toast-end toast-top z-[100000] max-w-80 text-sm md:max-w-96 md:translate-y-8"
    />
  </div>
</template>
