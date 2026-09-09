<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4">
      <div class="flex items-center justify-between gap-2">
        <div>
          <h2 class="text-base font-semibold">{{ $t('ipv6Title') }}</h2>
          <p class="text-base-content/60 text-xs">{{ $t('ipv6Description') }}</p>
        </div>
        <input
          type="checkbox"
          class="toggle shrink-0"
          :checked="profile.ipv6"
          @change="onToggle"
        />
      </div>

      <!-- 关闭是默认状态,不该用告警色渲染:两种状态都是普通说明 -->
      <p class="text-base-content/50 text-xs">
        {{ profile.ipv6 ? $t('ipv6OnNote') : $t('ipv6OffWarning') }}
      </p>
      <!-- IPv6 分层:开着时,走代理的目标交给节点还是降为 IPv4(直连的 v6 两种都照常) -->
      <div
        v-if="profile.ipv6"
        class="border-base-300/60 flex items-center justify-between gap-2 border-t pt-3"
      >
        <div>
          <p class="text-sm">{{ $t('ipv6ProxyTitle') }}</p>
          <p class="text-base-content/50 text-xs">{{ $t(proxyMode === 'ipv4' ? 'ipv6ProxyIpv4Note' : proxyMode === 'bypass' ? 'ipv6ProxyBypassNote' : 'ipv6ProxyNodeNote') }}</p>
        </div>
        <select
          class="select select-sm w-44 shrink-0"
          :value="proxyMode"
          @change="onProxyMode"
        >
          <option value="node">{{ $t('ipv6ProxyNode') }}</option>
          <option value="ipv4">{{ $t('ipv6ProxyIpv4') }}</option>
          <option value="bypass">{{ $t('ipv6ProxyBypass') }}</option>
        </select>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { showNotification } from '@/helper/notification'
import type { OpenboxProfile } from '@/api/openbox'
import { computed } from 'vue'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const proxyMode = computed(() => (props.profile.ipv6Proxy === 'ipv4' ? 'ipv4' : props.profile.ipv6Proxy === 'bypass' ? 'bypass' : 'node'))

const onProxyMode = async (event: Event) => {
  try {
    await props.patchProfile({ ipv6Proxy: (event.target as HTMLSelectElement).value })
  } catch (err) {
    showNotification({ content: 'routingSaveFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  }
}

const onToggle = async (event: Event) => {
  try {
    await props.patchProfile({ ipv6: (event.target as HTMLInputElement).checked })
  } catch (err) {
    showNotification({ content: 'routingSaveFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  }
}
</script>
