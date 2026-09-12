<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      :style="padding"
    >
      <div class="flex flex-col gap-2 px-2 md:py-2">
        <KernelServiceCard
          :status="status"
          :kernel-version="kernelVersion"
          @refresh="loadStatus"
        />

        <!-- 内核参数:DNS 劫持、直连、IPv6、测速地址。改动写进档案,重启内核后生效。 -->
        <template v-if="profile">
          <NodeDirectCard
            :profile="profile"
            :patch-profile="patchProfile"
          />
          <Ipv6Card
            :profile="profile"
            :patch-profile="patchProfile"
          />
          <TestUrlCard
            :profile="profile"
            :patch-profile="patchProfile"
          />
          <TrafficRetentionCard
            :profile="profile"
            :patch-profile="patchProfile"
          />
          <!-- 导出 / 导入:导入后档案换了,重新拉一遍状态和档案 -->
          <BackupCard
            :profile="profile"
            @imported="onImported"
          />
          <!-- 导出诊断包:反馈问题用,和备份放一起 -->
          <DiagnosticsCard />
        </template>

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
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { refreshServiceStatus } from '@/composables/kernelService'
import type { OpenboxKernelVersion, OpenboxProfile, OpenboxServiceStatus } from '@/api/openbox'
import { fetchKernelVersion, fetchProfile, saveProfile } from '@/api/openbox'
import GeoUpdateCard from '@/components/kernel/GeoUpdateCard.vue'
import KernelServiceCard from '@/components/kernel/KernelServiceCard.vue'
import NodeDirectCard from '@/components/kernel/NodeDirectCard.vue'
import OpenboxUpdateCard from '@/components/kernel/OpenboxUpdateCard.vue'
import BackupCard from '@/components/kernel/BackupCard.vue'
import TrafficRetentionCard from '@/components/kernel/TrafficRetentionCard.vue'
import DiagnosticsCard from '@/components/kernel/DiagnosticsCard.vue'
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

// 首次加载和每个动作(启动/停止/重启/自启开关)之后的刷新都走这里
const loadStatus = async () => {
  // 服务状态和版本并行请求,但先把服务状态交给卡片;版本命令较慢时不再拖住整张卡片。
  const statusRequest = refreshServiceStatus().then((fetchedStatus) => {
    status.value = fetchedStatus ?? null
  })
  const versionRequest = fetchKernelVersion().then((fetchedVersion) => {
    kernelVersion.value = fetchedVersion
  })
  const results = await Promise.allSettled([statusRequest, versionRequest])
  const error = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason
  if (error) {
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

const onImported = () => Promise.all([loadStatus(), loadProfile()])

onMounted(async () => {
  await Promise.all([loadStatus(), loadProfile()])
})
</script>
