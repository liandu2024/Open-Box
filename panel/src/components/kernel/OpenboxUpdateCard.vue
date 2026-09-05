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
        <span class="font-mono">{{ updateInfo?.version || '—' }}</span>
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
          :disabled="updateRunning"
        >
          <option value="auto">{{ $t('obUpdateChannelAuto') }}</option>
          <option value="direct">{{ $t('obUpdateChannelDirect') }}</option>
          <option value="mirror">{{ $t('obUpdateChannelMirror') }}</option>
        </select>
        <button
          v-if="updateRunning"
          type="button"
          class="btn btn-sm"
          @click="updateDialogOpen = true"
        >
          <span class="loading loading-spinner loading-xs" />
          {{ $t('obUpdateViewProgress') }}
        </button>
        <button
          v-else-if="latest?.hasUpdate"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="updateStarting"
          @click="start"
        >
          <span
            v-if="updateStarting"
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
          v-if="updateInfo?.channel"
          class="text-base-content/50 text-xs"
        >{{ $t('obUpdateInstalledChannel', { channel: updateInfo!.channel.mode === 'mirror' ? $t('obUpdateChannelMirror') : $t('obUpdateChannelDirect') }) }}</span>
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

</template>

<script setup lang="ts">
import type { OpenboxProfile, OpenboxUpdateChannel } from '@/api/openbox'
import { checkUpdate } from '@/api/openbox'
import StatusBadge from '@/components/common/StatusBadge.vue'
// 升级进度是全局的(面板和内核各重启一次,用户可能待在任何页面),状态和弹窗都在
// composables/openboxUpdate 这个单例里,弹窗由 App.vue 挂在根上;这张卡只管发起和显示版本。
import {
  refreshUpdateInfo,
  startUpdate,
  updateDialogOpen,
  updateInfo,
  updateRunning,
  updateStarting,
} from '@/composables/openboxUpdate'
import { showNotification } from '@/helper/notification'
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const latest = ref<{ latest: string; hasUpdate: boolean } | null>(null)
const checking = ref(false)
const plan = computed(() => ({
  auto: props.profile.updates?.openbox?.auto === true,
  hour: props.profile.updates?.openbox?.hour ?? 4,
  days: props.profile.updates?.openbox?.days ?? 1,
  channel: props.profile.updates?.openbox?.channel ?? 'auto',
  checkChannel: props.profile.updates?.openbox?.checkChannel ?? 'auto',
}))
// 手动检查 / 更新用的通道:记在档案里,下次进页面还是上次选的;改了就静默存一次
const channel = ref<OpenboxUpdateChannel>(plan.value.checkChannel)
watch(() => plan.value.checkChannel, (v) => { channel.value = v })
watch(channel, async (v) => {
  if (v === plan.value.checkChannel) return
  try {
    await props.patchProfile({ updates: { openbox: { ...plan.value, checkChannel: v } } })
  } catch (err) {
    showNotification({
      content: 'routingSaveFailed',
      params: { message: err instanceof Error ? err.message : String(err) },
      type: 'alert-error',
    })
  }
})

const check = async () => {
  checking.value = true
  try {
    const r = await checkUpdate()
    latest.value = r
    showNotification({
      content: r.hasUpdate ? 'obUpdateAvailableToast' : 'obUpdateUpToDateToast',
      params: { latest: r.latest },
      type: r.hasUpdate ? 'alert-info' : 'alert-success',
    })
  } catch (err) {
    showNotification({
      content: 'obUpdateCheckFailed',
      params: { message: err instanceof Error ? err.message : String(err) },
      type: 'alert-error',
    })
  } finally {
    checking.value = false
  }
}

const start = () => startUpdate(channel.value)

const savePlan = async (patch: Partial<{ auto: boolean; hour: number; days: number; channel: OpenboxUpdateChannel }>) => {
  try {
    await props.patchProfile({ updates: { openbox: { ...plan.value, ...patch } } })
    showNotification({ content: 'obUpdatePlanSaved', type: 'alert-success' })
  } catch (err) {
    showNotification({
      content: 'routingSaveFailed',
      params: { message: err instanceof Error ? err.message : String(err) },
      type: 'alert-error',
    })
  }
}

onMounted(() => {
  void refreshUpdateInfo()
})
</script>
