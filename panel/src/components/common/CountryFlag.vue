<template>
  <!-- 一个固定 4:3 的盒子,国旗和地球都放在里面居中——两者外框一模一样,列表里
       图标后面的文字才对得齐。
       国旗铺满整个盒子;地球是圆的,按 0.85 缩一点再居中:同样 16px 高的一个圆
       和一个扁长方形摆在一起,圆看着明显更大(视觉重心问题,不是尺寸问题)。 -->
  <span
    class="inline-flex shrink-0 items-center justify-center"
    :style="{ width: `${boxWidth}px`, height: `${size}px` }"
    :title="title || code"
  >
    <img
      v-if="src"
      :src="src"
      :alt="code"
      :class="isGlobe ? '' : 'ring-base-content/15 ring-1'"
      :style="
        isGlobe
          ? { width: `${glyph}px`, height: `${glyph}px` }
          : { width: `${boxWidth}px`, height: `${size}px`, objectFit: 'cover' }
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
</template>

<script setup lang="ts">
import { isGlobeIcon } from '@/constant/countries'
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
  }>(),
  { code: '', size: 16, title: '' },
)

// 编译期把 src/assets/flags 下的 svg 全部登记成 URL,浏览器只会真正去取显示到的那几个。
// 不用 `new URL('../assets/flags/' + code + '.svg', import.meta.url)`:那种拼接
// Vite 打包时解析不了,生产构建下会 404。
const FLAG_URL = import.meta.glob<string>('../../assets/flags/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
})

const isGlobe = computed(() => isGlobeIcon(props.code))

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

const boxWidth = computed(() => Math.round((props.size * 4) / 3))
// 目标:地球画出来的圆,和国旗的高度一样(国旗是铺满盒子的,即 size)。
// 两种地球的"墨迹"占各自画布的比例不同,所以给的边长也不同:
//   彩色(Twemoji):圆 r=18 / viewBox 36 —— 铺满,比例 1.0,给 size 就够
//   线条(heroicons):圆 r=9 加 1.5 描边 / viewBox 24 —— 比例 0.8125,要给
//     size / 0.8125 才画得出一个 size 高的圆
// 线条那个的元素框因此比盒子高两像素,往行间距里探出去一点——它只是一条细描边,
// 没有底色,看不出来,而外框仍是统一的 4:3,文字照样对齐。
const glyph = computed(() => props.size)
const monoGlyph = computed(() => Math.round(props.size / 0.8125))

const src = computed(() => {
  if (isGlobe.value) {
    const variant = props.code.slice('globe:'.length).toLowerCase()
    return GLOBE_URL[`../../assets/globes/${variant}.svg`] || ''
  }
  const code = String(props.code || '').toLowerCase()
  if (!code) return ''
  return FLAG_URL[`../../assets/flags/${code}.svg`] || ''
})
</script>
