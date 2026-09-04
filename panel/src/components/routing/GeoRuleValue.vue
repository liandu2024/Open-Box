<template>
  <div class="flex min-w-0 flex-1 items-center gap-1.5">
    <GeoCategorySelect
      v-model="value"
      :kind="kind"
      :placeholder="placeholder"
      :exclude="exclude"
      class="min-w-0 flex-1"
    />
    <!-- 选了才有「详情」可看:没值的时候点开是一个空对话框。
         括号里是这个规则集有多少条记录,取回来之前只显示「详情」 -->
    <button
      v-if="value"
      type="button"
      class="btn btn-ghost btn-xs shrink-0"
      @click="showEntries = true"
    >
      {{ $t('geoEntriesLink') }}<span v-if="count !== null">({{ count.toLocaleString() }})</span>
    </button>
    <GeoEntriesDialog
      v-if="showEntries"
      v-model="showEntries"
      :tag="`${kind}-${value}`"
    />
  </div>
</template>

<script setup lang="ts">
import GeoCategorySelect from '@/components/common/GeoCategorySelect.vue'
import GeoEntriesDialog from '@/components/routing/GeoEntriesDialog.vue'
import { cachedGeoEntryCount, geoEntryCount } from '@/helper/geoEntryCount'
import { ref, watch } from 'vue'

const props = defineProps<{
  kind: 'geosite' | 'geoip'
  placeholder?: string
  exclude?: string[]
}>()

const value = defineModel<string>({ required: true })
const showEntries = ref(false)
const count = ref<number | null>(null)

// 换了分类就重新问一次记录数。已经问过的直接拿缓存,不闪一下再变。
watch(
  () => value.value,
  (v) => {
    const tag = v ? `${props.kind}-${v}` : ''
    count.value = tag ? cachedGeoEntryCount(tag) : null
    if (!tag || count.value !== null) return
    geoEntryCount(tag).then((n) => {
      if (`${props.kind}-${value.value}` === tag) count.value = n
    })
  },
  { immediate: true },
)
</script>
