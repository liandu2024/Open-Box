<template>
  <!-- p-2:和下面那张统计卡片一样的内边距——图表的纵轴标签本来紧贴卡片边,和下面
       卡片里的文字对不齐。max-h 里要把这 16px 算进去,不然多出来的部分会在卡片里滚。 -->
  <div
    class="card scrollbar-hidden flex-2 overflow-y-auto p-2 text-sm"
    :class="classNameMap[numberOfChartsInSidebar]"
  >
    <SpeedCharts class="h-28 shrink-0" />
    <MemoryCharts class="h-28 shrink-0" />
    <ConnectionsCharts class="h-28 shrink-0" />
  </div>
</template>

<script setup lang="ts">
import ConnectionsCharts from '@/components/overview/ConnectionsCharts.vue'
import MemoryCharts from '@/components/overview/MemoryCharts.vue'
import SpeedCharts from '@/components/overview/SpeedCharts.vue'
import { numberOfChartsInSidebar } from '@/store/settings'

// 每张图 h-28(112px),再加卡片上下各 8px 的内边距
const classNameMap = {
  1: 'max-h-32',
  2: 'max-h-60',
  3: 'max-h-88',
}
</script>
