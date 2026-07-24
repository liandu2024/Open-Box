<template>
  <div
    ref="parentRef"
    class="flex h-full w-full flex-col overflow-y-auto"
  >
    <slot name="before" />
    <div
      :style="{
        height: `${totalSize}px`,
      }"
      class="relative w-full"
      v-if="data.length > 0"
    >
      <div
        class="app-card-padding absolute top-0 left-0 w-full"
        :style="{
          transform: `translateY(${virtualRows[0]?.start ?? 0}px)`,
        }"
      >
        <div
          v-for="row in virtualRows"
          :key="row.key.toString()"
          :data-index="row.index"
          :ref="(ref) => measureElement(ref as Element | null)"
          :style="{ marginBottom: marginBottom(row.index) }"
        >
          <slot
            :item="data[row.index]"
            :index="row.index"
          />
        </div>
      </div>
    </div>
    <div
      v-else
      class="card app-card-padding m-3 flex-row text-sm"
    >
      {{ $t('noContent') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePaddingForViews } from '@/composables/paddingViews'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, nextTick, ref } from 'vue'

const { paddingBottom } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})
const parentRef = ref<HTMLElement | null>(null)
const props = withDefaults(
  defineProps<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any[]
    size?: number
    overscan?: number
  }>(),
  {
    data: () => [],
    size: 64,
    overscan: 24,
  },
)
const virutalOptions = computed(() => {
  return {
    count: props.data.length,
    getScrollElement: () => parentRef.value,
    estimateSize: () => props.size,
    overscan: props.overscan,
  }
})

const rowVirtualizer = useVirtualizer(virutalOptions)
const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems())
const totalSize = computed(() => rowVirtualizer.value.getTotalSize())

const marginBottom = (index: number) => {
  return index === props.data.length - 1 ? `${paddingBottom.value}px` : 'var(--app-space, 0.5rem)'
}
const measureElement = (el: Element | null) => {
  if (!el) {
    return
  }

  nextTick(() => {
    rowVirtualizer.value.measureElement(el)
  })

  return undefined
}
</script>
