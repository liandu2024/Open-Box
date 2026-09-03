<template>
  <!-- DNS 劫持方式。改动写进档案,重启内核后生效(接管 / 还原 dnsmasq 都在部署流水线里做)。 -->
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4 text-sm">
      <div class="flex items-center justify-between gap-2">
        <div>
          <h2 class="text-base font-semibold">{{ $t('dnsModeTitle') }}</h2>
          <p class="text-base-content/60 text-xs">{{ $t('dnsModeDescription') }}</p>
        </div>
        <select
          class="select select-sm shrink-0"
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
const saving = ref(false)
const mode = computed<OpenboxDnsMode>(() => props.profile.dns?.mode ?? 'dnsmasq')

const onChange = async (event: Event) => {
  const next = (event.target as HTMLSelectElement).value as OpenboxDnsMode
  if (next === mode.value) return
  saving.value = true
  try {
    await props.patchProfile({ dns: { mode: next } })
    showNotification({ content: 'dnsModeSaved', type: 'alert-success' })
  } catch (err) {
    showNotification({ content: 'routingSaveFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  } finally {
    saving.value = false
  }
}
</script>
