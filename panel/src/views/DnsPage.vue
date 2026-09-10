<template>
  <div
    class="flex h-full min-h-0 flex-col overflow-y-auto"
    :style="padding"
  >
    <div class="flex flex-col gap-2 p-2">
      <div class="card bg-base-100 border-base-300/60 border p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-lg font-semibold">{{ $t('dnsSettingsTab') }}</h1>
            <p class="text-base-content/60 mt-1 text-xs">{{ $t('dfApplyHint') }}</p>
          </div>
          <button
            class="btn btn-primary btn-sm"
            :disabled="busy"
            @click="apply(false)"
          >
            <span
              v-if="busy"
              class="loading loading-spinner loading-xs"
            />{{ $t('dfApply') }}
          </button>
        </div>
      </div>
      <template v-if="profile && status">
        <DnsModeCard
          :profile="profile"
          :patch-profile="patchProfile"
        />
        <DnsRewriteCard
          :profile="profile"
          :patch-profile="patchProfile"
        />
        <DnsFilterCard
          :status="status"
          :busy="busy"
          @saved="load"
          @update="apply(true)"
        />
        <DnsFilterRecords
          :connected="status.connected"
          :enabled="status.applied?.enabled === true"
        />
      </template>
      <span
        v-else
        class="loading loading-spinner mx-auto my-8"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  applyDnsFilter,
  fetchDnsFilter,
  fetchProfile,
  saveProfile,
  type DnsFilterStatus,
  type OpenboxProfile,
} from '@/api/openbox'
import DnsFilterCard from '@/components/dns/DnsFilterCard.vue'
import DnsFilterRecords from '@/components/dns/DnsFilterRecords.vue'
import DnsModeCard from '@/components/kernel/DnsModeCard.vue'
import DnsRewriteCard from '@/components/kernel/DnsRewriteCard.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { showNotification } from '@/helper/notification'
import { onMounted, onUnmounted, ref } from 'vue'
const { padding } = usePaddingForViews({ offsetTop: 0, offsetBottom: 0 })
const profile = ref<OpenboxProfile | null>(null)
const status = ref<DnsFilterStatus | null>(null)
const busy = ref(false)
const load = async () => {
  try {
    ;[profile.value, status.value] = await Promise.all([fetchProfile(), fetchDnsFilter()])
  } catch (error) {
    showNotification({
      content: 'routeTestRequestFailed',
      params: { message: error instanceof Error ? error.message : String(error) },
      key: 'dns-settings-load',
      type: 'alert-error',
    })
  }
}
const patchProfile = async (patch: Record<string, unknown>) => {
  profile.value = await saveProfile(patch)
  return profile.value
}
const apply = async (update: boolean) => {
  busy.value = true
  showNotification({
    content: update ? 'dfUpdating' : 'dfApplying',
    key: 'dns-settings-apply',
    type: 'alert-info',
    timeout: 0,
  })
  try {
    await applyDnsFilter(update)
    await load()
    showNotification({ content: 'dfApplied', key: 'dns-settings-apply', type: 'alert-success' })
  } catch (error) {
    showNotification({
      content: 'routeTestRequestFailed',
      params: { message: error instanceof Error ? error.message : String(error) },
      key: 'dns-settings-apply',
      type: 'alert-error',
    })
  } finally {
    busy.value = false
  }
}
let timer: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  timer = setInterval(() => {
    if (!busy.value && !document.hidden)
      fetchDnsFilter()
        .then((s) => {
          status.value = s
        })
        .catch(() => {})
  }, 10000)
})
onUnmounted(() => clearInterval(timer))
</script>
