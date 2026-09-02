<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <div
        class="flex flex-col gap-3 p-3"
        :style="padding"
      >
        <!-- 站点集就是全部分流规则(含系统兜底的「其他」),所以没有单独的"分流"页签:
             一条流量走哪,只由站点集的顺序 + 它在代理页选中的线路决定。 -->
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
          <RoutingPoliciesCard
            v-if="pageTab === 'policies'"
            :profile="profile"
            :patch-profile="patchProfile"
          />
          <template v-else>
            <TestUrlCard
              :profile="profile"
              :patch-profile="patchProfile"
            />
            <Ipv6Card
              :profile="profile"
              :patch-profile="patchProfile"
            />
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxProfile } from '@/api/openbox'
import { fetchProfile, saveProfile } from '@/api/openbox'
import Ipv6Card from '@/components/routing/Ipv6Card.vue'
import TestUrlCard from '@/components/routing/TestUrlCard.vue'
import RoutingPoliciesCard from '@/components/routing/RoutingPoliciesCard.vue'
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

type PageTab = 'policies' | 'other'
const PAGE_TABS: { key: PageTab; labelKey: string }[] = [
  { key: 'policies', labelKey: 'routingPoliciesTab' },
  { key: 'other', labelKey: 'routingOtherTab' },
]
const pageTab = ref<PageTab>('policies')



const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    profile.value = await fetchProfile()
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
