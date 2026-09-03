<template>
  <!-- 外观和下面的测速地址 / IPv6 卡片同一套:同样的描边、同样的 p-4 内边距 -->
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4 text-sm">
      <h2 class="text-base font-semibold">{{ $t('kernelServiceTitle') }}</h2>

      <div
        v-if="status && status.conflicts.length > 0"
        class="alert alert-warning flex-col items-start gap-1"
      >
        <div class="flex items-center gap-2 font-medium">
          <ExclamationTriangleIcon class="h-4 w-4 shrink-0" />
          {{ $t('kernelConflictTitle') }}
        </div>
        <ul class="list-disc pl-6 text-xs">
          <li
            v-for="c in status.conflicts"
            :key="c.id"
          >
            {{ $t('kernelConflictItem', { name: c.label }) }}
          </li>
        </ul>
      </div>

      <div class="flex items-center gap-2">
        <CpuChipIcon class="text-base-content/60 h-4 w-4 shrink-0" />
        <span class="text-base-content/70">{{ $t('kernelVersionLabel') }}:</span>
        <span class="font-medium">{{ kernelVersion?.version || $t('kernelVersionUnknown') }}</span>
      </div>

      <!-- 内核 / 面板 / 开机自启三项状态放同一行,标签用全局统一的 StatusBadge -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div class="flex items-center gap-2">
          <span class="font-medium">{{ $t('kernelCoreLabel') }}</span>
          <StatusBadge
            :on="Boolean(status?.core.running)"
            :on-text="$t('kernelStatusRunning')"
            :off-text="$t('kernelStatusStopped')"
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="font-medium">{{ $t('kernelPanelLabel') }}</span>
          <StatusBadge
            :on="Boolean(status?.panel.running)"
            :on-text="$t('kernelStatusRunning')"
            :off-text="$t('kernelStatusStopped')"
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="font-medium">{{ $t('kernelAutostartLabel') }}</span>
          <StatusBadge
            :on="Boolean(status?.core.autostart)"
            :on-text="$t('kernelAutostartOn')"
            :off-text="$t('kernelAutostartOff')"
          />
        </div>
      </div>

      <!-- 启动/重启 = 用当前设置重新生成配置并应用(server/api/service.mjs),
           所以界面上没有单独的「部署」按钮:各设置页保存完,来这里启动一下就生效。 -->
      <p class="text-base-content/60 text-xs">{{ $t('kernelApplyHint') }}</p>

      <!-- 一行:[启动] [停止] [重启] | 开机自启:[开启] [关闭]。按钮用全局统一的 btn btn-sm;
           互斥:内核在跑就不能再「启动」,没在跑就不能「停止/重启」,自启已开就不能再「开启」,
           以此类推;有动作进行中时全部禁用,进行中的那个转圈。 -->
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn btn-sm"
          :disabled="isStartDisabled"
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
          {{ $t('kernelActionStart') }}
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="isStopDisabled"
          v-tip="$t('kernelActionStopHint')"
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
          {{ $t('kernelActionStop') }}
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="isRestartDisabled"
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
          {{ $t('kernelActionRestart') }}
        </button>

        <div class="bg-base-content/15 mx-1 h-6 w-px" />

        <span class="text-base-content/60 text-xs">{{ $t('kernelAutostartLabel') }}:</span>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="isEnableDisabled"
          @click="runKernelAction('enable')"
        >
          <span
            v-if="pendingAction === 'enable'"
            class="loading loading-spinner loading-xs"
          />
          {{ $t('kernelAutostartOn') }}
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="isDisableDisabled"
          @click="runKernelAction('disable')"
        >
          <span
            v-if="pendingAction === 'disable'"
            class="loading loading-spinner loading-xs"
          />
          {{ $t('kernelAutostartOff') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxKernelVersion, OpenboxServiceStatus } from '@/api/openbox'
import StatusBadge from '@/components/common/StatusBadge.vue'
import {
  isDisableDisabled,
  isEnableDisabled,
  isRestartDisabled,
  isStartDisabled,
  isStopDisabled,
  pendingAction,
  serviceStatus,
  useKernelActions,
} from '@/composables/kernelService'
import { ArrowPathIcon, CpuChipIcon, ExclamationTriangleIcon, PlayIcon, StopIcon } from '@heroicons/vue/24/outline'
import { watch } from 'vue'

const props = defineProps<{
  status: OpenboxServiceStatus | null
  kernelVersion: OpenboxKernelVersion | null
}>()

const emit = defineEmits<{
  refresh: []
}>()

// 页面拿到的状态同步进共享状态,侧边栏的按钮也跟着变
watch(
  () => props.status,
  (v) => {
    if (v) serviceStatus.value = v
  },
  { immediate: true },
)

const { runKernelAction: run } = useKernelActions()
const runKernelAction = async (action: Parameters<typeof run>[0]) => {
  await run(action)
  emit('refresh')
}
</script>
