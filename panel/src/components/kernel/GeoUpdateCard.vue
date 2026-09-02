<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4 text-sm">
      <div>
        <h2 class="text-base font-semibold">{{ $t('geoUpdateTitle') }}</h2>
        <p class="text-base-content/60 text-xs">{{ $t('geoUpdateDescription') }}</p>
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

      <div class="flex flex-wrap items-center gap-2">
        <button
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
        </template>
        <span class="text-base-content/50 text-xs">{{ $t('geoUpdateAutoHint') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxProfile } from '@/api/openbox'
import { fetchRulesetsRefreshStatus, refreshRulesets } from '@/api/openbox'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { showNotification } from '@/helper/notification'
import dayjs from 'dayjs'
import { computed, onMounted, ref } from 'vue'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const status = ref<Awaited<ReturnType<typeof fetchRulesetsRefreshStatus>> | null>(null)
const refreshing = ref(false)
const plan = computed(() => ({
  auto: props.profile.updates?.geo?.auto === true,
  hour: props.profile.updates?.geo?.hour ?? 4,
  days: props.profile.updates?.geo?.days ?? 7,
}))
const lastText = computed(() => (status.value?.lastAt ? dayjs(status.value.lastAt).fromNow() : '—'))

const load = async () => {
  try {
    status.value = await fetchRulesetsRefreshStatus()
  } catch {
    // 读不到就留空
  }
}

const refresh = async () => {
  refreshing.value = true
  try {
    const r = await refreshRulesets()
    if (r.ok) {
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

const savePlan = async (patch: Partial<{ auto: boolean; hour: number; days: number }>) => {
  try {
    await props.patchProfile({ updates: { geo: { ...plan.value, ...patch } } })
    showNotification({ content: 'obUpdatePlanSaved', type: 'alert-success' })
  } catch (err) {
    showNotification({ content: 'routingSaveFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  }
}

onMounted(load)
</script>
