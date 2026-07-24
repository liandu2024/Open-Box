<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <OverviewCtrl />
    <div
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      :style="padding"
    >
      <div class="flex flex-col gap-2 p-2">
        <component
          v-for="item in visibleCards"
          :key="item"
          :is="cardComponents[item.card]"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ChartsCard from '@/components/overview/ChartsCard.vue'
import ConnectionHistory from '@/components/overview/ConnectionHistory.vue'
import NetworkCard from '@/components/overview/NetworkCard.vue'
import ProviderTrafficOverview from '@/components/overview/ProviderTrafficOverview.vue'
import RuleHitCountCard from '@/components/overview/RuleHitCountCard.vue'
import TopologyCharts from '@/components/overview/TopologyCharts.vue'
import OverviewCtrl from '@/components/sidebar/OverviewCtrl.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { overviewCardOrder } from '@/store/settings'
import type { Component } from 'vue'
import { computed } from 'vue'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})
const visibleCards = computed(() => {
  return overviewCardOrder.value.filter((card) => card.visible)
})

const cardComponents: Record<string, Component> = {
  ChartsCard,
  NetworkCard,
  ProviderTrafficOverview,
  TopologyCharts,
  ConnectionHistory,
  RuleHitCountCard,
}
</script>
