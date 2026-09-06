<template>
  <!-- 外框是 size × size 的方框,和代理页 ProxyIcon.vue 一模一样:国旗按 4:3 塞进方框里
       (宽 = size,高 = size × 3/4),标识 / 地球铺满方框。同一个图标在设置页的列表、规则页、
       代理页看到的形状和相对大小才一致——以前这里是 4:3 的盒子让国旗铺满,同一面国旗在
       列表里比旁边的标识宽出三分之一,到规则页又缩回方框里,像两个不同的图标。
       所有种类外框一样宽,列表里图标后面的文字才对得齐。 -->
  <span
    class="inline-flex shrink-0 items-center justify-center"
    :class="scaleStyle && 'overflow-hidden'"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :title="title || code"
  >
    <!-- 缩放只发生在盒子里(从中心放大 / 缩小),放不下就裁掉,外框尺寸不变,旁边的文字不动。
         只有真的缩放了才裁:线条地球的元素框本来就比盒子大两像素(见下面 monoGlyph),
         不缩放时照旧让它探出去,别把描边切掉。 -->
    <span
      class="inline-flex shrink-0 items-center justify-center"
      :style="scaleStyle"
    >
    <!-- 彩色标识:整段 svg 当 data: URI 塞进 <img>。不用 v-html——<img> 里的 svg
         不执行脚本,而且这些标记是编译进来的常量,走 <img> 一劳永逸。 -->
    <img
      v-if="brandSvg"
      :src="brandSvg"
      :alt="code"
      :style="{ width: `${glyph}px`, height: `${glyph}px`, objectFit: 'contain' }"
    />
    <!-- 单色标识:内联出来才好上色(<img> 里没法跟着主题变) -->
    <svg
      v-else-if="brand"
      viewBox="0 0 24 24"
      :style="{ width: `${glyph}px`, height: `${glyph}px` }"
      :fill="brandFill"
      :class="brandFill === 'currentColor' ? 'text-base-content/80' : ''"
    >
      <path :d="brand.path" />
    </svg>
    <img
      v-else-if="src"
      :src="src"
      :alt="code"
      :class="square ? '' : 'ring-base-content/15 ring-1'"
      :style="
        square
          ? { width: `${glyph}px`, height: `${glyph}px` }
          : { width: `${glyph}px`, height: `${flagHeight}px`, objectFit: 'cover' }
      "
    />
    <!-- 线条地球:节点组可以选,也是"认不出代码"时的占位。选中的用正常前景色,
         占位用淡色——一个是用户挑的图标,一个是"这里没有图标"。 -->
    <component
      :is="globeComponent"
      v-else
      :class="isGlobe ? 'text-base-content/70' : 'text-base-content/30'"
      :style="{ width: `${monoGlyph}px`, height: `${monoGlyph}px` }"
    />
    </span>
  </span>
</template>

<script setup lang="ts">
import { findBrand } from '@/constant/brands'
import { iconScaleFactor } from '@/helper/iconScale'
import { isGlobeIcon } from '@/constant/countries'
import { isMiscIcon } from '@/constant/misc-icons'
import {
  GlobeAltIcon,
  GlobeAmericasIcon,
  GlobeAsiaAustraliaIcon,
  GlobeEuropeAfricaIcon,
} from '@heroicons/vue/24/outline'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    // ISO 3166-1 alpha-2,大小写都行;认不出来就退化成地球图标
    code?: string
    size?: number
    title?: string
    // 像素偏移:+1 画成 size+1 那么大,-1 画成 size-1;外框不变(见 IconScaleInput.vue)
    scale?: number
  }>(),
  { code: '', size: 16, title: '', scale: 0 },
)

const scaleStyle = computed(() => {
  // 比例按代理页大图标算(见 helper/iconScale.ts),小国旗等比缩放
  const factor = iconScaleFactor(props.scale)
  return factor === 1 ? undefined : { transform: `scale(${factor})`, transformOrigin: 'center' }
})

// 编译期把 src/assets/flags 下的 svg 全部登记成 URL,浏览器只会真正去取显示到的那几个。
// 不用 `new URL('../assets/flags/' + code + '.svg', import.meta.url)`:那种拼接
// Vite 打包时解析不了,生产构建下会 404。
const FLAG_URL = import.meta.glob<string>('../../assets/flags/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
})

const isGlobe = computed(() => isGlobeIcon(props.code))
const isMisc = computed(() => isMiscIcon(props.code))
const brand = computed(() => findBrand(props.code))

const brandSvg = computed(() => {
  const svg = brand.value?.svg
  return svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : ''
})

// 单色标识的填充。品牌色照搬各家的 hex,但近黑的那几个(GitHub #181717、Apple #000)
// 在深色主题下会糊进背景里,那种情况下改用 currentColor 跟着主题走——认得出形状比
// 色号准确重要。
const brandFill = computed(() => {
  const hex = brand.value?.hex || ''
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 'currentColor'
  const n = parseInt(m[1], 16)
  const luma = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return luma < 0.22 ? 'currentColor' : hex
})

const GLOBE_COMPONENT: Record<string, unknown> = {
  'globe:generic': GlobeAltIcon,
  'globe:asia': GlobeAsiaAustraliaIcon,
  'globe:europe': GlobeEuropeAfricaIcon,
  'globe:americas': GlobeAmericasIcon,
}
const globeComponent = computed(() => GLOBE_COMPONENT[String(props.code).toLowerCase()] || GlobeAltIcon)

// 彩色地球和国旗一样是图片资源,只是放在另一个目录
const GLOBE_URL = import.meta.glob<string>('../../assets/globes/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
})

// 「其他」那一栏的通用图标(Twemoji),同样是按需去取的图片资源
const MISC_URL = import.meta.glob<string>('../../assets/misc/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
})

// 地球和通用图标都是方的:铺满方框即可,不像国旗那样是 4:3 的扁长方形还要描边
const square = computed(() => isGlobe.value || isMisc.value)

// 国旗素材统一是 4:3(flag-icons 的 640×480),宽铺满方框,高就是 3/4——和 <img> 把
// 同一个 svg 塞进 ProxyIcon 方框里的结果一样(svg 自己按比例居中),两边算出来完全一致
const glyph = computed(() => props.size)
const flagHeight = computed(() => Math.round((props.size * 3) / 4))
// 目标:地球画出来的圆,和方框一样大(size)。
// 两种地球的"墨迹"占各自画布的比例不同,所以给的边长也不同:
//   彩色(Twemoji):圆 r=18 / viewBox 36 —— 铺满,比例 1.0,给 size 就够
//   线条(heroicons):圆 r=9 加 1.5 描边 / viewBox 24 —— 比例 0.8125,要给
//     size / 0.8125 才画得出一个 size 大的圆
// 线条那个的元素框因此比方框大两像素,往四周探出去一点——它只是一条细描边,
// 没有底色,看不出来,而外框仍是统一的方框,文字照样对齐。
const monoGlyph = computed(() => Math.round(props.size / 0.8125))

const src = computed(() => {
  if (isGlobe.value) {
    const variant = props.code.slice('globe:'.length).toLowerCase()
    return GLOBE_URL[`../../assets/globes/${variant}.svg`] || ''
  }
  if (isMisc.value) {
    const id = props.code.slice('misc:'.length).toLowerCase()
    return MISC_URL[`../../assets/misc/${id}.svg`] || ''
  }
  const code = String(props.code || '').toLowerCase()
  if (!code) return ''
  return FLAG_URL[`../../assets/flags/${code}.svg`] || ''
})
</script>
