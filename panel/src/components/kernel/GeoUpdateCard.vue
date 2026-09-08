<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4 text-sm">
      <div>
        <h2 class="text-base font-semibold">{{ $t('geoUpdateTitle') }}</h2>
        <p class="text-base-content/60 text-xs">{{ $t('geoUpdateDescription') }}</p>
      </div>

      <!-- 版本一行:当前 / 最新。版本 = 上游两个仓库的发布 tag -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span class="text-base-content/70">{{ $t('geoUpdateCurrent') }}:</span>
        <span class="font-mono">{{ versionText(status?.versions) }}</span>
        <template v-if="latest">
          <span class="text-base-content/70">{{ $t('geoUpdateLatest') }}:</span>
          <span class="font-mono">{{ versionText(latest.latest) }}</span>
          <StatusBadge
            :on="!latest.hasUpdate"
            :on-text="$t('geoUpdateUpToDate')"
            :off-text="$t('geoUpdateAvailable')"
          />
        </template>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span class="text-base-content/70">{{ $t('geoUpdateCount') }}:</span>
        <span>{{ status?.count ?? '—' }}</span>
        <span class="text-base-content/70">{{ $t('geoUpdateLast') }}:</span>
        <span>{{ lastText }}</span>
        <StatusBadge
          v-if="status?.lastAt"
          :on="!status.failed.length"
          :on-text="$t('geoUpdateLastOk', { count: status.updated.length })"
          :off-text="$t('geoUpdateLastFailed', { count: status.failed.length })"
        />
      </div>

      <!-- 操作:[通道] [一个按钮]。与 Open-Box 更新卡一致:检查更新 → 探到新版就变成 立即更新;
           没探到按钮不变,只弹一条「已是最新」。 -->
      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="channel"
          class="select select-sm"
          :disabled="refreshing"
        >
          <option value="auto">{{ $t('obUpdateChannelAuto') }}</option>
          <option value="direct">{{ $t('obUpdateChannelDirect') }}</option>
          <option value="mirror">{{ $t('obUpdateChannelMirror') }}</option>
        </select>
        <button
          v-if="latest?.hasUpdate"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="refreshing"
          @click="refresh"
        >
          <span
            v-if="refreshing"
            class="loading loading-spinner loading-xs"
          />
          {{ $t('geoUpdateNow') }}
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
          {{ $t('geoUpdateCheck') }}
        </button>
        <span class="text-base-content/50 text-xs">{{ $t('geoUpdateNowHint') }}</span>
      </div>

      <div class="bg-base-content/10 h-px" />

      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span class="font-medium">{{ $t('geoUpdateAuto') }}</span>
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
            @change="savePlan({ channel: ($event.target as HTMLSelectElement).value as OpenboxUpdateChannel })"
          >
            <option value="auto">{{ $t('obUpdateChannelAuto') }}</option>
            <option value="direct">{{ $t('obUpdateChannelDirect') }}</option>
            <option value="mirror">{{ $t('obUpdateChannelMirror') }}</option>
          </select>
        </template>
        <span class="text-base-content/50 text-xs">{{ $t('geoUpdateAutoHint') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxGeoVersions, OpenboxProfile, OpenboxUpdateChannel } from '@/api/openbox'
import { checkGeoUpdate, fetchRulesetsRefreshStatus, refreshRulesets } from '@/api/openbox'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { showNotification } from '@/helper/notification'
import dayjs from 'dayjs'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const { t } = useI18n()
const status = ref<Awaited<ReturnType<typeof fetchRulesetsRefreshStatus>> | null>(null)
const latest = ref<Awaited<ReturnType<typeof checkGeoUpdate>> | null>(null)
const checking = ref(false)
const refreshing = ref(false)
const plan = computed(() => ({
  auto: props.profile.updates?.geo?.auto === true,
  hour: props.profile.updates?.geo?.hour ?? 4,
  days: props.profile.updates?.geo?.days ?? 7,
  channel: props.profile.updates?.geo?.channel ?? 'auto',
  checkChannel: props.profile.updates?.geo?.checkChannel ?? 'auto',
}))
// 手动检查 / 更新用的通道:记在档案里,下次进页面还是上次选的;改了就静默存一次
const channel = ref<OpenboxUpdateChannel>(plan.value.checkChannel)
watch(() => plan.value.checkChannel, (v) => { channel.value = v })
watch(channel, async (v) => {
  if (v === plan.value.checkChannel) return
  try {
    await props.patchProfile({ updates: { geo: { ...plan.value, checkChannel: v } } })
  } catch (err) {
    showNotification({
      content: 'routingSaveFailed',
      params: { message: err instanceof Error ? err.message : String(err) },
      type: 'alert-error',
    })
  }
})
const lastText = computed(() => (status.value?.lastAt ? dayjs(status.value.lastAt).fromNow() : '—'))

const GEO_REPOS = ['geosite', 'geoip'] as const
// 「geosite 20260831141734 · geoip 20260812」;一个都没有就是未知(老安装没记过)
const versionText = (v?: OpenboxGeoVersions | null) => {
  const present = GEO_REPOS.filter((k) => v?.[k])
  if (!present.length) return t('geoUpdateUnknown')
  // geosite / geoip 现在来自同一个仓库、记同一个版本号(提交日期 + 短 sha),相同就只显示一次
  const distinct = new Set(present.map((k) => v?.[k]))
  return distinct.size === 1 ? String(v?.[present[0]]) : present.map((k) => `${k} ${v?.[k]}`).join(' · ')
}

const load = async () => {
  try {
    status.value = await fetchRulesetsRefreshStatus()
  } catch {
    // 读不到就留空
  }
  // 刚更新完:按新记下的版本重新判断还有没有新版
  if (latest.value) {
    const current = status.value?.versions || {}
    latest.value = { ...latest.value, current, hasUpdate: latest.value.used.some((k) => latest.value?.latest[k] && latest.value.latest[k] !== current[k]) }
  }
}

const check = async () => {
  checking.value = true
  try {
    const r = await checkGeoUpdate(channel.value)
    latest.value = r
    const shown = versionText(r.latest)
    showNotification({ content: r.hasUpdate ? 'geoUpdateAvailableToast' : 'geoUpdateUpToDateToast', params: { latest: shown }, type: r.hasUpdate ? 'alert-info' : 'alert-success' })
  } catch (err) {
    showNotification({ content: 'geoUpdateCheckFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  } finally {
    checking.value = false
  }
}

const refresh = async () => {
  refreshing.value = true
  try {
    const r = await refreshRulesets(channel.value)
    if (r.ok && r.nothing) {
      showNotification({ content: 'geoUpdateNothing', params: { message: r.message || '' }, type: 'alert-info', timeout: 8000 })
    } else if (r.ok) {
      showNotification({ content: r.restarted ? 'geoUpdateDoneRestarted' : 'geoUpdateDone', params: { count: String(r.updated.length) }, type: 'alert-success' })
    } else {
      const detail = r.restartMessage || r.failed.map((f) => `${f.tag}: ${f.message}`).join('; ') || r.message || ''
      showNotification({ content: 'geoUpdateFailed', params: { message: detail }, type: 'alert-error', timeout: 8000 })
    }
  } catch (err) {
    showNotification({ content: 'geoUpdateFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  } finally {
    refreshing.value = false
    void load()
  }
}

const savePlan = async (patch: Partial<{ auto: boolean; hour: number; days: number; channel: OpenboxUpdateChannel }>) => {
  try {
    await props.patchProfile({ updates: { geo: { ...plan.value, ...patch } } })
    showNotification({ content: 'obUpdatePlanSaved', type: 'alert-success' })
  } catch (err) {
    showNotification({ content: 'routingSaveFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  }
}

onMounted(load)
</script>
