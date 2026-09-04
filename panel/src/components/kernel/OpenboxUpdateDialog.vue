<template>
  <!-- 升级进度弹窗。挂在 App 根上(不在「后端设置」那一页里):升级期间面板会重启一次、
       内核再重启一次,用户待在哪一页都该看得见进度,刷新或重新登录之后也要接着显示。 -->
  <DialogWrapper
    v-model="updateDialogOpen"
    :title="$t('obUpdateDialogTitle')"
    box-class="w-full max-w-2xl"
  >
    <div class="flex flex-col gap-3 text-sm">
      <div class="flex items-center gap-2">
        <span
          v-if="updateRunning"
          class="loading loading-spinner loading-xs"
        />
        <span>{{ stageText }}</span>
        <span
          v-if="updateProgress?.message"
          class="text-base-content/60 truncate text-xs"
        >{{ updateProgress.message }}</span>
      </div>
      <progress
        class="progress progress-primary w-full"
        :value="updatePercent ?? undefined"
        max="100"
      />
      <p class="text-base-content/60 text-xs">{{ $t('obUpdateDialogHint') }}</p>
      <pre
        v-if="updateInfo?.logTail"
        class="bg-base-200/60 max-h-64 overflow-auto rounded-lg p-2 font-mono text-xs whitespace-pre-wrap"
      >{{ updateInfo.logTail }}</pre>
      <div class="flex justify-end gap-2">
        <button
          v-if="updateRunning"
          type="button"
          class="btn btn-sm"
          :disabled="!updateCancellable"
          @click="cancelRunningUpdate"
        >
          {{ $t('cancel') }}
        </button>
        <button
          type="button"
          class="btn btn-sm"
          @click="updateDialogOpen = false"
        >
          {{ $t('close') }}
        </button>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import {
  cancelRunningUpdate,
  updateCancellable,
  updateDialogOpen,
  updateInfo,
  updatePercent,
  updateProgress,
  updateRunning,
} from '@/composables/openboxUpdate'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const stageText = computed(() => {
  const stage = updateProgress.value?.stage || ''
  const key = `obUpdateStage_${stage}`
  const text = t(key)
  return text === key ? stage : text
})
</script>
