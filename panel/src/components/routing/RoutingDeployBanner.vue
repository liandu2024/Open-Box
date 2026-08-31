<template>
  <div
    v-if="visible"
    class="sticky top-0 z-10"
  >
    <div
      class="alert flex items-center justify-between gap-3 rounded-none py-2 text-sm"
      :class="alertClass"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <div class="flex items-center gap-2">
          <component
            :is="icon"
            class="h-4 w-4 shrink-0"
          />
          <span class="font-medium">{{ headline }}</span>
        </div>
        <span
          v-if="detail"
          class="text-xs break-words opacity-80"
        >
          {{ $t('deployDetailLabel') }}: {{ detail }}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="btn btn-sm"
          :class="deploying ? '' : 'btn-primary'"
          :disabled="deploying"
          @click="$emit('deploy')"
        >
          <span
            v-if="deploying"
            class="loading loading-spinner loading-xs"
          />
          {{ deploying ? $t('deployInProgress') : $t('routingDeployNow') }}
        </button>
        <button
          v-if="lastResult"
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          :aria-label="$t('cancel')"
          @click="$emit('dismiss')"
        >
          <XMarkIcon class="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxDeployResult } from '@/api/openbox'
import { CheckCircleIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  hasUndeployedChanges: boolean
  deploying: boolean
  lastResult: OpenboxDeployResult | null
}>()

defineEmits<{
  deploy: []
  dismiss: []
}>()

const { t } = useI18n()

// Stays visible through a successful deploy (so the confirmation is actually seen) until either
// the user dismisses it or another save makes hasUndeployedChanges true again.
const visible = computed(() => props.hasUndeployedChanges || props.lastResult !== null)

const icon = computed(() => (props.lastResult?.ok ? CheckCircleIcon : ExclamationTriangleIcon))

const alertClass = computed(() => {
  if (props.lastResult?.ok) return 'alert-success'
  if (props.lastResult && !props.lastResult.ok) return 'alert-error'
  return 'alert-warning'
})

// Same per-stage framing as KernelDeployStateCard.vue's deploy result — name the conflicting
// service, list which nodes failed validation, or say plainly that it fell back to a direct
// connection. Deliberately shares those deploy-* keys instead of duplicating the copy: the
// concept (and the honest wording it requires) is identical on both pages.
//
// validate can fail with an *empty* badTags array — e.g. the whole config is rejected for a
// reason that isn't any single node's fault (or, as observed while manually verifying this on a
// Mac with no sing-box binary installed, the checker itself couldn't even run). Falling back to
// "Some nodes didn't pass validation: —" in that case would name a cause that isn't real, so it
// gets its own generic copy instead, with the server's raw message shown as detail.
const headline = computed(() => {
  const result = props.lastResult
  if (!result) return t('routingUndeployedBanner')
  if (result.ok) return t('deploySuccess')

  switch (result.stage) {
    case 'conflict':
      return t('deployConflict')
    case 'validate':
      return result.badTags.length
        ? t('deployValidateFailed', { tags: result.badTags.join(', ') })
        : t('routingDeployValidateFailedGeneric')
    default:
      return t('deployFallback')
  }
})

// Conflict's message already names the plugin(s) to stop (server/system/deploy.mjs); when
// validate has badTags they're already spelled out in the headline above. Otherwise (including
// the empty-badTags validate case) show whatever raw message the server gave, if any.
const detail = computed(() => {
  const result = props.lastResult
  if (!result || result.ok) return ''
  if (result.stage === 'validate' && result.badTags.length > 0) return ''
  return result.message
})
</script>
