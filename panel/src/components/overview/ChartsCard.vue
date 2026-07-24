<template>
  <!-- overview -->
  <div class="card w-full">
    <div class="card-title px-4 pt-4">
      {{ $t('overview') }}
    </div>
    <div class="card-body gap-4">
      <StatisticsStats type="overview" />
      <div class="grid grid-cols-1 gap-2 lg:grid-cols-3">
        <SpeedCharts class="xl:h-64" />
        <MemoryCharts class="xl:h-64" />
        <ConnectionsCharts class="xl:h-64" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ConnectionsCharts from '@/components/overview/ConnectionsCharts.vue'
import MemoryCharts from '@/components/overview/MemoryCharts.vue'
import SpeedCharts from '@/components/overview/SpeedCharts.vue'
import StatisticsStats from '@/components/overview/StatisticsStats.vue'
</script>
