<template>
  <div :class="className.list">
    <div
      v-for="stat in order"
      :key="stat"
      :class="className.item"
    >
      <div :class="className.label">{{ $t(stat) }}</div>
      <div :class="className.value">{{ statisticsMap[stat] }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { STATISTICS_TYPE, statisticsMap } from '@/composables/statistics'
import { computed } from 'vue'

const props = defineProps<{
  type: 'overview' | 'ctrl' | 'settings'
}>()

const classMap = {
  overview: {
    list: 'grid grid-cols-2 gap-2 rounded-lg bg-base-200/50 px-4 py-2 lg:grid-cols-6',
    item: 'flex h-12 flex-col items-start justify-center lg:gap-0.5 lg:items-center',
    label: 'text-xs text-base-content/70',
    value: 'text-lg lg:text-xl font-bold',
  },
  settings: {
    list: 'grid w-full grid-cols-3 gap-1 rounded-lg bg-base-200/50 p-3',
    item: 'flex flex-col items-start',
    label: 'text-xs text-base-content/70',
    value: 'text-sm',
  },
  ctrl: {
    // 侧边栏那张卡片自己就是容器(CommonCtrl.vue,card p-3 = 12px 内边距),这里不再套底色也不再加内边距
    list: 'grid w-full grid-cols-2 gap-2',
    item: 'flex items-start flex-col',
    label: 'text-xs text-base-content/70',
    value: 'text-sm',
  },
}

const orderMap = {
  overview: [
    STATISTICS_TYPE.CONNECTIONS,
    STATISTICS_TYPE.MEMORY_USAGE,
    STATISTICS_TYPE.DOWNLOAD,
    STATISTICS_TYPE.DL_SPEED,
    STATISTICS_TYPE.UPLOAD,
    STATISTICS_TYPE.UL_SPEED,
  ],
  settings: [
    STATISTICS_TYPE.CONNECTIONS,
    STATISTICS_TYPE.DOWNLOAD,
    STATISTICS_TYPE.DL_SPEED,
    STATISTICS_TYPE.MEMORY_USAGE,
    STATISTICS_TYPE.UPLOAD,
    STATISTICS_TYPE.UL_SPEED,
  ],
  ctrl: [
    STATISTICS_TYPE.CONNECTIONS,
    STATISTICS_TYPE.MEMORY_USAGE,
    STATISTICS_TYPE.DOWNLOAD,
    STATISTICS_TYPE.DL_SPEED,
    STATISTICS_TYPE.UPLOAD,
    STATISTICS_TYPE.UL_SPEED,
  ],
}

const className = computed(() => classMap[props.type])
const order = computed(() => orderMap[props.type])
</script>
