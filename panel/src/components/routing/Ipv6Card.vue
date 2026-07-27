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

      <p
        v-if="!profile.ipv6"
        class="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-xs"
      >
        {{ $t('ipv6OffWarning') }}
      </p>
      <p
        v-else
        class="text-base-content/50 text-xs"
      >
        {{ $t('ipv6OnNote') }}
      </p>

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

const onToggle = async (event: Event) => {
  error.value = ''
  try {
    await props.patchProfile({ ipv6: (event.target as HTMLInputElement).checked })
  } catch (err) {
    error.value = t('routingSaveFailed', { message: err instanceof Error ? err.message : String(err) })
  }
}
</script>
