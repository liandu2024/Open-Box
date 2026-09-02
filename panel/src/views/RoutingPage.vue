<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
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

const pageTab = ref<'rules' | 'outbounds'>('rules')

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
