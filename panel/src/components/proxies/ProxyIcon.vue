<template>
  <!-- 外框永远是 size × size,缩放只发生在框里(从中心放大 / 缩小),放不下就裁掉——
       图标大一点小一点都不能推着旁边的文字走。 -->
  <span
    class="inline-flex shrink-0 items-center justify-center overflow-hidden align-middle"
    :style="boxStyle"
  >
    <div
      v-if="isDom"
      :class="['inline-block shrink-0', fill || 'fill-primary']"
      :style="glyphStyle"
      v-html="pureDom"
    />
    <img
      v-else
      class="inline-block max-w-none shrink-0"
      :style="glyphStyle"
      :src="icon"
    />
  </span>
</template>

<script setup lang="ts">
import DOMPurify from 'dompurify'
import { iconScaleFactor } from '@/helper/iconScale'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    icon: string
    fill?: string
    size?: number
    margin?: number
    // 像素偏移:+1 画成 size+1 那么大,-1 画成 size-1;外框不变(见 IconScaleInput.vue)
    scale?: number
  }>(),
  {
    size: 16,
    margin: 4,
    scale: 0,
  },
)

const boxStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  marginRight: `${props.margin}px`,
}))
const glyphStyle = computed(() => {
  // 比例按代理页大图标算(见 helper/iconScale.ts),小图标等比缩放,不按自己的尺寸加像素
  const factor = iconScaleFactor(props.scale)
  return {
    width: `${props.size}px`,
    height: `${props.size}px`,
    transform: factor === 1 ? undefined : `scale(${factor})`,
    transformOrigin: 'center',
  }
})
const DOM_STARTS_WITH = 'data:image/svg+xml,'
const isDom = computed(() => {
  return props.icon.startsWith(DOM_STARTS_WITH)
})

const pureDom = computed(() => {
  if (!isDom.value) return
  return DOMPurify.sanitize(props.icon.replace(DOM_STARTS_WITH, ''))
})
</script>
