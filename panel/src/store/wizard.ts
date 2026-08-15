// Onboarding-wizard resume/gate state.
//
// Different kinds of "already done" live here, on purpose:
//  - `serverPasswordSet` (store/auth.ts) is a hard backend fact.
//  - `wizardDone` is ALSO a hard backend fact as of P5 (openbox/wizard-done, see
//    server/store/openbox-store.mjs) — this is the router guard's source of truth for
//    whether to force the wizard. It used to be a `config/*` localStorage flag synced
//    through the generic `/api/storage` KV store, which caused a real bug (P4b final
//    review): after a factory reset / reinstall the backend is fresh, but a browser that
//    was used with the PREVIOUS install still had the old flag in localStorage, and the
//    generic sync would even push that stale flag back up into the fresh backend's
//    generic storage — permanently suppressing the wizard on a box that was never
//    actually configured. Moving the flag into the openbox/* namespace (protected from
//    the generic sync by index.mjs's isProtectedStorageKey) fixes this: a fresh backend
//    always reports done:false, and nothing the client says can override that.
//    `wizardDoneCache` below is kept as a local *cache* of the last known backend value
//    (old key name, still useful for an instant read before the network round trip
//    resolves, or as a best-effort fallback if the fetch fails) — it must never be the
//    value the guard trusts on its own.
//  - `wizardLanguageConfirmed`/`wizardRoutingConfirmed` are step-resume preferences with
//    no natural backend field of their own — they use the existing `config/*` localStorage
//    convention (see store/settings.ts), which helper/persistentStorage.ts already syncs
//    to `/api/storage` for every `config/*` key. Unlike wizardDone, being wrong here just
//    means resuming at the wrong step inside a wizard the guard already decided to show —
//    not skipping the wizard entirely — so the same generic-sync convention is fine.
//  - `hasAnySubscription` is fetched straight from `/api/openbox/subscriptions` — the
//    router guard's safety net for the case where subscriptions already exist (e.g. added
//    before this wizard shipped, or via another client) even though wizardDone was never
//    explicitly set.
import { fetchSubscriptions, fetchWizardDone, saveWizardDone } from '@/api/openbox'
import { serverAccessPasswordEnabled, serverAuthenticated, serverPasswordSet } from '@/store/auth'
import { useStorage } from '@vueuse/core'
import { ref } from 'vue'

// Local cache only (see module comment above) — deliberately NOT under the `config/*`
// prefix, so persistentStorage.ts's generic sync never touches it (mirrors the
// `cache/last-route-name` convention in router/index.ts). Seeds `wizardDone` below so a
// reload doesn't flash the wizard before the real fetch resolves.
const wizardDoneCache = useStorage('cache/wizard-done', false)

export const wizardDone = ref(wizardDoneCache.value)
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
    const [subscriptions, done] = await Promise.all([fetchSubscriptions(), fetchWizardDone()])
    hasAnySubscription.value = subscriptions.length > 0
    // Backend wins unconditionally, including overwriting a stale `true` left over from a
    // previous install — this is the actual fix for the P4b regression.
    wizardDone.value = done
    wizardDoneCache.value = done
  } catch (error) {
    console.warn('Failed to check onboarding subscription/wizard-done state', error)
    // Fetch failed (offline/transient) — fall back to whatever the cache last said rather
    // than forcing the wizard on every network hiccup for an already-onboarded user.
  }
}

// Both "finished" and "skipped" mean the same thing to the router guard: stop forcing the
// wizard on this browser. Whether they actually finished each step is still visible from the
// individual flags above if the wizard is revisited manually.
export const markWizardDismissed = () => {
  wizardDone.value = true
  wizardDoneCache.value = true

  // Fire-and-forget: the caller (WizardPage.vue) navigates away immediately after calling
  // this, and this module's state is a singleton that outlives the navigation, so the
  // write completes in the background regardless. A failure here just means a future
  // fetchWizardDone() picks it back up as false — the user would see the wizard again on
  // their next load, not lose data.
  saveWizardDone(true).catch((error) => {
    console.warn('Failed to persist wizard-done to backend', error)
  })
}
