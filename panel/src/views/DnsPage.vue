<template>
  <div
    class="flex h-full min-h-0 flex-col overflow-y-auto"
    :style="padding"
  >
    <div class="flex flex-col gap-2 p-2">
      <!-- 没有总的「应用」按钮:每张卡保存后能生效的直接生效;要重启内核的,卡片自己提示,并在这里挂出一条
           「立即重启内核」,重启完就收起。域名过滤的待重启状态由服务端判(status.pending),劫持方式 / FakeIP /
           重写源域名的由卡片保存时报上来 -->
      <div
        v-if="restartPending || status?.pending"
        role="alert"
        class="alert alert-warning alert-soft flex flex-wrap items-center justify-between gap-3 py-2"
      >
        <span class="text-sm">{{ $t('dfApplyHint') }}</span>
        <button
          class="btn btn-warning btn-sm"
          :disabled="busy"
          @click="apply(false)"
        >
          <span
            v-if="busy"
            class="loading loading-spinner loading-xs"
          />{{ $t('dfApply') }}
        </button>
      </div>
      <template v-if="profile && status">
        <DnsModeCard
          :profile="profile"
          :patch-profile="patchProfile"
          @needs-restart="restartPending = true"
        />
        <DnsRewriteCard
          :profile="profile"
          :patch-profile="patchProfile"
          @needs-restart="restartPending = true"
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
// 这次打开页面以来有没有保存过要重启才生效的改动(劫持方式 / FakeIP / 重写源域名)。刷新页面就丢,
// 但卡片保存时的提示已经说过要重启;域名过滤那份由服务端记着
const restartPending = ref(false)
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
    restartPending.value = false
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
