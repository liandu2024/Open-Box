<template>
  <div class="flex flex-col gap-2 p-2 text-sm">
    <StatisticsStats type="ctrl" />
    <div class="flex items-center gap-2">
      <KernelActionButtons class="shrink-0" />
      <BackendVersion class="min-w-0 flex-1 text-xs" />
    </div>
  </div>
</template>

<script setup lang="ts">
import BackendVersion from '../common/BackendVersion.vue'
import StatisticsStats from '../overview/StatisticsStats.vue'
import KernelActionButtons from './KernelActionButtons.vue'
</script>
