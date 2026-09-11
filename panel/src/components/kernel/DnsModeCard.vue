<template>
  <!-- DNS 劫持方式。改动写进档案,重启内核后生效(接管 / 还原 dnsmasq 都在部署流水线里做)。 -->
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4 text-sm">
      <div class="flex items-center justify-between gap-2">
        <div>
          <h2 class="text-base font-semibold">{{ $t('dnsModeTitle') }}({{ $t('dnsModePort', { port: KERNEL_DNS_PORT }) }})</h2>
          <p class="text-base-content/60 text-xs">{{ $t('dnsModeDescription') }}</p>
        </div>
        <select
          class="select select-sm w-40 shrink-0"
          :value="mode"
          :disabled="saving"
          @change="onChange"
        >
          <option value="dnsmasq">{{ $t('dnsModeDnsmasq') }}</option>
          <option value="hijack">{{ $t('dnsModeHijack') }}</option>
          <option value="off">{{ $t('dnsModeOff') }}</option>
        </select>
      </div>
      <p class="text-base-content/50 text-xs">{{ $t(NOTE_KEY[mode]) }}</p>
      <!-- 内核 DNS 入站三种模式都开:局域网里的 AdGuard Home / Pi-hole 把上游指到这里就能用分流解析 -->
      <p class="text-base-content/50 text-xs">{{ $t('dnsModeUpstreamHint', { addr: kernelDnsAddr }) }}</p>
      <!-- FakeIP 原型:走代理的域名不在本地解析,内核发占位地址,连接时把域名交给选中的节点 -->
      <label
        v-if="mode !== 'off'"
        class="border-base-300/60 flex cursor-pointer items-start gap-3 border-t pt-3"
      >
        <input
          type="checkbox"
          class="toggle toggle-sm mt-0.5"
          :checked="fakeIp"
          :disabled="saving"
          @change="onFakeIp"
        >
        <span class="flex flex-col gap-1">
          <span>{{ $t('dnsFakeIpTitle') }}</span>
          <span class="text-base-content/50 text-xs">{{ $t('dnsFakeIpNote') }}</span>
        </span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxDnsMode, OpenboxProfile } from '@/api/openbox'
import { showNotification } from '@/helper/notification'
import { computed, ref } from 'vue'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const NOTE_KEY: Record<OpenboxDnsMode, string> = {
  dnsmasq: 'dnsModeDnsmasqNote',
  hijack: 'dnsModeHijackNote',
  off: 'dnsModeOffNote',
}
// 劫持方式和 FakeIP 都要重启内核才生效:保存后告诉页面挂出「立即重启内核」
const emit = defineEmits<{ needsRestart: [] }>()
const saving = ref(false)
const mode = computed<OpenboxDnsMode>(() => props.profile.dns?.mode ?? 'dnsmasq')
const fakeIp = computed(() => props.profile.dns?.fakeIpForProxy === true)
// 面板就在路由器上,当前打开面板的主机名就是路由器地址
const KERNEL_DNS_PORT = 7853
const kernelDnsAddr = `${location.hostname}:${KERNEL_DNS_PORT}`

const onFakeIp = async (event: Event) => {
  const next = (event.target as HTMLInputElement).checked
  saving.value = true
  try {
    await props.patchProfile({ dns: { fakeIpForProxy: next } })
    showNotification({ content: 'dnsModeSaved', type: 'alert-success' })
    emit('needsRestart')
  } catch (err) {
    showNotification({ content: 'routingSaveFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  } finally {
    saving.value = false
  }
}

const onChange = async (event: Event) => {
  const next = (event.target as HTMLSelectElement).value as OpenboxDnsMode
  if (next === mode.value) return
  saving.value = true
  try {
    await props.patchProfile({ dns: { mode: next } })
    showNotification({ content: 'dnsModeSaved', type: 'alert-success' })
    emit('needsRestart')
  } catch (err) {
    showNotification({ content: 'routingSaveFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  } finally {
    saving.value = false
  }
}
</script>
