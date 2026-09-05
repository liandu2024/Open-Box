<template>
  <!-- 外观和下面的测速地址 / IPv6 卡片同一套:同样的描边、同样的 p-4 内边距 -->
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4 text-sm">
      <!-- 标题行右边:Open-Box 标识 + 面板版本号 + GitHub,整块是一个链接,新开页签跳到仓库 -->
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-base font-semibold">{{ $t('kernelServiceTitle') }}</h2>
        <a
          href="https://github.com/liandu2024/Open-Box"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:bg-base-200 ml-auto inline-flex items-center gap-2 rounded-lg px-2 py-1"
          v-tip="$t('openboxGithubHint')"
        >
          <img
            :src="logoUrl"
            class="app-logo h-5 w-auto"
            alt="Open-Box"
          />
          <span class="font-mono text-sm">{{ updateInfo?.version || '—' }}</span>
          <svg
            viewBox="0 0 16 16"
            class="h-4 w-4"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span class="text-sm">GitHub</span>
          <ArrowTopRightOnSquareIcon class="text-base-content/50 h-3.5 w-3.5" />
        </a>
      </div>

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
            :on="Boolean(serviceStatus?.core.running)"
            :on-text="$t('kernelStatusRunning')"
            :off-text="$t('kernelStatusStopped')"
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="font-medium">{{ $t('kernelPanelLabel') }}</span>
          <StatusBadge
            :on="Boolean(serviceStatus?.panel.running)"
            :on-text="$t('kernelStatusRunning')"
            :off-text="$t('kernelStatusStopped')"
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="font-medium">{{ $t('kernelAutostartLabel') }}</span>
          <StatusBadge
            :on="Boolean(serviceStatus?.core.autostart)"
            :on-text="$t('kernelAutostartOn')"
            :off-text="$t('kernelAutostartOff')"
          />
        </div>
      </div>

      <!-- 启动/重启 = 用当前设置重新生成配置并应用(server/api/service.mjs),
           所以界面上没有单独的「部署」按钮:各设置页保存完,来这里启动一下就生效。 -->
      <p class="text-base-content/60 text-xs">{{ $t('kernelApplyHint') }}</p>

      <!-- 一行:[启动] [停止] [重启]。开机自启不单独给按钮:启动 / 重启成功即打开自启,停止即关闭
           (server/api/service.mjs 与 deploy-runner.mjs),上面的状态标签只是展示。
           互斥:内核在跑就不能再「启动」,没在跑就不能「停止/重启」;有动作进行中时全部禁用。 -->
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
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxKernelVersion, OpenboxServiceStatus } from '@/api/openbox'
import StatusBadge from '@/components/common/StatusBadge.vue'
import {
  isRestartDisabled,
  isStartDisabled,
  isStopDisabled,
  pendingAction,
  serviceStatus,
  useKernelActions,
} from '@/composables/kernelService'
import { refreshUpdateInfo, updateInfo } from '@/composables/openboxUpdate'
import logoUrl from '@/assets/logo.png'
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, CpuChipIcon, ExclamationTriangleIcon, PlayIcon, StopIcon } from '@heroicons/vue/24/outline'
import { onMounted } from 'vue'

// 标题行右边的版本号来自更新状态(同页的更新卡片也会拉;这里没有就自己拉一次)
onMounted(() => {
  if (!updateInfo.value) void refreshUpdateInfo()
})

// status 仍作为 prop 保留给页面传入(刷新时序由页面掌握),卡片本身只读共享状态
defineProps<{
  status: OpenboxServiceStatus | null
  kernelVersion: OpenboxKernelVersion | null
}>()

const emit = defineEmits<{
  refresh: []
}>()

// 状态标签和按钮读的是同一份共享状态(composables/kernelService.ts):页面自己再拿一份
// 会分叉——在侧边栏点停止、内核被外部停掉时标签不跟着变;直接往共享状态里写又绕过了
// refreshSeq,旧响应能把新状态盖回去。

const { runKernelAction: run } = useKernelActions()
const runKernelAction = async (action: Parameters<typeof run>[0]) => {
  await run(action)
  emit('refresh')
}
</script>
