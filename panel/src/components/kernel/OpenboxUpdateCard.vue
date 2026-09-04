<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4 text-sm">
      <div>
        <h2 class="text-base font-semibold">{{ $t('obUpdateTitle') }}</h2>
        <p class="text-base-content/60 text-xs">{{ $t('obUpdateDescription') }}</p>
      </div>

      <!-- 版本一行:当前 / 最新 -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span class="text-base-content/70">{{ $t('obUpdateCurrent') }}:</span>
        <span class="font-mono">{{ info?.version || '—' }}</span>
        <template v-if="latest">
          <span class="text-base-content/70">{{ $t('obUpdateLatest') }}:</span>
          <span class="font-mono">{{ latest.latest }}</span>
          <StatusBadge
            :on="!latest.hasUpdate"
            :on-text="$t('obUpdateUpToDate')"
            :off-text="$t('obUpdateAvailable')"
          />
        </template>
      </div>

      <!-- 操作:[通道] [一个按钮]。按钮按状态变身:检查更新 → 探到新版就变成 立即更新 →
           升级进行中变成 查看进度。没探到新版按钮不变,只弹一条「已是最新」。 -->
      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="channel"
          class="select select-sm"
          :disabled="Boolean(progress?.running)"
        >
          <option value="auto">{{ $t('obUpdateChannelAuto') }}</option>
          <option value="direct">{{ $t('obUpdateChannelDirect') }}</option>
          <option value="mirror">{{ $t('obUpdateChannelMirror') }}</option>
        </select>
        <button
          v-if="progress?.running"
          type="button"
          class="btn btn-sm"
          @click="dialogOpen = true"
        >
          <span class="loading loading-spinner loading-xs" />
          {{ $t('obUpdateViewProgress') }}
        </button>
        <button
          v-else-if="latest?.hasUpdate"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="starting"
          @click="start"
        >
          <span
            v-if="starting"
            class="loading loading-spinner loading-xs"
          />
          {{ $t('obUpdateNow') }}
        </button>
        <button
          v-else
          type="button"
          class="btn btn-sm"
          :disabled="checking"
          @click="check"
        >
          <span
            v-if="checking"
            class="loading loading-spinner loading-xs"
          />
          {{ $t('obUpdateCheck') }}
        </button>
        <span
          v-if="info?.channel"
          class="text-base-content/50 text-xs"
        >{{ $t('obUpdateInstalledChannel', { channel: info.channel.mode === 'mirror' ? $t('obUpdateChannelMirror') : $t('obUpdateChannelDirect') }) }}</span>
      </div>

      <div class="bg-base-content/10 h-px" />

      <!-- 自动更新计划 -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span class="font-medium">{{ $t('obUpdateAuto') }}</span>
        <input
          type="checkbox"
          class="toggle toggle-sm"
          :checked="plan.auto"
          @change="savePlan({ auto: ($event.target as HTMLInputElement).checked })"
        />
        <template v-if="plan.auto">
          <span class="text-base-content/70">{{ $t('geoUpdateEvery') }}</span>
          <select
            class="select select-sm w-24"
            :value="plan.days"
            @change="savePlan({ days: Number(($event.target as HTMLSelectElement).value) })"
          >
            <option
              v-for="d in [1, 3, 7, 14, 30]"
              :key="d"
              :value="d"
            >{{ $t('geoUpdateDays', { days: d }) }}</option>
          </select>
          <span class="text-base-content/70">{{ $t('obUpdateAutoAt') }}</span>
          <select
            class="select select-sm w-24"
            :value="plan.hour"
            @change="savePlan({ hour: Number(($event.target as HTMLSelectElement).value) })"
          >
            <option
              v-for="h in 24"
              :key="h - 1"
              :value="h - 1"
            >{{ String(h - 1).padStart(2, '0') }}:00</option>
          </select>
          <select
            class="select select-sm"
            :value="plan.channel"
            @change="savePlan({ channel: ($event.target as HTMLSelectElement).value as 'auto' | 'direct' | 'mirror' })"
          >
            <option value="auto">{{ $t('obUpdateChannelAuto') }}</option>
            <option value="direct">{{ $t('obUpdateChannelDirect') }}</option>
            <option value="mirror">{{ $t('obUpdateChannelMirror') }}</option>
          </select>
        </template>
        <span class="text-base-content/50 text-xs">{{ $t('obUpdateAutoHint') }}</span>
      </div>

    </div>
  </div>

  <!-- 升级进行中的进度和日志放弹窗里,卡片布局不动。升级到换文件阶段面板会重启,
       弹窗关掉也不影响后台的升级。 -->
  <DialogWrapper
    v-model="dialogOpen"
    :title="$t('obUpdateDialogTitle')"
    box-class="w-full max-w-2xl"
  >
    <div class="flex flex-col gap-3 text-sm">
      <div class="flex items-center gap-2">
        <span
          v-if="progress?.running"
          class="loading loading-spinner loading-xs"
        />
        <span>{{ stageText }}</span>
        <span
          v-if="progress?.message"
          class="text-base-content/60 truncate text-xs"
        >{{ progress.message }}</span>
      </div>
      <progress
        class="progress progress-primary w-full"
        :value="percent ?? undefined"
        max="100"
      />
      <pre
        v-if="info?.logTail"
        class="bg-base-200/60 max-h-64 overflow-auto rounded-lg p-2 font-mono text-xs whitespace-pre-wrap"
      >{{ info.logTail }}</pre>
      <div class="flex justify-end gap-2">
        <button
          v-if="progress?.running"
          type="button"
          class="btn btn-sm"
          :disabled="!cancellable"
          @click="cancel"
        >
          {{ $t('cancel') }}
        </button>
        <button
          type="button"
          class="btn btn-sm"
          @click="dialogOpen = false"
        >
          {{ $t('close') }}
        </button>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import type { OpenboxProfile, OpenboxUpdateStatus } from '@/api/openbox'
