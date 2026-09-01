<template>
  <!-- 标准 4:3 长方形国旗,不做圆角。给不出对应国家时(自定义地区行、没匹配上任何
       地区的节点)显示一个中性的地球占位,而不是留空:留空那一格会塌掉,同一列里的
       名字就对不齐了。圆角这里也用不了:main.css 里
       `#app-content .rounded-sm` 被改写成 0.5rem !important,套在 16px 的小图上
       就直接变成一个圆片(之前看到的"圆形国旗"就是这么来的)。
       描一道极淡的边:日本、瑞士这种大面积白底的旗,在浅色主题下没有边就糊在背景里。 -->
  <img
    v-if="src"
    :src="src"
    :alt="code"
    :title="title || code"
    class="ring-base-content/15 shrink-0 object-cover ring-1"
    :style="{ width: `${Math.round((size * 4) / 3)}px`, height: `${size}px` }"
  />
  <!-- 占位也按同样的宽度,否则有旗和没旗的行文字对不齐 -->
  <GlobeAltIcon
    v-else
    class="text-base-content/30 shrink-0"
    :style="{ width: `${Math.round((size * 4) / 3)}px`, height: `${size}px` }"
  />
</template>

<script setup lang="ts">
import { GlobeAltIcon } from '@heroicons/vue/24/outline'
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

const src = computed(() => {
  const code = String(props.code || '').toLowerCase()
  if (!code) return ''
  return FLAG_URL[`../../assets/flags/${code}.svg`] || ''
})
</script>
