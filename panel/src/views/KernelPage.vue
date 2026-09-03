<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      :style="padding"
    >
      <div class="flex flex-col gap-2 p-2">
        <div
          v-if="loading && !status"
          class="flex justify-center py-14"
        >
          <span class="loading loading-spinner loading-md" />
        </div>

        <KernelServiceCard
          v-else
          :status="status"
          :kernel-version="kernelVersion"
          @refresh="loadStatus"
        />

        <!-- Open-Box 自身更新 / Geo 规则集更新(各带自动更新计划) -->
        <template v-if="profile">
          <OpenboxUpdateCard
            :profile="profile"
            :patch-profile="patchProfile"
          />
          <GeoUpdateCard
            :profile="profile"
            :patch-profile="patchProfile"
          />
        </template>

        <!-- 内核参数:测速地址、IPv6。改动写进档案,重启内核后生效。 -->
        <template v-if="profile">
          <TestUrlCard
            :profile="profile"
            :patch-profile="patchProfile"
          />
          <Ipv6Card
            :profile="profile"
            :patch-profile="patchProfile"
          />
          <NodeDirectCard
            :profile="profile"
            :patch-profile="patchProfile"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxKernelVersion, OpenboxProfile, OpenboxServiceStatus } from '@/api/openbox'
import { fetchKernelVersion, fetchProfile, fetchServiceStatus, saveProfile } from '@/api/openbox'
import GeoUpdateCard from '@/components/kernel/GeoUpdateCard.vue'
import KernelServiceCard from '@/components/kernel/KernelServiceCard.vue'
import NodeDirectCard from '@/components/kernel/NodeDirectCard.vue'
import OpenboxUpdateCard from '@/components/kernel/OpenboxUpdateCard.vue'
import Ipv6Card from '@/components/routing/Ipv6Card.vue'
import TestUrlCard from '@/components/routing/TestUrlCard.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { showNotification } from '@/helper/notification'
import { onMounted, ref } from 'vue'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})

const status = ref<OpenboxServiceStatus | null>(null)
const kernelVersion = ref<OpenboxKernelVersion | null>(null)
const profile = ref<OpenboxProfile | null>(null)
const loading = ref(true)

// 首次加载和每个动作(启动/停止/重启/自启开关)之后的刷新都走这里
const loadStatus = async () => {
  try {
    const [fetchedStatus, fetchedVersion] = await Promise.all([fetchServiceStatus(), fetchKernelVersion()])
    status.value = fetchedStatus
    kernelVersion.value = fetchedVersion
  } catch (error) {
    showNotification({
      content: 'kernelLoadFailed',
      params: { message: error instanceof Error ? error.message : String(error) },
      type: 'alert-error',
    })
  }
}

const loadProfile = async () => {
  try {
    profile.value = await fetchProfile()
  } catch (error) {
    showNotification({
      content: 'routingLoadFailed',
      params: { message: error instanceof Error ? error.message : String(error) },
      type: 'alert-error',
    })
  }
}

// 两张参数卡片的改动都经这里写档案,成功后用服务端返回的新档案刷新
const patchProfile = async (patch: Record<string, unknown>): Promise<OpenboxProfile> => {
  const updated = await saveProfile(patch)
  profile.value = updated
  return updated
}

onMounted(async () => {
  loading.value = true
  await Promise.all([loadStatus(), loadProfile()])
  loading.value = false
})
</script>