import { cancelUpdate, checkUpdate, fetchUpdateStatus, runUpdate } from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { showNotification } from '@/helper/notification'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const { t } = useI18n()
const info = ref<OpenboxUpdateStatus | null>(null)
const latest = ref<{ latest: string; hasUpdate: boolean } | null>(null)
const checking = ref(false)
const starting = ref(false)
const channel = ref<'auto' | 'direct' | 'mirror'>('auto')
const dialogOpen = ref(false)
const progress = computed(() => info.value?.status)
const plan = computed(() => ({
  auto: props.profile.updates?.openbox?.auto === true,
  hour: props.profile.updates?.openbox?.hour ?? 4,
  days: props.profile.updates?.openbox?.days ?? 1,
  channel: props.profile.updates?.openbox?.channel ?? 'auto',
}))

// 与 scripts/update.sh 里"可安全取消的阶段"一致:committing 之后不能取消
const CANCELLABLE = new Set(['starting', 'probing', 'downloading', 'verifying', 'extracting'])
const cancellable = computed(() => CANCELLABLE.has(progress.value?.stage || ''))
const percent = computed(() => {
  const p = progress.value
  if (!p || !p.total || p.bytes === null) return null
  return Math.min(100, Math.round((p.bytes / p.total) * 100))
})
const stageText = computed(() => {
  const stage = progress.value?.stage || ''
  const key = `obUpdateStage_${stage}`
  const text = t(key)
  return text === key ? stage : text
})

let timer = 0
let wasRunning = false
// 面板重启窗口内连续失败的次数;升级进行中最多再试 45 次(约 90 秒),重连上就清零
let offline = 0
const load = async () => {
  try {
    info.value = await fetchUpdateStatus()
    offline = 0
  } catch {
    // 升级到换文件阶段时面板会重启,接口短暂不可用是正常的。之前这里直接 return,
    // 轮询就此停掉:弹窗停在「正在替换文件…」,升级其实已完成、页面却不会刷新。
    // 升级进行中就隔两秒再试,直到重新读到状态(done / failed 会照常提示、刷新)。
    if (wasRunning && offline < 45) {
      offline += 1
      schedule(2000)
    }
    return
  }
  const running = Boolean(info.value.status.running)
  // 打开页面时升级已经在跑(比如自动更新),也把弹窗弹出来
  if (running && !wasRunning) dialogOpen.value = true
  if (wasRunning && !running) {
    const stage = info.value.status.stage
    if (stage === 'done') {
      showNotification({ content: 'obUpdateDone', type: 'alert-success' })
      window.setTimeout(() => window.location.reload(), 1500)
    } else if (stage === 'failed') {
      showNotification({ content: 'obUpdateFailed', params: { message: info.value.status.message }, type: 'alert-error', timeout: 8000 })
    } else if (stage === 'cancelled') {
      showNotification({ content: 'obUpdateCancelled', type: 'alert-warning' })
    }
  }
  wasRunning = running
  schedule(running ? 1500 : 0)
}
const schedule = (ms: number) => {
  window.clearTimeout(timer)
  if (ms > 0) timer = window.setTimeout(load, ms)
}

const check = async () => {
  checking.value = true
  try {
    const r = await checkUpdate()
    latest.value = r
    showNotification({ content: r.hasUpdate ? 'obUpdateAvailableToast' : 'obUpdateUpToDateToast', params: { latest: r.latest }, type: r.hasUpdate ? 'alert-info' : 'alert-success' })
  } catch (err) {
    showNotification({ content: 'obUpdateCheckFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  } finally {
    checking.value = false
  }
}
const start = async () => {
  starting.value = true
  try {
    await runUpdate(channel.value)
    showNotification({ content: 'obUpdateStarted', type: 'alert-info' })
    dialogOpen.value = true
    wasRunning = true
    schedule(800)
  } catch (err) {
    showNotification({ content: 'obUpdateStartFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  } finally {
    starting.value = false
  }
}
const cancel = async () => {
  try {
    await cancelUpdate()
    schedule(500)
  } catch (err) {
    showNotification({ content: 'obUpdateStartFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  }
}
const savePlan = async (patch: Partial<{ auto: boolean; hour: number; days: number; channel: 'auto' | 'direct' | 'mirror' }>) => {
  try {
    await props.patchProfile({ updates: { openbox: { ...plan.value, ...patch } } })
    showNotification({ content: 'obUpdatePlanSaved', type: 'alert-success' })
  } catch (err) {
    showNotification({ content: 'routingSaveFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  }
}

onMounted(() => {
  channel.value = 'auto'
  void load()
})
onBeforeUnmount(() => window.clearTimeout(timer))
</script>
