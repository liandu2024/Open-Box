<template>
  <!-- ping(ICMP)怎么处理:直连(真实延迟)还是由内核代答。改动写进档案,重启内核后生效。 -->
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4">
      <div class="flex items-center justify-between gap-2">
        <div>
          <h2 class="text-base font-semibold">{{ $t('icmpTitle') }}</h2>
          <p class="text-base-content/60 text-xs">{{ $t('icmpDescription') }}</p>
        </div>
        <input
          type="checkbox"
          class="toggle shrink-0"
          :checked="profile.icmpDirect !== false"
          @change="onToggle"
        />
      </div>
      <p class="text-base-content/50 text-xs">
        {{ profile.icmpDirect !== false ? $t('icmpOnNote') : $t('icmpOffNote') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxProfile } from '@/api/openbox'
import { showNotification } from '@/helper/notification'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const onToggle = async (event: Event) => {
  try {
    await props.patchProfile({ icmpDirect: (event.target as HTMLInputElement).checked })
    showNotification({ content: 'routingPolicySaved', type: 'alert-success' })
  } catch (err) {
    showNotification({ content: 'routingSaveFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  }
}
</script>
