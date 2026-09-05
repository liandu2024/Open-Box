<template>
  <!-- 侧边栏底部的内核控制:启动 / 停止 / 重启,只放图标,悬停有提示。
       互斥规则和后端设置里的内核卡片一样(共用 composables/kernelService)。 -->
  <!-- 竖排(折叠)和横排(展开)同一个尺寸 36px、同一个底色 base-100:折叠时按钮直接摆在 base-200 的
       侧边栏上,默认 btn 的底色也是 base-200,看着发暗;写死亮底,两种状态一个样。圆角和菜单项同一个变量(--app-radius-nav,见 main.css 的 .kernel-action-btn;.btn 的圆角是 !important,
       工具类压不过,只能同样用 !important 的规则)-->
  <!-- 三个键之间横排竖排都是 8px(gap-2),和侧边栏其他地方的间距一致 -->
  <div
    class="flex items-center gap-2"
    :class="vertical ? 'flex-col' : ''"
  >
    <button
      type="button"
      class="btn btn-square btn-sm bg-base-100 h-9 w-9 kernel-action-btn"
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
      class="btn btn-square btn-sm bg-base-100 h-9 w-9 kernel-action-btn"
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
      class="btn btn-square btn-sm bg-base-100 h-9 w-9 kernel-action-btn"
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
