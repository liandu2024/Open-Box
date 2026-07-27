// Local-only "have routing/DNS/IPv6 settings changed since the last successful deploy" flag.
//
// The backend has no per-field "last modified" timestamp on the profile, so this can't be
// derived purely from server data — see server/store/openbox-store.mjs's DEFAULT_PROFILE (no
// updatedAt) and DEFAULT_DEPLOY_STATE (only records the *deploy attempt*, not what triggered
// it). Instead this flag is set locally whenever a save through this page's own patchProfile
// succeeds, and cleared when a deploy through this page succeeds.
//
// Same convention as store/wizard.ts's confirmed-flags: `useStorage('config/...')`, which
// helper/persistentStorage.ts already syncs to the backend's generic KV store, so the flag
// survives a reload and (best-effort) follows a different browser hitting the same panel.
//
// Honesty boundary: this only tracks edits made *through RoutingPage*. It cannot see profile/
// node changes made elsewhere (e.g. adding a subscription changes the nodes that feed policy
// groups into the deployed config too) — RoutingPage.vue's `hasUndeployedChanges` also checks
// the server's own deploy/state `stage`, which at least catches "never successfully deployed"
// and "last deploy attempt failed" regardless of what this flag says.
import { useStorage } from '@vueuse/core'

export const routingPendingDeploy = useStorage('config/routing-pending-deploy', false)
