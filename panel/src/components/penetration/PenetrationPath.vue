<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <div :class="nodeClasses('quiet')">
        <DevicePhoneMobileIcon class="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
        <span class="truncate">{{ target }}</span>
      </div>

      <ArrowRightIcon class="text-base-content/25 mx-auto h-4 w-4 shrink-0 rotate-90 sm:mx-1 sm:rotate-0" />

      <div :class="nodeClasses('hero')">
        <CubeTransparentIcon class="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
        <span class="font-semibold">Open-Box</span>
      </div>

      <ArrowRightIcon class="text-base-content/25 mx-auto h-4 w-4 shrink-0 rotate-90 sm:mx-1 sm:rotate-0" />

      <div :class="nodeClasses(matched ? 'decided' : hasMatchError ? 'unknown' : 'ghost')">
        <component
          :is="hasMatchError ? QuestionMarkCircleIcon : SwatchIcon"
          class="h-4 w-4 shrink-0 sm:h-5 sm:w-5"
        />
        <span class="leading-tight">{{ ruleLabel }}</span>
      </div>
    </div>

    <div class="flex flex-col items-center gap-2 sm:pl-10">
      <ArrowDownIcon class="text-base-content/25 h-4 w-4 shrink-0" />

      <div
        v-if="hasMatchError"
        class="alert alert-warning max-w-xs py-2 text-xs"
      >
        <QuestionMarkCircleIcon class="h-4 w-4 shrink-0" />
        <span>{{ $t('penetrationMatchError', { message: matchError }) }}</span>
      </div>

      <div
        v-if="isBlocked"
        :class="nodeClasses('reject', true)"
        class="w-full max-w-xs"
      >
        <NoSymbolIcon class="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
        <span class="leading-tight">
          {{ $t('penetrationBlockedTitle') }}
          <template v-if="matched?.rule.rule_set">
            <br />
            <span class="opacity-70">{{ matched.rule.rule_set }}</span>
          </template>
        </span>
      </div>

      <template
        v-for="(hop, i) in chain"
        :key="`${hop}-${i}`"
      >
        <div
          :class="nodeClasses(hop === 'direct' ? 'direct' : 'proxy', true)"
          class="w-full max-w-xs"
        >
          <component
            :is="i === chain.length - 1 ? FlagIcon : hop === 'direct' ? HomeIcon : GlobeAltIcon"
            class="h-4 w-4 shrink-0 sm:h-5 sm:w-5"
          />
          <span class="leading-tight">
            {{ hopCaption(i) }}
            <br />
            <span class="font-medium opacity-90">{{ hop }}</span>
          </span>
        </div>
        <ArrowDownIcon
          v-if="i < chain.length - 1"
          class="text-base-content/25 h-4 w-4 shrink-0"
        />
      </template>

      <div
        v-if="chainError"
        class="alert alert-warning max-w-xs py-2 text-xs"
      >
        <ExclamationTriangleIcon class="h-4 w-4 shrink-0" />
        <span>{{ $t('penetrationChainError', { message: chainError }) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxPenetrationMatched } from '@/api/openbox'
import {
  ArrowDownIcon,
  ArrowRightIcon,
  CubeTransparentIcon,
  DevicePhoneMobileIcon,
  ExclamationTriangleIcon,
  FlagIcon,
  GlobeAltIcon,
  HomeIcon,
  NoSymbolIcon,
  QuestionMarkCircleIcon,
  SwatchIcon,
} from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

// Presentational only, same idiom as wizard/RoutePath.vue (device -> Open-Box -> decision, pill
// badges with icon + label, arrows between). Extended here for a linear chain of arbitrary
// length (rule match -> policy target -> however many clash_api `now` hops -> leaf) instead of
// RoutePath's fixed two-branch direct/proxy grid, since a penetration result resolves to exactly
// one path, not a menu of choices.
const props = defineProps<{
  target: string
  matched: OpenboxPenetrationMatched | null
  chain: string[]
  finalOutbound: string | null
  chainError?: string
  // Set when the server couldn't actually run the check for some rule (missing sing-box binary,
  // missing compiled .srs, or the check process crashing with no output) — see
  // api/openbox.ts's OpenboxPenetrationResult.matchError. `matched` is null in this state too,
  // but it means "couldn't determine", not "confirmed no rule matches" — must render distinctly
  // from penetrationNoRuleMatched (P4b final review, Important 1).
  matchError?: string
}>()

const { t } = useI18n()

const isBlocked = computed(() => props.matched?.action === 'reject')
const hasMatchError = computed(() => Boolean(props.matchError))

const ruleLabel = computed(() => {
  const matched = props.matched
  if (hasMatchError.value) return t('penetrationRuleUnknown')
  if (!matched) return t('penetrationNoRuleMatched')
  if (matched.rule.ip_is_private) return t('penetrationRulePrivateIp')
  return t('penetrationRuleMatched', { index: matched.index + 1, ruleset: matched.rule.rule_set || '—' })
})

// First hop is always the resolved policy target (buildRoute's outbound, or the fallback when
// nothing matched); the last hop (which may be the same one, for a one-hop chain) is wherever
// clash_api's `now` chain actually bottoms out — the real exit. Anything in between is just a
// step through a nested selector/urltest group.
const hopCaption = (i: number) => {
  if (props.chain.length === 1) return t('penetrationExitNode')
  if (i === 0) return t('penetrationPolicyTarget')
  if (i === props.chain.length - 1) return t('penetrationExitNode')
  return t('penetrationChainHop')
}

const BASE_NODE_CLASSES =
  'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium sm:text-sm'

const KIND_CLASSES = {
  quiet: 'border-base-300 bg-base-200/60 text-base-content/70',
  hero: 'border-primary/40 bg-primary text-primary-content shadow-sm',
  ghost: 'border-dashed border-base-content/20 bg-base-100 text-base-content/50',
  decided: 'border-primary/30 bg-primary/10 text-primary',
  direct: 'border-success/30 bg-success/10 text-success',
  proxy: 'border-info/30 bg-info/10 text-info',
  reject: 'border-error/30 bg-error/10 text-error',
  unknown: 'border-warning/30 bg-warning/10 text-warning',
} as const

const nodeClasses = (kind: keyof typeof KIND_CLASSES, stacked = false) =>
  [BASE_NODE_CLASSES, KIND_CLASSES[kind], stacked ? 'w-full flex-col justify-center text-center' : '']
    .filter(Boolean)
    .join(' ')
</script>
