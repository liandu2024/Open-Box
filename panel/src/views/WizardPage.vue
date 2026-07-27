<template>
  <div class="bg-base-200/50 flex h-full w-full flex-col overflow-y-auto">
    <div class="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-6 sm:py-10">
      <div class="flex min-h-6 items-center justify-end">
        <button
          v-if="currentStep > WIZARD_STEP.PASSWORD && currentStep < WIZARD_STEP.FINISH"
          type="button"
          class="btn btn-ghost btn-xs"
          @click="handleSkip"
        >
          {{ $t('wizardSkip') }}
        </button>
      </div>

      <div class="card bg-base-100 px-4 py-5 sm:px-6">
        <RoutePath
          :has-region="hasRegion"
          :has-nodes="hasNodes"
          :direct-label="directLabel"
          :node-label="nodeLabel"
        />
      </div>

      <ul class="steps steps-horizontal w-full text-[10px] sm:text-xs">
        <li
          v-for="(labelKey, idx) in STEP_LABEL_KEYS"
          :key="labelKey"
          class="step"
          :class="idx <= visibleStepIndex && 'step-primary'"
        >
          {{ $t(labelKey) }}
        </li>
      </ul>

      <div class="card bg-base-100 flex-1 px-4 py-6 sm:px-6">
        <div
          v-if="loading"
          class="text-base-content/60 flex items-center gap-2 text-sm"
        >
          <span class="loading loading-spinner loading-xs" />
          {{ $t('wizardLoading') }}
        </div>

        <template v-else>
          <WizardStepPassword
            v-if="currentStep === WIZARD_STEP.PASSWORD"
            @next="handlePasswordNext"
          />
          <WizardStepLanguage
            v-else-if="currentStep === WIZARD_STEP.LANGUAGE"
            @next="currentStep = WIZARD_STEP.REGION"
          />
          <WizardStepRegion
            v-else-if="currentStep === WIZARD_STEP.REGION"
            :initial-region="selectedRegion"
            @next="handleRegionNext"
          />
          <WizardStepConfirmRouting
            v-else-if="currentStep === WIZARD_STEP.CONFIRM"
            :region="selectedRegion"
            @back="currentStep = WIZARD_STEP.REGION"
            @next="handleConfirmNext"
          />
          <WizardStepSubscription
            v-else-if="currentStep === WIZARD_STEP.SUBSCRIPTION"
            @next="handleSubscriptionNext"
          />
          <WizardStepFinish
            v-else
            :has-nodes="hasNodes"
            @finish="handleFinish"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fetchProfile, fetchSubscriptions, type OpenboxProfile, type OpenboxSubscription } from '@/api/openbox'
import RoutePath from '@/components/wizard/RoutePath.vue'
import { findRegionOption } from '@/components/wizard/regions'
import WizardStepConfirmRouting from '@/components/wizard/WizardStepConfirmRouting.vue'
import WizardStepFinish from '@/components/wizard/WizardStepFinish.vue'
import WizardStepLanguage from '@/components/wizard/WizardStepLanguage.vue'
import WizardStepPassword from '@/components/wizard/WizardStepPassword.vue'
import WizardStepRegion from '@/components/wizard/WizardStepRegion.vue'
import WizardStepSubscription from '@/components/wizard/WizardStepSubscription.vue'
import { ROUTE_NAME } from '@/constant'
import router from '@/router'
import { serverPasswordSet } from '@/store/auth'
import {
  hasAnySubscription,
  markWizardDismissed,
  wizardLanguageConfirmed,
  wizardRoutingConfirmed,
} from '@/store/wizard'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

enum WIZARD_STEP {
  PASSWORD = 0,
  LANGUAGE = 1,
  REGION = 2,
  CONFIRM = 3,
  SUBSCRIPTION = 4,
  FINISH = 5,
}

const STEP_LABEL_KEYS = [
  'wizardStepShortPassword',
  'wizardStepShortLanguage',
  'wizardStepShortRegion',
  'wizardStepShortConfirm',
  'wizardStepShortSubscription',
] as const

