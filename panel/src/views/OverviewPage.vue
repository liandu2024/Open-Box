<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <OverviewCtrl />
    <div
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      :style="padding"
    >
      <!-- 概览两张卡片:实时图表 + 每日流量。网络信息、连接拓扑、连接统计已去掉。 -->
      <div class="flex flex-col gap-2 p-2">
        <ChartsCard />
        <DailyTrafficCard />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ChartsCard from '@/components/overview/ChartsCard.vue'
import DailyTrafficCard from '@/components/overview/DailyTrafficCard.vue'
import OverviewCtrl from '@/components/sidebar/OverviewCtrl.vue'
import { usePaddingForViews } from '@/composables/paddingViews'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})
</script>
