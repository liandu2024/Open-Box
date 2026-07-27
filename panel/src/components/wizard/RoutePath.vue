<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <div :class="nodeClasses('quiet')">
        <DevicePhoneMobileIcon class="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
        <span>{{ $t('wizardPathDevice') }}</span>
      </div>

      <ArrowRightIcon
        class="text-base-content/25 mx-auto h-4 w-4 shrink-0 rotate-90 sm:mx-1 sm:rotate-0"
      />

      <div :class="nodeClasses('hero')">
        <CubeTransparentIcon class="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
        <span class="font-semibold">Open-Box</span>
      </div>

      <ArrowRightIcon
        class="text-base-content/25 mx-auto h-4 w-4 shrink-0 rotate-90 sm:mx-1 sm:rotate-0"
      />

      <div :class="nodeClasses(hasRegion ? 'decided' : 'ghost')">
        <ArrowsRightLeftIcon class="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
        <span>{{ $t('wizardPathSplit') }}</span>
      </div>
    </div>

    <Transition name="route-grow">
      <div
        v-if="hasRegion"
        class="grid grid-cols-2 gap-2 sm:pl-10"
      >
        <div class="flex flex-col items-center gap-1">
          <ArrowDownIcon class="text-base-content/25 h-4 w-4 shrink-0" />
          <div :class="nodeClasses('direct', true)">
            <HomeIcon class="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            <span class="leading-tight">
              {{ $t('wizardPathDirectTitle') }}
              <template v-if="directLabel">
                <br />
                <span class="opacity-70">{{ directLabel }}</span>
              </template>
            </span>
          </div>
        </div>

        <div class="flex flex-col items-center gap-1">
          <ArrowDownIcon class="text-base-content/25 h-4 w-4 shrink-0" />
          <Transition
            name="route-grow"
            mode="out-in"
          >
            <div
              v-if="hasNodes"
              key="proxy-ready"
              :class="nodeClasses('proxy', true)"
            >
              <GlobeAltIcon class="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
              <span class="leading-tight">
                {{ $t('wizardPathProxyTitle') }}
                <template v-if="nodeLabel">
                  <br />
                  <span class="opacity-70">{{ nodeLabel }}</span>
                </template>
              </span>
            </div>
            <div
              v-else
              key="proxy-pending"
              :class="nodeClasses('ghost', true)"
            >
              <GlobeAltIcon class="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
              <span class="leading-tight">{{ $t('wizardPathProxyPendingTitle') }}</span>
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowsRightLeftIcon,
  CubeTransparentIcon,
  DevicePhoneMobileIcon,
  GlobeAltIcon,
  HomeIcon,
} from '@heroicons/vue/24/outline'

// Pure display, no fetching/business logic: everything it draws comes from these four props.
// `hasRegion`/`hasNodes` gate which parts of the path have "grown in" yet; `directLabel`/
// `nodeLabel` are pre-localized strings the caller composes (this component owns the
// structural copy — "Direct" / "Through your node" — the caller owns the dynamic bits: the
// region's display name, the subscription's node count).
withDefaults(
  defineProps<{
    hasRegion: boolean
    hasNodes: boolean
    directLabel?: string
    nodeLabel?: string
  }>(),
  {
    directLabel: '',
    nodeLabel: '',
  },
)

const BASE_NODE_CLASSES =
  'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium sm:text-sm'

const KIND_CLASSES = {
  quiet: 'border-base-300 bg-base-200/60 text-base-content/70',
  hero: 'border-primary/40 bg-primary text-primary-content shadow-sm',
  ghost: 'border-dashed border-base-content/20 bg-base-100 text-base-content/50',
  decided: 'border-primary/30 bg-primary/10 text-primary',
  direct: 'border-success/30 bg-success/10 text-success',
  proxy: 'border-info/30 bg-info/10 text-info',
} as const

const nodeClasses = (kind: keyof typeof KIND_CLASSES, stacked = false) =>
  [BASE_NODE_CLASSES, KIND_CLASSES[kind], stacked ? 'w-full flex-col justify-center text-center' : '']
    .filter(Boolean)
    .join(' ')
</script>

<style scoped>
.route-grow-enter-active,
.route-grow-leave-active {
  transition:
    opacity 0.35s ease,
    transform 0.35s ease;
}

.route-grow-enter-from,
.route-grow-leave-to {
  opacity: 0;
  transform: scale(0.94) translateY(-6px);
}

/* The signature move here is the diagram growing as steps complete — for anyone who has
   asked their system not to animate things, skip straight to the end state instead. */
@media (prefers-reduced-motion: reduce) {
  .route-grow-enter-active,
  .route-grow-leave-active {
    transition: none;
  }
}
</style>
