<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      :style="padding"
    >
      <div class="flex flex-col gap-3 p-3">
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
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxKernelVersion, OpenboxServiceStatus } from '@/api/openbox'
import { fetchKernelVersion, fetchServiceStatus } from '@/api/openbox'
import KernelServiceCard from '@/components/kernel/KernelServiceCard.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { showNotification } from '@/helper/notification'
import { onMounted, ref } from 'vue'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})

const status = ref<OpenboxServiceStatus | null>(null)
const kernelVersion = ref<OpenboxKernelVersion | null>(null)
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

onMounted(async () => {
  loading.value = true
  await loadStatus()
  loading.value = false
})
</script>
