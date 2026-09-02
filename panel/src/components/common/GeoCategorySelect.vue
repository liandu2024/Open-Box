<template>
  <!-- geosite/geoip 的值选择器。列表就是 Open-Box 真正会去下载的那两个仓库里有的
       规则集(见 constant/geo-catalog.ts),所以这里是下拉框而不是输入框:手打一个
       上游没有的名字,部署会卡在"拉规则集"那一步,而那时错误离这里已经很远了。 -->
  <div class="dropdown w-full">
    <div
      tabindex="0"
      role="button"
      class="input input-sm hover:border-base-content/30 flex w-full cursor-pointer items-center gap-1.5 font-mono text-xs"
      @click="ensureLoaded"
      @focus="ensureLoaded"
    >
      <span
        class="min-w-0 flex-1 truncate text-left"
        :class="{ 'text-base-content/40': !modelValue }"
      >
        {{ modelValue || placeholder }}
      </span>
      <span
        v-if="currentNote"
        class="text-base-content/50 hidden max-w-[45%] truncate font-sans sm:block"
      >
        {{ currentNote }}
      </span>
      <ChevronDownIcon class="text-base-content/40 h-3.5 w-3.5 shrink-0" />
    </div>
    <div
      tabindex="0"
      class="dropdown-content bg-base-100 border-base-content/10 z-10 mt-1 w-80 rounded-lg border p-2 shadow-lg"
    >
      <TextInput
        v-model="keyword"
        :placeholder="$t('geoCategorySearch')"
        clearable
      />
      <ul class="mt-1 max-h-64 overflow-y-auto">
        <li
          v-if="loading"
          class="text-base-content/50 px-2 py-3 text-center text-xs"
        >
          <span class="loading loading-spinner loading-xs" />
        </li>
        <!-- 目录是一份快照;上游新加的分类先用手打的值顶上,不至于卡住 -->
        <li v-if="!loading && customValue">
          <button
            type="button"
            class="hover:bg-base-200 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
            @click="choose(customValue)"
          >
            <span class="truncate font-mono text-xs">{{ customValue }}</span>
            <span class="text-base-content/50 ml-auto shrink-0 text-xs">{{ $t('geoCategoryUseCustom') }}</span>
          </button>
        </li>
        <li
          v-for="row in visible"
          :key="row[0]"
        >
          <button
            type="button"
            class="hover:bg-base-200 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
            :class="{ 'bg-base-200': row[0] === modelValue }"
            @click="choose(row[0])"
          >
            <span class="shrink-0 font-mono text-xs">{{ row[0] }}</span>
            <span class="text-base-content/50 min-w-0 flex-1 truncate text-right text-xs">{{ note(row) }}</span>
          </button>
        </li>
        <li
          v-if="!loading && !visible.length && !customValue"
          class="text-base-content/50 px-2 py-3 text-center text-xs"
        >
          {{ $t('geoCategoryNoMatch') }}
        </li>
        <li
          v-else-if="hiddenCount > 0"
          class="text-base-content/50 px-2 py-2 text-center text-xs"
        >
          {{ $t('geoCategoryMore', { count: hiddenCount }) }}
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import TextInput from '@/components/common/TextInput.vue'
import type { GeoCategoryRow } from '@/constant/geo-catalog'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue: string
  kind: 'geosite' | 'geoip'
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const { locale } = useI18n()

// 一次最多渲染这么多条:geosite 有 1800+ 条,全渲染出来光 DOM 就够卡一下的。
// 剩下的靠搜索缩范围,列表底下会写还剩多少条。
const MAX_VISIBLE = 60

// 目录 176KB,按需加载:不打开这个下拉框的人不该为它付流量。
// 模块级缓存,同一页里几十行规则只会加载一次。
const cache = { geosite: [] as readonly GeoCategoryRow[], geoip: [] as readonly GeoCategoryRow[] }
const rows = ref<readonly GeoCategoryRow[]>(cache[props.kind])
const loading = ref(false)

const ensureLoaded = async () => {
  if (rows.value.length || loading.value) return
  loading.value = true
  try {
    const mod = await import('@/constant/geo-catalog')
    cache.geosite = mod.GEOSITE_CATEGORIES
    cache.geoip = mod.GEOIP_CATEGORIES
    rows.value = cache[props.kind]
  } finally {
    loading.value = false
  }
}
// 换类型(geosite ↔ geoip)时换一份表;已经加载过就直接换,不再请求
watch(() => props.kind, (kind) => { rows.value = cache[kind] })

const keyword = ref('')

// [名称, 中文, 英文, 繁体?];繁体缺省时用中文
const note = (row: GeoCategoryRow) => {
  if (locale.value === 'zh-TW') return row[3] || row[1] || ''
  if (locale.value.startsWith('zh')) return row[1] || ''
  return row[2] || row[1] || ''
}

const currentNote = computed(() => {
  const hit = rows.value.find((r) => r[0] === props.modelValue)
  return hit ? note(hit) : ''
})

// 名称、中文、英文、繁体一起参与检索:输 openai、输「人工智能」、输 ai 都该找到它
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return rows.value
  return rows.value.filter((r) => r.some((cell) => (cell || '').toLowerCase().includes(kw)))
})
const visible = computed(() => filtered.value.slice(0, MAX_VISIBLE))
const hiddenCount = computed(() => Math.max(0, filtered.value.length - MAX_VISIBLE))

// 搜的词本身不在目录里时,允许直接用它——目录是快照,上游随时会加新分类
const customValue = computed(() => {
  const kw = keyword.value.trim()
  if (!kw || !/^[A-Za-z0-9._!-]+$/.test(kw)) return ''
  return rows.value.some((r) => r[0] === kw) ? '' : kw
})

const choose = (value: string) => {
  emit('update:modelValue', value)
  keyword.value = ''
  // dropdown 靠 focus-within 展开,挑完要主动失焦才收起来
  ;(document.activeElement as HTMLElement | null)?.blur()
}
</script>
