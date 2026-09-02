<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-4 p-4">
      <h2 class="text-base font-semibold">{{ $t('dnsSettingsTitle') }}</h2>

      <div class="flex items-center justify-between gap-2">
        <div>
          <h3 class="text-sm font-semibold">{{ $t('dnsSplitTitle') }}</h3>
          <p class="text-base-content/60 text-xs">{{ $t('dnsSplitDescription') }}</p>
        </div>
        <input
          type="checkbox"
          class="toggle shrink-0"
          :checked="profile.dns.split"
          @change="onSplitToggle"
        />
      </div>

      <!-- 直连侧不再让用户填服务器:改成交回系统/路由器自己解析(hijack 模式用内核的
           local 类型,dnsmasq 模式用 WAN 下发的上游)。留着输入框只会让人以为直连域名
           还归 Open-Box 管。 -->
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">{{ $t('dnsDirectLabel') }}</label>
        <p class="text-base-content/60 text-xs">{{ $t('dnsDirectSystemNote') }}</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">{{ $t('dnsProxyLabel') }}</label>
        <input
          type="text"
          class="input input-sm w-full max-w-xs font-mono"
          :class="!profile.dns.split && 'opacity-60'"
          :value="profile.dns.proxy"
          @change="onProxyChange"
        />
        <p class="text-base-content/50 text-xs">{{ $t('dnsProxyHint') }}</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">{{ $t('dnsModeLabel') }}</label>
        <select
          class="select select-sm w-full max-w-xs"
          :value="profile.dns.mode"
          @change="onModeChange"
        >
          <option value="hijack">{{ $t('dnsModeHijack') }}</option>
          <option value="dnsmasq">{{ $t('dnsModeDnsmasq') }}</option>
        </select>
        <p class="text-base-content/60 text-xs">
          {{ profile.dns.mode === 'dnsmasq' ? $t('dnsModeDnsmasqDescription') : $t('dnsModeHijackDescription') }}
        </p>
      </div>

      <p
        v-if="error"
        class="text-error text-xs"
      >
        {{ error }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxProfile } from '@/api/openbox'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const { t } = useI18n()

const error = ref('')

const save = async (patch: Record<string, unknown>) => {
  error.value = ''
  try {
    await props.patchProfile(patch)
  } catch (err) {
    error.value = t('routingSaveFailed', { message: err instanceof Error ? err.message : String(err) })
  }
}

const onSplitToggle = (event: Event) => save({ dns: { split: (event.target as HTMLInputElement).checked } })
const onModeChange = (event: Event) => save({ dns: { mode: (event.target as HTMLSelectElement).value } })

// Blanking the field silently and doing nothing would leave the input showing "" while the
// bound :value prop hasn't actually changed (no re-render to correct it) — reset it to the
// last-known-good value directly instead of just no-op'ing.
const onProxyChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  const value = input.value.trim()
  if (!value) {
    input.value = props.profile.dns.proxy || ''
    return
  }
  save({ dns: { proxy: value } })
}
</script>
