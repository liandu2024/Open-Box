<template>
  <div class="flex min-w-0 flex-1 items-center gap-1.5">
    <GeoCategorySelect
      v-model="value"
      :kind="kind"
      :placeholder="placeholder"
      :exclude="exclude"
      class="min-w-0 flex-1"
    />
    <!-- 选了才有「详情」可看:没值的时候点开是一个空对话框 -->
    <button
      v-if="value"
      type="button"
      class="btn btn-ghost btn-xs shrink-0"
      @click="showEntries = true"
    >
      {{ $t('geoEntriesLink') }}
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
import { ref } from 'vue'

defineProps<{
  kind: 'geosite' | 'geoip'
  placeholder?: string
  exclude?: string[]
}>()

const value = defineModel<string>({ required: true })
const showEntries = ref(false)
</script>
