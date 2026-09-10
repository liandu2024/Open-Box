<template>
  <svg
    viewBox="0 0 240 44"
    class="h-12 w-full"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <path
      :d="`${line} L240,43 L0,43 Z`"
      fill="currentColor"
      opacity="0.1"
    />
    <path
      :d="line"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>
<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ values: number[] }>()
const line = computed(() => {
  const data = props.values.length ? props.values : [0, 0]
  const max = Math.max(1, ...data)
  return data
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${((i * 240) / Math.max(1, data.length - 1)).toFixed(1)},${(40 - (v / max) * 36).toFixed(1)}`,
    )
    .join(' ')
})
</script>
