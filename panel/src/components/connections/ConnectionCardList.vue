<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <ConnectionCtrl />
    <VirtualScroller
      class="min-h-0 flex-1"
      :style="virtualScrollerStyle"
      :data="renderConnections"
      :size="size"
    >
      <template v-slot="{ item }: { item: Connection }">
        <ConnectionCard :conn="item" />
      </template>
    </VirtualScroller>
  </div>
</template>

<script setup lang="ts">
import { usePaddingForViews } from '@/composables/paddingViews'
import { renderConnections } from '@/store/connections'
import { connectionCardLines } from '@/store/settings'
import type { Connection } from '@/types'
import { computed } from 'vue'
import VirtualScroller from '../common/VirtualScroller.vue'
import ConnectionCtrl from '../sidebar/ConnectionCtrl.tsx'
import ConnectionCard from './ConnectionCard'

const { paddingTop } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})
const virtualScrollerStyle = computed(() => ({
  paddingTop: `${paddingTop.value}px`,
}))

const size = computed(() => {
  return connectionCardLines.value.length * 28 + 4
})
</script>
