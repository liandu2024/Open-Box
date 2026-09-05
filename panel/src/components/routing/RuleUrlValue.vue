<template>
  <div class="flex min-w-0 flex-1 items-center gap-1.5">
    <input
      v-model="value"
      type="url"
      class="input input-sm min-w-0 flex-1 font-mono text-xs"
      :placeholder="placeholder"
    />
    <!-- 填完网址就去拉一次看看里面有多少条:数字出来之前转个圈,拉不动就说一句;
         和 geosite / geoip 那边的「详情(N)」是同一个弹窗,只是数据从网址来 -->
    <span
      v-if="state === 'loading'"
      class="loading loading-spinner loading-xs shrink-0"
    />
    <span
      v-else-if="state === 'failed'"
      class="text-error shrink-0 text-xs"
      v-tip="$t('ruleUrlFetchFailed')"
    >{{ $t('ruleUrlFetchFailedShort') }}</span>
    <button
      v-else-if="count !== null"
      type="button"
      class="btn btn-ghost btn-xs shrink-0"
      @click="showEntries = true"
    >
      {{ $t('geoEntriesLink') }}({{ count.toLocaleString() }})
    </button>
    <GeoEntriesDialog
      v-if="showEntries"
      v-model="showEntries"
      :url="value"
    />
  </div>
</template>

<script setup lang="ts">
import GeoEntriesDialog from '@/components/routing/GeoEntriesDialog.vue'
import { cachedRuleListCount, ruleListCount } from '@/helper/geoEntryCount'
import { ref, watch } from 'vue'

defineProps<{ placeholder?: string }>()
const value = defineModel<string>({ required: true })

const showEntries = ref(false)
const count = ref<number | null>(null)
const state = ref<'idle' | 'loading' | 'failed'>('idle')

const isUrl = (v: string) => /^https?:\/\/[^\s]+$/i.test(v.trim())

// 边打边查会对着半截网址发请求,等停手 600ms 再去;换了网址就以最后一次为准
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  value,
  (v) => {
    clearTimeout(timer)
    const url = v.trim()
    if (!isUrl(url)) {
      count.value = null
      state.value = 'idle'
      return
    }
    const cached = cachedRuleListCount(url)
    if (cached !== null) {
      count.value = cached
      state.value = 'idle'
      return
    }
    state.value = 'loading'
    count.value = null
    timer = setTimeout(() => {
      ruleListCount(url).then((n) => {
        if (value.value.trim() !== url) return
        count.value = n
        state.value = n === null ? 'failed' : 'idle'
      })
    }, 600)
  },
  { immediate: true },
)
</script>
