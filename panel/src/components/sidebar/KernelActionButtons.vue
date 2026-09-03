<template>
  <!-- 侧边栏底部的内核控制:启动 / 停止 / 重启,只放图标,悬停有提示。
       互斥规则和后端设置里的内核卡片一样(共用 composables/kernelService)。 -->
  <div :class="vertical ? 'flex flex-col items-center gap-2' : 'flex items-center gap-1'">
    <button
      type="button"
      class="btn btn-circle btn-sm"
      :disabled="isStartDisabled"
      v-tip="$t('kernelActionStart')"
      @click="runKernelAction('start')"
    >
      <span
        v-if="pendingAction === 'start'"
        class="loading loading-spinner loading-xs"
      />
      <PlayIcon
        v-else
        class="h-4 w-4"
      />
    </button>
    <button
      type="button"
      class="btn btn-circle btn-sm"
      :disabled="isStopDisabled"
      v-tip="$t('kernelActionStop')"
      @click="runKernelAction('stop')"
    >
      <span
        v-if="pendingAction === 'stop'"
        class="loading loading-spinner loading-xs"
      />
      <StopIcon
        v-else
        class="h-4 w-4"
      />
    </button>
    <button
      type="button"
      class="btn btn-circle btn-sm"
      :disabled="isRestartDisabled"
      v-tip="$t('kernelActionRestart')"
      @click="runKernelAction('restart')"
    >
      <span
        v-if="pendingAction === 'restart'"
        class="loading loading-spinner loading-xs"
      />
      <ArrowPathIcon
        v-else
        class="h-4 w-4"
      />
    </button>
  </div>
</template>

<script setup lang="ts">
import {
  isRestartDisabled,
  isStartDisabled,
  isStopDisabled,
  pendingAction,
  useKernelActions,
  useServiceStatusPolling,
} from '@/composables/kernelService'
import { ArrowPathIcon, PlayIcon, StopIcon } from '@heroicons/vue/24/outline'

defineProps<{
  vertical?: boolean
}>()

useServiceStatusPolling()
const { runKernelAction } = useKernelActions()
</script>
