<template>
  <div class="flex flex-col gap-4">
    <div class="space-y-1">
      <h2 class="text-lg font-semibold">{{ $t('wizardFinishTitle') }}</h2>
      <p class="text-base-content/70 text-sm">{{ $t('wizardFinishDescription') }}</p>
    </div>

    <p
      v-if="!hasNodes"
      class="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-sm"
    >
      {{ $t('wizardFinishNoSubscriptionNote') }}
    </p>

    <div
      v-if="deployResult"
      class="flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm"
      :class="deployResult.ok ? 'border-success/30 bg-success/10' : 'border-warning/30 bg-warning/10'"
    >
      <span :class="deployResult.ok ? 'text-success' : 'text-warning'">
        {{ deployResultHeadline }}
      </span>
      <span
        v-if="deployResultDetail"
        class="text-base-content/60 text-xs"
      >
        {{ $t('wizardDeployDetailLabel') }}: {{ deployResultDetail }}
      </span>
    </div>

    <div class="flex flex-col gap-2 sm:flex-row">
      <button
        v-if="hasNodes"
        class="btn btn-outline btn-sm"
        :disabled="deploying"
        @click="handleDeploy"
      >
        {{ deploying ? $t('wizardDeploying') : $t('wizardDeployNow') }}
      </button>
      <button
        class="btn btn-primary btn-sm flex-1"
        @click="$emit('finish')"
      >
        {{ $t('wizardGetStarted') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { deployNow, type OpenboxDeployResult } from '@/api/openbox'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

defineProps<{
  hasNodes: boolean
}>()

defineEmits<{
  finish: []
}>()

const { t } = useI18n()

const deploying = ref(false)
const deployResult = ref<OpenboxDeployResult | null>(null)

const handleDeploy = async () => {
  if (deploying.value) return

  deploying.value = true
  deployResult.value = null

  try {
    deployResult.value = await deployNow()
  } catch (error) {
    deployResult.value = {
      ok: false,
      stage: 'error',
      message: error instanceof Error ? error.message : String(error),
      badTags: [],
    }
  } finally {
    deploying.value = false
  }
}

// Honest, per-stage framing: name the conflicting service, list which nodes failed
// validation, or say plainly that it fell back to a direct connection — never just "failed".
const deployResultHeadline = computed(() => {
  const result = deployResult.value
  if (!result) return ''

  if (result.ok) return t('wizardDeploySuccess')

  switch (result.stage) {
    case 'conflict':
      return t('wizardDeployConflict')
    case 'validate':
      return t('wizardDeployValidateFailed', { tags: result.badTags.join(', ') || '—' })
    default:
      return t('wizardDeployFallback')
  }
})

const deployResultDetail = computed(() => {
  const result = deployResult.value
  if (!result || result.ok || result.stage === 'validate') return ''
  return result.message
})
</script>
