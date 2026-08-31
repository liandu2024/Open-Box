<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4">
      <div>
        <h2 class="text-base font-semibold">{{ $t('routingRegionTitle') }}</h2>
        <p class="text-base-content/60 text-xs">{{ $t('routingRegionDescription') }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <label class="text-xs font-medium">{{ $t('routingRegionLabel') }}</label>
        <select
          v-model="selectedRegion"
          class="select select-sm min-w-0 flex-1 sm:max-w-56"
        >
          <option
            v-for="opt in REGION_OPTIONS"
            :key="opt.code"
            :value="opt.code"
          >
            {{ $t(opt.labelKey) }}
          </option>
        </select>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="loadingDefaults"
          @click="handlePreview"
        >
          <span
            v-if="loadingDefaults"
            class="loading loading-spinner loading-xs"
          />
          {{ $t('routingRegionPreview') }}
        </button>
      </div>

      <!-- Preview fetched but not yet applied: the actual overwrite only happens once the user
           hits Apply below, so this block is where the "this replaces your current DNS/routing
           settings" consequence has to be visible — this card is reached from a box that may
           already be configured, so it can never assume there's nothing to lose. -->
      <div
        v-if="defaults"
        class="border-warning/30 bg-warning/10 flex flex-col gap-2 rounded-lg border p-3 text-sm"
      >
        <p class="text-warning font-medium">{{ $t('routingRegionApplyWarning') }}</p>
        <ul class="text-base-content/80 flex flex-col gap-1 text-xs">
          <li>{{ directSummary }}</li>
          <li>{{ otherSummary }}</li>
        </ul>
        <p
          v-if="applyError"
          class="text-error text-xs"
        >
          {{ applyError }}
        </p>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            :disabled="applying"
            @click="defaults = null"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-warning btn-xs"
            :disabled="applying"
            @click="handleApply"
          >
            <span
              v-if="applying"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('routingRegionApplyConfirm') }}
          </button>
        </div>
      </div>

      <p
        v-if="loadError"
        class="text-error text-xs"
      >
        {{ loadError }}
      </p>
      <p
        v-if="successMessage"
        class="text-success text-xs"
      >
        {{ successMessage }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fetchProfileDefaults, type OpenboxProfile, type OpenboxProfileDefaults } from '@/api/openbox'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { findRegionOption, OTHER_REGION_CODE, REGION_OPTIONS } from './regions'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const { t } = useI18n()

const selectedRegion = ref(props.profile.region || 'CN')
const loadingDefaults = ref(false)
const applying = ref(false)
const loadError = ref('')
const applyError = ref('')
const successMessage = ref('')
const defaults = ref<OpenboxProfileDefaults | null>(null)

// A stale preview applying to the wrong region would be worse than no preview at all — clear it
// the moment the selection changes so Apply can never fire for a region the user has since moved
// away from.
watch(selectedRegion, () => {
  defaults.value = null
  applyError.value = ''
})

const regionLabel = computed(() => {
  const option = findRegionOption(selectedRegion.value)
  return option ? t(option.labelKey) : selectedRegion.value
})

const isProxyFallback = computed(() => (defaults.value?.routing.fallback || '').toUpperCase() === 'PROXY')

const directSummary = computed(() => t('routingRegionDirectSummary', { region: regionLabel.value }))
const otherSummary = computed(() =>
  t(isProxyFallback.value ? 'routingRegionOtherSummaryProxy' : 'routingRegionOtherSummaryDirect'),
)

const handlePreview = async () => {
  if (loadingDefaults.value) return

  loadingDefaults.value = true
  loadError.value = ''
  successMessage.value = ''
  try {
    defaults.value = await fetchProfileDefaults(selectedRegion.value)
  } catch (error) {
    defaults.value = null
    loadError.value = t('routingRegionLoadFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    loadingDefaults.value = false
  }
}

const handleApply = async () => {
  if (applying.value || !defaults.value) return

  applying.value = true
  applyError.value = ''

  try {
    // `geosite-other`/`geoip-other` aren't real ruleset files — see regions.ts. For the
    // catch-all region, keep the DNS/fallback shape the backend recommends but don't send a
    // direct-ruleset tag that could never resolve to anything at deploy time.
    const directRulesets =
      selectedRegion.value === OTHER_REGION_CODE ? [] : defaults.value.routing.directRulesets

    await props.patchProfile({
      region: selectedRegion.value,
      dns: defaults.value.dns,
      routing: {
        ...defaults.value.routing,
        directRulesets,
      },
    })

    successMessage.value = t('routingRegionApplySuccess', { region: regionLabel.value })
    defaults.value = null
  } catch (error) {
    applyError.value = t('routingRegionApplyFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    applying.value = false
  }
}
</script>
