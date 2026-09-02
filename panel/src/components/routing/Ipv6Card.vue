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
