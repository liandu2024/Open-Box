<template>
  <div class="flex flex-col gap-4">
    <div class="space-y-1">
      <h2 class="text-lg font-semibold">{{ $t('wizardStepConfirmTitle') }}</h2>
      <p class="text-base-content/70 text-sm">{{ $t('wizardStepConfirmDescription') }}</p>
    </div>

    <div
      v-if="loading"
      class="text-base-content/60 flex items-center gap-2 text-sm"
    >
      <span class="loading loading-spinner loading-xs" />
      {{ $t('wizardLoading') }}
    </div>

    <!-- fetchProfileDefaults failed: no defaults to show or accept, and the summary list below
         reads straight from `defaults` — rendering it here would show a guess dressed up as a
         recommendation. Offer a retry instead of a list + an Accept button that silently no-ops
         (Minor 3, P4b final review). -->
    <template v-else-if="!defaults">
      <p class="text-error text-sm">
        {{ errorMessage }}
      </p>

      <div class="flex items-center gap-2">
        <button
          class="btn btn-ghost btn-sm"
          @click="$emit('back')"
        >
          {{ $t('wizardChangeRegion') }}
        </button>
        <button
          class="btn btn-primary btn-sm flex-1"
          @click="load"
        >
          {{ $t('wizardStepConfirmRetry') }}
        </button>
      </div>
    </template>

    <template v-else>
      <ul class="flex flex-col gap-2 text-sm">
        <li class="bg-base-200/60 flex items-start gap-2 rounded-lg px-3 py-2">
          <CheckCircleIcon class="text-success mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ directSummary }}</span>
        </li>
        <li class="bg-base-200/60 flex items-start gap-2 rounded-lg px-3 py-2">
          <CheckCircleIcon class="text-success mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ otherSummary }}</span>
        </li>
      </ul>

      <p
        v-if="errorMessage"
        class="text-error text-sm"
      >
        {{ errorMessage }}
      </p>

      <div class="flex items-center gap-2">
        <button
          class="btn btn-ghost btn-sm"
          :disabled="saving"
          @click="$emit('back')"
        >
          {{ $t('wizardChangeRegion') }}
        </button>
        <button
          class="btn btn-primary btn-sm flex-1"
          :disabled="saving"
          @click="handleAccept"
        >
          {{ $t('wizardAccept') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { fetchProfileDefaults, saveProfile, type OpenboxProfileDefaults } from '@/api/openbox'
import { wizardRoutingConfirmed } from '@/store/wizard'
import { CheckCircleIcon } from '@heroicons/vue/24/outline'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { findRegionOption, OTHER_REGION_CODE } from './regions'

const props = defineProps<{
  region: string
}>()

const emit = defineEmits<{
  next: []
  back: []
}>()

const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const defaults = ref<OpenboxProfileDefaults | null>(null)

const regionLabel = computed(() => {
  const option = findRegionOption(props.region)
  return option ? t(option.labelKey) : props.region
})

const isProxyFallback = computed(
  () => (defaults.value?.routing.fallback || '').toUpperCase() === 'PROXY',
)

const directSummary = computed(() => t('wizardConfirmDirectSummary', { region: regionLabel.value }))
const otherSummary = computed(() =>
  t(isProxyFallback.value ? 'wizardConfirmProxySummaryProxy' : 'wizardConfirmProxySummaryDirect'),
)

const load = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    defaults.value = await fetchProfileDefaults(props.region)
  } catch {
    errorMessage.value = t('wizardStepConfirmLoadFailed')
  } finally {
    loading.value = false
  }
}

onMounted(load)

const handleAccept = async () => {
  if (saving.value || !defaults.value) return

  saving.value = true
  errorMessage.value = ''

  try {
    // `geosite-other`/`geoip-other` aren't real ruleset files — see regions.ts. For the
    // catch-all region, keep the DNS/fallback shape the backend recommends but don't send a
    // direct-ruleset tag that could never resolve to anything at deploy time.
    const directRulesets =
      props.region === OTHER_REGION_CODE ? [] : defaults.value.routing.directRulesets

    await saveProfile({
      region: props.region,
      dns: defaults.value.dns,
      routing: {
        ...defaults.value.routing,
        directRulesets,
      },
    })

    wizardRoutingConfirmed.value = true
    emit('next')
  } catch {
    errorMessage.value = t('wizardStepConfirmSaveFailed')
  } finally {
    saving.value = false
  }
}
</script>