const { t } = useI18n()

const loading = ref(true)
const currentStep = ref<WIZARD_STEP>(WIZARD_STEP.PASSWORD)
const selectedRegion = ref('CN')
const profile = ref<OpenboxProfile | null>(null)
const subscriptions = ref<OpenboxSubscription[]>([])

// Only the initial two columns of "step X of 5" progress — the finish screen shows all five
// as complete rather than introducing a 6th dot for something that isn't really a data-entry
// step.
const visibleStepIndex = computed(() => Math.min(currentStep.value, WIZARD_STEP.SUBSCRIPTION))

const hasRegion = computed(() => wizardRoutingConfirmed.value)
const hasNodes = computed(() => subscriptions.value.length > 0)

const directLabel = computed(() => {
  if (!hasRegion.value || !profile.value) return ''
  const option = findRegionOption(profile.value.region)
  return option ? t(option.labelKey) : profile.value.region
})

const nodeLabel = computed(() => {
  if (!hasNodes.value) return ''
  const total = subscriptions.value.reduce((sum, sub) => sum + (sub.nodeCount || 0), 0)
  return t('wizardPathNodeCount', { count: total })
})

// Openbox data only exists once a password is set (backend 403s before that) — safe to call
// unconditionally since the guard above skips it, and any transient auth hiccup mid-fetch is
// already handled globally by fetchServerApi's 401/403 redirect.
const loadWizardData = async () => {
  if (!serverPasswordSet.value) return

  try {
    const [fetchedProfile, fetchedSubscriptions] = await Promise.all([
      fetchProfile(),
      fetchSubscriptions(),
    ])
    profile.value = fetchedProfile
    subscriptions.value = fetchedSubscriptions
    selectedRegion.value = fetchedProfile.region || selectedRegion.value
    hasAnySubscription.value = fetchedSubscriptions.length > 0
  } catch (error) {
    console.warn('Wizard: failed to load existing profile/subscriptions', error)
  }
}

// The one place step position is *derived* rather than just advanced by one — used for the
// initial landing (including the case where a refresh drops the user back in mid-flow) and
// again right after the password step, since that's the first moment openbox data becomes
// readable at all.
const computeResumeStep = (): WIZARD_STEP => {
  if (!serverPasswordSet.value) return WIZARD_STEP.PASSWORD
  if (!wizardLanguageConfirmed.value) return WIZARD_STEP.LANGUAGE
  if (!wizardRoutingConfirmed.value) return WIZARD_STEP.REGION
  if (subscriptions.value.length === 0) return WIZARD_STEP.SUBSCRIPTION
  return WIZARD_STEP.FINISH
}

onMounted(async () => {
  await loadWizardData()
  currentStep.value = computeResumeStep()
  loading.value = false
})

const handlePasswordNext = async () => {
  await loadWizardData()
  currentStep.value = computeResumeStep()
}

const handleRegionNext = (region: string) => {
  selectedRegion.value = region
  currentStep.value = WIZARD_STEP.CONFIRM
}

const handleConfirmNext = async () => {
  const fetchedProfile = await fetchProfile().catch(() => null)
  if (fetchedProfile) profile.value = fetchedProfile
  currentStep.value = WIZARD_STEP.SUBSCRIPTION
}

const handleSubscriptionNext = async () => {
  const fetchedSubscriptions = await fetchSubscriptions().catch(() => null)
  if (fetchedSubscriptions) {
    subscriptions.value = fetchedSubscriptions
    hasAnySubscription.value = fetchedSubscriptions.length > 0
  }
  currentStep.value = WIZARD_STEP.FINISH
}

const leaveWizard = () => {
  markWizardDismissed()
  router.push({ name: ROUTE_NAME.proxies })
}

const handleSkip = () => leaveWizard()
const handleFinish = () => leaveWizard()
</script>
