<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      :style="padding"
    >
      <div class="flex flex-col gap-3 p-3">
        <h1 class="text-lg font-semibold">{{ $t('kernel') }}</h1>

        <!-- Always rendered, independent of the status/version fetch below: the panic button
             has to work (and be visible) even if the status card itself failed to load. -->
        <EmergencyRollbackCard @refresh="loadStatus" />

        <p
          v-if="loadError"
          class="text-error text-sm"
        >
          {{ loadError }}
        </p>

        <div
          v-if="loading && !status"
          class="flex justify-center py-14"
        >
          <span class="loading loading-spinner loading-md" />
        </div>

        <template v-else>
          <KernelServiceCard
            :status="status"
            :kernel-version="kernelVersion"
            @refresh="loadStatus"
          />
          <KernelDeployStateCard
            v-if="deployState"
            :state="deployState"
          />
        </template>

        <PenetrationQueryCard />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxDeployState, OpenboxKernelVersion, OpenboxServiceStatus } from '@/api/openbox'
import { fetchDeployState, fetchKernelVersion, fetchServiceStatus } from '@/api/openbox'
import EmergencyRollbackCard from '@/components/kernel/EmergencyRollbackCard.vue'
import KernelDeployStateCard from '@/components/kernel/KernelDeployStateCard.vue'
import KernelServiceCard from '@/components/kernel/KernelServiceCard.vue'
import PenetrationQueryCard from '@/components/penetration/PenetrationQueryCard.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})

const status = ref<OpenboxServiceStatus | null>(null)
const kernelVersion = ref<OpenboxKernelVersion | null>(null)
const deployState = ref<OpenboxDeployState | null>(null)
const loading = ref(true)
const loadError = ref('')

// Shared by the initial page load and every child card's post-action @refresh (service
// start/stop/restart/enable/disable, emergency rollback) — none of those change the deploy
// state, only service/core status and the kernel version, so this deliberately doesn't touch
// deployState.
const loadStatus = async () => {
  loadError.value = ''
  try {
    const [fetchedStatus, fetchedVersion] = await Promise.all([fetchServiceStatus(), fetchKernelVersion()])
    status.value = fetchedStatus
    kernelVersion.value = fetchedVersion
  } catch (error) {
    loadError.value = t('kernelLoadFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

// Read-only display; failing silently here is fine — the deploy-state card just won't render,
// and nothing else on this page depends on it (deploy/redeploy itself lives on the Routing page).
const loadDeployState = async () => {
  try {
    deployState.value = await fetchDeployState()
  } catch (error) {
    console.warn('KernelPage: failed to load deploy state', error)
  }
}

const load = async () => {
  loading.value = true
  await Promise.all([loadStatus(), loadDeployState()])
  loading.value = false
}

onMounted(load)
</script>
