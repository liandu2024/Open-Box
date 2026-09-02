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
        <!-- 两个页签:出站是"策略能选到哪些目标",分流是"什么流量走哪条策略"。
             分成两层是因为它们的改动频率完全不同——出站基本设一次,分流常改。 -->
        <div
          role="tablist"
          class="tabs-box tabs tabs-sm w-fit"
        >
          <a
            role="tab"
            :class="['tab', pageTab === 'rules' && 'tab-active']"
            @click="pageTab = 'rules'"
          >
            {{ $t('routing') }}
          </a>
          <a
            role="tab"
            :class="['tab', pageTab === 'outbounds' && 'tab-active']"
            @click="pageTab = 'outbounds'"
          >
            {{ $t('routingOutboundsTab') }}
          </a>
        </div>

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
          <template v-if="pageTab === 'rules'">
            <RoutingRegionCard
              :profile="profile"
              :patch-profile="patchProfile"
            />
            <RoutingPoliciesCard
              :profile="profile"
              :group-names="groupNames"
              :patch-profile="patchProfile"
            />
          </template>
          <template v-else>
            <RoutingOutboundsCard
              :profile="profile"
              :group-names="groupNames"
              :patch-profile="patchProfile"
            />
          </template>
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
import type { OpenboxDeployResult, OpenboxDeployState, OpenboxProfile } from '@/api/openbox'
import {
  deployNow,
  fetchDeployState,
  fetchNodeGroups,
  fetchProfile,
  saveProfile,
} from '@/api/openbox'
import DnsSettingsCard from '@/components/routing/DnsSettingsCard.vue'
import Ipv6Card from '@/components/routing/Ipv6Card.vue'
import RoutingDeployBanner from '@/components/routing/RoutingDeployBanner.vue'
import RoutingOutboundsCard from '@/components/routing/RoutingOutboundsCard.vue'
import RoutingPoliciesCard from '@/components/routing/RoutingPoliciesCard.vue'
import RoutingRegionCard from '@/components/routing/RoutingRegionCard.vue'
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

const pageTab = ref<'rules' | 'outbounds'>('rules')

// 「节点组」页里建的组名。策略的可选出站与「出站」页签的预览都用它。
const groupNames = ref<string[]>([])
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

// 策略能选的节点组直接问「节点组」接口:那是权威来源。原来是从配置预览的 outbounds
// 里反推,策略自己生成的 selector 混进去之后就不准了(策略会把自己也列成可选项)。
const loadPolicyGroups = async () => {
  groupsLoading.value = true
  groupsError.value = ''
  try {
    const payload = await fetchNodeGroups()
    groupNames.value = payload.groups.map((g) => g.name)
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
