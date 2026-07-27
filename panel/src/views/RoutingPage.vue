<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <RoutingDeployBanner
        :has-undeployed-changes="hasUndeployedChanges"
        :deploying="deploying"
        :last-result="lastDeployResult"
        @deploy="handleDeploy"
        @dismiss="lastDeployResult = null"
      />

      <div
        class="flex flex-col gap-3 p-3"
        :style="padding"
      >
        <h1 class="text-lg font-semibold">{{ $t('routing') }}</h1>

        <div
          v-if="loading"
          class="flex justify-center py-14"
        >
          <span class="loading loading-spinner loading-md" />
        </div>

        <p
          v-else-if="loadError"
          class="text-error text-sm"
        >
          {{ loadError }}
        </p>

        <template v-else-if="profile">
          <RoutingRulesCard
            :profile="profile"
            :policy-groups="policyGroups"
            :patch-profile="patchProfile"
          />
          <PolicyGroupsCard
            :policy-groups="policyGroups"
            :loading="groupsLoading"
            :error="groupsError"
            @retry="loadPolicyGroups"
          />
          <DnsSettingsCard
            :profile="profile"
            :patch-profile="patchProfile"
          />
          <Ipv6Card
            :profile="profile"
            :patch-profile="patchProfile"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxDeployResult, OpenboxDeployState, OpenboxPolicyGroup, OpenboxProfile } from '@/api/openbox'
import {
  deployNow,
  extractPolicyGroups,
  fetchConfigPreview,
  fetchDeployState,
  fetchProfile,
  saveProfile,
} from '@/api/openbox'
import DnsSettingsCard from '@/components/routing/DnsSettingsCard.vue'
import Ipv6Card from '@/components/routing/Ipv6Card.vue'
import PolicyGroupsCard from '@/components/routing/PolicyGroupsCard.vue'
import RoutingDeployBanner from '@/components/routing/RoutingDeployBanner.vue'
import RoutingRulesCard from '@/components/routing/RoutingRulesCard.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { routingPendingDeploy } from '@/store/routing'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})

const profile = ref<OpenboxProfile | null>(null)
const loading = ref(true)
const loadError = ref('')

const policyGroups = ref<OpenboxPolicyGroup[]>([])
const groupsLoading = ref(false)
const groupsError = ref('')

const deployState = ref<OpenboxDeployState>({ stage: 'idle', message: '', at: 0, badTags: [] })
const deploying = ref(false)
const lastDeployResult = ref<OpenboxDeployResult | null>(null)

// Not deployed yet (or the last attempt didn't end up 'running') always counts as "changes
// pending" regardless of the local flag; on top of that, any save made through this page since
// the last successful deploy also counts — see store/routing.ts for why that second half has to
// be tracked client-side.
const hasUndeployedChanges = computed(() => deployState.value.stage !== 'running' || routingPendingDeploy.value)

const loadPolicyGroups = async () => {
  groupsLoading.value = true
  groupsError.value = ''
  try {
    const config = await fetchConfigPreview()
    policyGroups.value = extractPolicyGroups(config, profile.value?.routing.proxyTag || 'PROXY')
  } catch (error) {
    groupsError.value = t('routingPolicyGroupsLoadFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    groupsLoading.value = false
  }
}

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const [fetchedProfile, fetchedDeployState] = await Promise.all([fetchProfile(), fetchDeployState()])
    profile.value = fetchedProfile
    deployState.value = fetchedDeployState
    await loadPolicyGroups()
  } catch (error) {
    loadError.value = t('routingLoadFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    loading.value = false
  }
}

onMounted(load)

// Single choke point every card's edits go through: on success it updates the shared profile
// (so every card re-renders from the new server truth) and marks changes pending; on failure it
// rethrows so the calling card can show its own contextual error message.
const patchProfile = async (patch: Record<string, unknown>): Promise<OpenboxProfile> => {
  const updated = await saveProfile(patch)
  profile.value = updated
  routingPendingDeploy.value = true
  return updated
}

const handleDeploy = async () => {
  if (deploying.value) return

  deploying.value = true
  try {
    const result = await deployNow()
    lastDeployResult.value = result
    if (result.ok) {
      routingPendingDeploy.value = false
    }
    deployState.value = await fetchDeployState().catch(() => deployState.value)
  } catch (error) {
    lastDeployResult.value = {
      ok: false,
      stage: 'error',
      message: error instanceof Error ? error.message : String(error),
      badTags: [],
    }
  } finally {
    deploying.value = false
  }
}
</script>
