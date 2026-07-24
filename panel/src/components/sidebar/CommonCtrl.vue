<template>
  <div class="flex flex-col gap-2 p-2 text-sm">
    <StatisticsStats type="ctrl" />
    <BackendSwitch :disable-edit-backend="true" />
    <div class="flex gap-2">
      <SidebarButtons />
      <BackendVersion />
    </div>
  </div>
</template>

<script setup lang="ts">
import BackendVersion from '../common/BackendVersion.vue'
import StatisticsStats from '../overview/StatisticsStats.vue'
import BackendSwitch from '../settings/BackendSwitch.vue'
import SidebarButtons from './SidebarButtons.vue'
</script>
