<template>
  <div class="flex size-full min-h-0 flex-col overflow-hidden">
    <LogsCtrl />
    <VirtualScroller
      class="min-h-0 flex-1"
      :style="virtualScrollerStyle"
      :data="renderLogs"
      :size="isMiddleScreen ? 96 : 64"
    >
      <template v-slot="{ item }: { item: LogWithSeq }">
        <LogsCard :log="item"></LogsCard>
      </template>
    </VirtualScroller>
  </div>
</template>

<script setup lang="ts">
import VirtualScroller from '@/components/common/VirtualScroller.vue'
import LogsCard from '@/components/logs/LogsCard.vue'
import LogsCtrl from '@/components/sidebar/LogsCtrl.tsx'
import { usePaddingForViews } from '@/composables/paddingViews'
import { isMiddleScreen } from '@/helper/utils'
import { logFilter, logFilterEnabled, logFilterRegex, logTypeFilter, logs } from '@/store/logs'
import type { LogWithSeq } from '@/types'
import { computed } from 'vue'

const { paddingTop } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})
const virtualScrollerStyle = computed(() => ({
  paddingTop: `${paddingTop.value}px`,
}))

const renderLogs = computed(() => {
  let renderLogs = logs.value

  if (logFilter.value || logTypeFilter.value) {
    const regex = new RegExp(logFilter.value, 'i')

    renderLogs = logs.value.filter((log) => {
      if (logFilter.value && ![log.payload, log.time, log.type].some((i) => regex.test(i))) {
        return false
      }

      if (
        logTypeFilter.value &&
        !(log.payload.includes(logTypeFilter.value) || log.type === logTypeFilter.value)
      ) {
        return false
      }

      return true
    })
  }

  if (logFilterEnabled.value && logFilterRegex.value) {
    const hideRegex = new RegExp(logFilterRegex.value, 'i')
    renderLogs = renderLogs.filter((log) => {
      return ![log.payload, log.time, log.type].some((i) => hideRegex.test(i))
    })
  }

  return renderLogs
})
</script>
