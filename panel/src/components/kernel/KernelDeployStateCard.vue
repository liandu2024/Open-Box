<template>
  <div class="card">
    <div class="app-card-padding flex flex-col gap-2 text-sm">
      <h2 class="text-base font-semibold">{{ $t('kernelDeployStateTitle') }}</h2>

      <div class="flex items-center gap-2">
        <component
          :is="icon"
          class="h-4 w-4 shrink-0"
          :class="iconClass"
        />
        <span :class="iconClass">{{ headline }}</span>
      </div>

      <p
        v-if="detail"
        class="text-base-content/60 text-xs break-words"
      >
        {{ $t('deployDetailLabel') }}: {{ detail }}
      </p>
      <p
        v-if="state.at"
        class="text-base-content/50 text-xs"
      >
        {{ $t('kernelDeployStateAt', { time: formattedTime }) }}
      </p>

      <RouterLink
        :to="{ name: ROUTE_NAME.settings, query: { tab: SETTINGS_TAB.routing } }"
        class="link link-hover text-xs"
      >
        {{ $t('kernelDeployStateGoToRouting') }}
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxDeployState } from '@/api/openbox'
import { ROUTE_NAME, SETTINGS_TAB } from '@/constant'
import { CheckCircleIcon, ClockIcon, ExclamationTriangleIcon } from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const props = defineProps<{
  state: OpenboxDeployState
}>()

const { t } = useI18n()

// Same per-stage framing as RoutingDeployBanner (name the conflicting service, list bad nodes,
// or say plainly it fell back to direct) — reusing those deploy-* keys rather than duplicating
// the copy, plus one addition ('idle') that page never needs to render: this page can be the
// very first place a fresh install's deploy state is ever shown.
const headline = computed(() => {
  const stage = props.state.stage
  if (stage === 'idle') return t('kernelDeployStateIdle')
  if (stage === 'running') return t('deploySuccess')
  if (stage === 'conflict') return t('deployConflict')
  if (stage === 'validate') {
    return props.state.badTags.length
      ? t('deployValidateFailed', { tags: props.state.badTags.join(', ') })
      : t('routingDeployValidateFailedGeneric')
  }
  return t('deployFallback')
})

const detail = computed(() => {
  const stage = props.state.stage
  if (stage === 'idle' || stage === 'running') return ''
  if (stage === 'validate' && props.state.badTags.length > 0) return ''
  return props.state.message
})

const icon = computed(() => {
  if (props.state.stage === 'idle') return ClockIcon
  if (props.state.stage === 'running') return CheckCircleIcon
  return ExclamationTriangleIcon
})

const iconClass = computed(() => {
  if (props.state.stage === 'idle') return 'text-base-content/50'
  if (props.state.stage === 'running') return 'text-success'
  return 'text-warning'
})

const formattedTime = computed(() => {
  if (!props.state.at) return ''
  try {
    return new Date(props.state.at).toLocaleString()
  } catch {
    return ''
  }
})
</script>
