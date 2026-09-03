<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <div
        class="flex flex-col gap-2 px-2 md:py-2"
        :style="padding"
      >
        <!-- 分流设置 = 站点集列表(含系统兜底的「其他」):一条流量走哪,只由站点集的顺序 +
             它在代理页选中的线路决定。测速地址、IPv6 这些内核参数在「内核设置」页。 -->
        <div
          v-if="loading"
          class="flex justify-center py-14"
        >
          <span class="loading loading-spinner loading-md" />
        </div>

        <RoutingPoliciesCard
          v-else-if="profile"
          ref="policiesCard"
          :profile="profile"
          :patch-profile="patchProfile"
        />
      </div>
    </div>

    <!-- 「添加站点集」放顶部页签栏右上角,和订阅管理/节点管理的新增按钮同一个位置、同一种样式 -->
    <Teleport
      defer
      to="#settings-header-actions"
    >
      <button
        v-if="profile"
        type="button"
        class="btn btn-primary btn-sm btn-square"
        v-tip="$t('routingPolicyAdd')"
        :aria-label="$t('routingPolicyAdd')"
        @click="policiesCard?.openEditor(null)"
      >
        <PlusIcon class="h-4 w-4" />
      </button>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxProfile } from '@/api/openbox'
import { fetchProfile, saveProfile } from '@/api/openbox'
import RoutingPoliciesCard from '@/components/routing/RoutingPoliciesCard.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { showNotification } from '@/helper/notification'
import { PlusIcon } from '@heroicons/vue/24/outline'
import { onMounted, ref, useTemplateRef } from 'vue'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})

const profile = ref<OpenboxProfile | null>(null)
const loading = ref(true)
const policiesCard = useTemplateRef('policiesCard')

const load = async () => {
  loading.value = true
  try {
    profile.value = await fetchProfile()
  } catch (error) {
    showNotification({
      content: 'routingLoadFailed',
      params: { message: error instanceof Error ? error.message : String(error) },
      type: 'alert-error',
    })
  } finally {
    loading.value = false
  }
}

onMounted(load)

// 站点集卡片的所有改动都经这里写档案:成功后用服务端返回的新档案刷新,失败原样抛给卡片提示。
// 保存到这里就结束了——要生效去内核页重启内核,那里会用当前档案重新生成并应用配置。
const patchProfile = async (patch: Record<string, unknown>): Promise<OpenboxProfile> => {
  const updated = await saveProfile(patch)
  profile.value = updated
  return updated
}
</script>
