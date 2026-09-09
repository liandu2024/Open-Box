<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4">
      <div>
        <h2 class="text-base font-semibold">{{ $t('trafficRetentionTitle') }}</h2>
        <p class="text-base-content/60 text-xs">{{ $t('trafficRetentionDescription') }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model.number="months"
          type="number"
          :min="MIN_MONTHS"
          :max="MAX_MONTHS"
          class="input input-sm w-24"
          @change="save"
        />
        <span class="text-sm">{{ $t('trafficRetentionUnit') }}</span>
        <span class="text-base-content/50 text-xs">{{ $t('trafficRetentionRange') }}</span>
      </div>

      <p class="text-base-content/60 text-xs">
        <template v-if="usage && usage.days">
          {{ $t('trafficRetentionUsage', { days: usage.days, size: fmt(usage.bytes), perDay: fmt(usage.perDay) }) }}
          <template v-if="usage.perDay">
            {{ $t('trafficRetentionForecast', { size: fmt(usage.perDay * 30 * months + (usage.hourPerDay || 0) * (usage.hourKeepDays || 7)) }) }}
          </template>
        </template>
        <template v-else>{{ $t('trafficRetentionNoData') }}</template>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fetchTrafficUsage, type OpenboxProfile, type OpenboxTrafficUsage } from '@/api/openbox'
import { showNotification } from '@/helper/notification'
import { onMounted, ref, watch } from 'vue'

const MIN_MONTHS = 1
const MAX_MONTHS = 36
const DEFAULT_MONTHS = 3

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const monthsOf = (p: OpenboxProfile) => p.traffic?.keepMonths ?? DEFAULT_MONTHS
const months = ref(monthsOf(props.profile))
const usage = ref<OpenboxTrafficUsage | null>(null)

watch(() => props.profile, (p) => (months.value = monthsOf(p)))

// 库里现在存了多少,用来把"留几个月"换算成看得见的占用
onMounted(() => {
  fetchTrafficUsage()
    .then((u) => (usage.value = u))
    .catch(() => {})
})

const fmt = (bytes: number) => {
  if (!bytes) return '0 MB'
  const mb = bytes / 1e6
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`
}

// 超期的记录由后端每分钟清一次(system/traffic-collector.mjs),所以调小之后
// 占用不会立刻降,一分钟内会自己降下去。
const save = async () => {
  const next = Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, Math.floor(Number(months.value) || DEFAULT_MONTHS)))
  months.value = next
  try {
    await props.patchProfile({ traffic: { ...(props.profile.traffic || {}), keepMonths: next } })
  } catch (e) {
    months.value = monthsOf(props.profile)
    showNotification({ content: (e as Error).message, type: 'alert-error' })
  }
}
</script>
