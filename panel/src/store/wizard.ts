// Onboarding-wizard resume/gate state.
//
// Three different kinds of "already done" live here, on purpose:
//  - `serverPasswordSet` (store/auth.ts) is the one hard backend fact.
//  - `wizardLanguageConfirmed`/`wizardRoutingConfirmed`/`wizardDismissed` are client
//    preferences with no natural backend field of their own — they use the existing
//    `config/*` localStorage convention (see store/settings.ts), which
//    helper/persistentStorage.ts already syncs to `/api/storage` for every `config/*` key.
//    So these *are* backend-persisted, just via the generic KV store rather than a
//    dedicated openbox endpoint, and they survive both a refresh and a different
//    browser hitting the same panel.
//  - `hasAnySubscription` is fetched straight from `/api/openbox/subscriptions` — the
//    router guard's safety net for the case where subscriptions already exist (e.g. added
//    before this wizard shipped, or via another client) even though none of the local flags
//    above were ever set.
import { fetchSubscriptions } from '@/api/openbox'
import { serverAccessPasswordEnabled, serverAuthenticated, serverPasswordSet } from '@/store/auth'
import { useStorage } from '@vueuse/core'
import { ref } from 'vue'

export const wizardDismissed = useStorage('config/wizard-dismissed', false)
export const wizardLanguageConfirmed = useStorage('config/wizard-language-confirmed', false)
export const wizardRoutingConfirmed = useStorage('config/wizard-routing-confirmed', false)

export const hasAnySubscription = ref(false)

// Called once during bootstrap (see main.ts), after auth state is known and before the
// router starts navigating, so the very first route guard evaluation already has an
// accurate answer instead of momentarily forcing (or failing to force) the wizard.
export const initializeWizardGateState = async () => {
  const canReadOpenboxState =
    serverPasswordSet.value && (!serverAccessPasswordEnabled.value || serverAuthenticated.value)

  if (!canReadOpenboxState) {
    return
  }

  try {
    const subscriptions = await fetchSubscriptions()
    hasAnySubscription.value = subscriptions.length > 0
  } catch (error) {
    console.warn('Failed to check onboarding subscription state', error)
  }
}

// Both "finished" and "skipped" mean the same thing to the router guard: stop forcing the
// wizard on this browser. Whether they actually finished each step is still visible from the
// individual flags above if the wizard is revisited manually.
export const markWizardDismissed = () => {
  wizardDismissed.value = true
}
