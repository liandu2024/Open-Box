<template>
  <!-- 正方形国旗。给不出对应国家时(自定义地区行、没匹配上任何地区的节点)显示一个
       中性的地球占位,而不是留空:留空的话那一格会塌掉,同一列里的名字就对不齐了。 -->
  <img
    v-if="src"
    :src="src"
    :alt="code"
    :title="title || code"
    class="shrink-0 rounded-sm object-cover"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
  <GlobeAltIcon
    v-else
    class="text-base-content/30 shrink-0"
    :style="{ width: `${size}px`, height: `${size}px` }"
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
