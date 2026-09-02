<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <div
        class="flex flex-col gap-3 p-3"
        :style="padding"
      >
        <!-- 三个页签,按改动频率从高到低排:策略最常改,地区设一次,出站基本不动。 -->
        <div
          role="tablist"
          class="tabs-box tabs tabs-sm w-fit"
        >
          <a
            v-for="tab in PAGE_TABS"
            :key="tab.key"
            role="tab"
            :class="['tab', pageTab === tab.key && 'tab-active']"
            @click="pageTab = tab.key"
          >
            {{ $t(tab.labelKey) }}
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
          <RoutingRegionCard
            v-if="pageTab === 'rules'"
            :profile="profile"
            :patch-profile="patchProfile"
          />
          <RoutingPoliciesCard
            v-else-if="pageTab === 'policies'"
            :profile="profile"
            :patch-profile="patchProfile"
          />
          <RoutingOutboundsCard
            v-else-if="pageTab === 'outbounds'"
            :profile="profile"
            :group-names="groupNames"
            :patch-profile="patchProfile"
          />
          <Ipv6Card
            v-else
            :profile="profile"
            :patch-profile="patchProfile"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxProfile } from '@/api/openbox'
import { fetchNodeGroups, fetchProfile, saveProfile } from '@/api/openbox'
import Ipv6Card from '@/components/routing/Ipv6Card.vue'
import RoutingOutboundsCard from '@/components/routing/RoutingOutboundsCard.vue'
import RoutingPoliciesCard from '@/components/routing/RoutingPoliciesCard.vue'
import RoutingRegionCard from '@/components/routing/RoutingRegionCard.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})

const profile = ref<OpenboxProfile | null>(null)
const loading = ref(true)
const loadError = ref('')

type PageTab = 'rules' | 'policies' | 'outbounds' | 'other'
const PAGE_TABS: { key: PageTab; labelKey: string }[] = [
  { key: 'policies', labelKey: 'routingPoliciesTab' },
  { key: 'rules', labelKey: 'routing' },
  { key: 'outbounds', labelKey: 'routingOutboundsTab' },
  { key: 'other', labelKey: 'routingOtherTab' },
]
const pageTab = ref<PageTab>('policies')

// 「节点组」页里建的组名。策略的可选出站与「出站」页签的预览都用它。
const groupNames = ref<string[]>([])
const groupsLoading = ref(false)
const groupsError = ref('')

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
    profile.value = await fetchProfile()
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
// (so every card re-renders from the new server truth); on failure it rethrows so the calling
// card can show its own contextual error message.
// 保存到这里就结束了——没有"部署"这一步:要让设置生效,去内核页启动/重启内核,
// 那里会用当前档案重新生成并应用配置(见 server/api/service.mjs)。
const patchProfile = async (patch: Record<string, unknown>): Promise<OpenboxProfile> => {
  const updated = await saveProfile(patch)
  profile.value = updated
  return updated
}

</script>
