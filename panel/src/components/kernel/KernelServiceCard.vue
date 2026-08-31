<template>
  <div class="card">
    <div class="app-card-padding flex flex-col gap-3 text-sm">
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

      <div class="flex flex-col gap-2">
        <div class="border-base-300 flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
          <div class="flex items-center gap-2">
            <span class="font-medium">{{ $t('kernelCoreLabel') }}</span>
            <span
              class="badge badge-sm"
              :class="status?.core.running ? 'badge-success' : 'badge-ghost'"
            >
              {{ status?.core.running ? $t('kernelStatusRunning') : $t('kernelStatusStopped') }}
            </span>
          </div>
          <button
            v-if="status?.core.raw"
            type="button"
            class="btn btn-ghost btn-xs"
            @click="showCoreRaw = !showCoreRaw"
          >
            {{ showCoreRaw ? $t('kernelHideDetail') : $t('kernelShowDetail') }}
          </button>
        </div>
        <pre
          v-if="showCoreRaw && status?.core.raw"
          class="bg-base-200 rounded p-2 text-xs break-words whitespace-pre-wrap"
          >{{ status.core.raw }}</pre
        >

        <div class="border-base-300 flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
          <div class="flex items-center gap-2">
            <span class="font-medium">{{ $t('kernelPanelLabel') }}</span>
            <span
              class="badge badge-sm"
              :class="status?.panel.running ? 'badge-success' : 'badge-ghost'"
            >
              {{ status?.panel.running ? $t('kernelStatusRunning') : $t('kernelStatusStopped') }}
            </span>
          </div>
          <button
            v-if="status?.panel.raw"
            type="button"
            class="btn btn-ghost btn-xs"
            @click="showPanelRaw = !showPanelRaw"
          >
            {{ showPanelRaw ? $t('kernelHideDetail') : $t('kernelShowDetail') }}
          </button>
        </div>
        <pre
          v-if="showPanelRaw && status?.panel.raw"
          class="bg-base-200 rounded p-2 text-xs break-words whitespace-pre-wrap"
          >{{ status.panel.raw }}</pre
        >
      </div>

      <div
        v-if="resultBanner"
        class="rounded-lg border px-3 py-2 text-xs"
        :class="
          resultBanner.kind === 'success' ? 'border-success/30 bg-success/10 text-success' : 'border-error/30 bg-error/10 text-error'
        "
      >
        {{ resultBanner.text }}
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="btn btn-sm btn-outline"
            :disabled="isStartDisabled"
            @click="runAction('start')"
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
            class="btn btn-sm btn-outline btn-error"
            :disabled="isStopDisabled"
            :title="$t('kernelActionStopHint')"
            @click="runAction('stop')"
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
            class="btn btn-sm btn-outline"
            :disabled="isRestartDisabled"
            @click="runAction('restart')"
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
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-base-content/60 text-xs">{{ $t('kernelAutostartLabel') }}:</span>
          <button
            type="button"
            class="btn btn-xs btn-outline"
            :disabled="pendingAction !== null"
            @click="runAction('enable')"
          >
            <span
              v-if="pendingAction === 'enable'"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('kernelActionEnable') }}
          </button>
          <button
            type="button"
            class="btn btn-xs btn-outline"
            :disabled="pendingAction !== null"
            @click="runAction('disable')"
          >
            <span
              v-if="pendingAction === 'disable'"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('kernelActionDisable') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  runServiceAction,
  type OpenboxKernelVersion,
  type OpenboxServiceAction,
  type OpenboxServiceActionResult,
  type OpenboxServiceStatus,
} from '@/api/openbox'
import { ArrowPathIcon, CpuChipIcon, ExclamationTriangleIcon, PlayIcon, StopIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  status: OpenboxServiceStatus | null
  kernelVersion: OpenboxKernelVersion | null
}>()

const emit = defineEmits<{
  refresh: []
}>()

const { t } = useI18n()

const showCoreRaw = ref(false)
const showPanelRaw = ref(false)

const pendingAction = ref<OpenboxServiceAction | null>(null)
const lastAction = ref<OpenboxServiceAction | null>(null)
const lastResult = ref<OpenboxServiceActionResult | null>(null)
const lastRequestError = ref('')

const ACTION_LABEL_KEYS: Record<OpenboxServiceAction, string> = {
  start: 'kernelActionStart',
  stop: 'kernelActionStop',
  restart: 'kernelActionRestart',
  enable: 'kernelActionEnable',
  disable: 'kernelActionDisable',
}

const isStartDisabled = computed(
  () => pendingAction.value !== null || Boolean(props.status?.core.running) || Boolean(props.status?.conflicts.length),
)
const isStopDisabled = computed(() => pendingAction.value !== null || !props.status?.core.running)
const isRestartDisabled = computed(() => pendingAction.value !== null || Boolean(props.status?.conflicts.length))

// This dev machine has no /etc/init.d at all, so every action here fails on it — that's the
// actual path this banner exists to cover: `ok:false` with an empty stderr (execFile never even
// spawned) must still read as a sentence, not a blank line or a raw stack dump. `code` is always
// a number (see server/system/context-real.mjs — ENOENT collapses to code 1), so it's always
// safe to show as a fallback identifier when stderr has nothing.
const resultBanner = computed(() => {
  if (lastRequestError.value) {
    return { kind: 'error' as const, text: lastRequestError.value }
  }
  if (!lastResult.value || !lastAction.value) return null

  const actionLabel = t(ACTION_LABEL_KEYS[lastAction.value])
  if (lastResult.value.ok) {
    return { kind: 'success' as const, text: t('kernelActionSucceeded', { action: actionLabel }) }
  }

  const detail = lastResult.value.stderr.trim() || t('kernelActionNoDetail', { code: lastResult.value.code })
  return { kind: 'error' as const, text: t('kernelActionFailed', { action: actionLabel, detail }) }
})

const runAction = async (action: OpenboxServiceAction) => {
  if (pendingAction.value) return

  pendingAction.value = action
  lastRequestError.value = ''
  try {
    const result = await runServiceAction(action)
    lastAction.value = action
    lastResult.value = result
  } catch (error) {
    lastAction.value = action
    lastResult.value = null
    lastRequestError.value = t('kernelActionRequestFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    pendingAction.value = null
    emit('refresh')
  }
}
</script>
