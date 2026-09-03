<template>
  <div class="flex flex-col gap-2 p-2 text-sm">
    <StatisticsStats type="ctrl" />
    <!-- 左:内核运行时长;右:启动/停止/重启,右对齐 -->
    <div class="flex items-center justify-between gap-2">
      <div class="flex min-w-0 flex-col leading-tight">
        <span class="text-base-content/60 text-xs">{{ $t('kernelUptimeLabel') }}</span>
        <span class="truncate text-sm font-medium tabular-nums">{{ uptimeText }}</span>
      </div>
      <KernelActionButtons class="shrink-0" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { kernelUptimeText } from '@/composables/kernelService'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import StatisticsStats from '../overview/StatisticsStats.vue'
import KernelActionButtons from './KernelActionButtons.vue'

const { t } = useI18n()
const uptimeText = computed(() => kernelUptimeText(t))
</script>
