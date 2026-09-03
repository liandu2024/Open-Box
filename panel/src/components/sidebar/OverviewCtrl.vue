<template>
  <div class="ctrls-bar">
    <div class="app-card-padding flex h-12 flex-row items-center gap-2 text-sm">
      <BackendVersion />
    </div>
  </div>
</template>

<script setup lang="ts">
import BackendVersion from '@/components/common/BackendVersion.vue'
import { useCtrlsBar } from '@/composables/useCtrlsBar'

useCtrlsBar()
</script>
