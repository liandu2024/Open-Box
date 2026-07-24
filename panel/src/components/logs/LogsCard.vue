<template>
  <div class="card hover:bg-base-200 app-card-padding block break-all text-sm">
    <div class="app-inline-gap inline-flex items-center">
      <div :style="{ minWidth: `${(seqWithPadding.length + 1) * 0.62}em` }">
        {{ seqWithPadding }}.
      </div>
      <span class="badge badge-sm text-main min-w-14">
        {{ log.time }}
      </span>
      <span
        class="badge badge-sm min-w-17"
        :class="textColorMapForType[log.type as keyof typeof textColorMapForType]"
      >
        {{ log.type }}
      </span>
    </div>

    <span class="app-inline-offset-md leading-6 max-md:mt-2 max-md:block">{{ log.payload }}</span>
  </div>
</template>

<script setup lang="ts">
import { useBounceOnVisible } from '@/composables/bouncein'
import { LOG_LEVEL } from '@/constant'
import type { LogWithSeq } from '@/types'
import { computed } from 'vue'

const props = defineProps<{
  log: LogWithSeq
}>()

const seqWithPadding = computed(() => {
  return props.log.seq.toString().padStart(2, '0')
})

const textColorMapForType = {
  [LOG_LEVEL.Trace]: 'text-success',
  [LOG_LEVEL.Debug]: 'text-accent',
  [LOG_LEVEL.Info]: 'text-info',
  [LOG_LEVEL.Warning]: 'text-warning',
  [LOG_LEVEL.Error]: 'text-error',
  [LOG_LEVEL.Fatal]: 'text-error',
  [LOG_LEVEL.Panic]: 'text-error',
}

useBounceOnVisible()
</script>
