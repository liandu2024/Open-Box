<template>
  <div class="connection-tabs tabs-box tabs tabs-xs flex-nowrap">
    <a
      v-for="tab in Object.values(CONNECTION_TAB_TYPE)"
      :key="tab"
      role="tab"
      :class="
        twMerge(
          'tab max-md:min-w-0 max-md:px-1.5 whitespace-nowrap',
          connectionTabShow === tab && 'tab-active',
          !horizental && 'flex-1',
        )
      "
      @click="() => (connectionTabShow = tab)"
      >{{ $t(tab) }}
      <template v-if="connectionTabShow === tab">({{ connectionsCount }})</template>
    </a>
  </div>
</template>

<script setup lang="ts">
import { CONNECTION_TAB_TYPE } from '@/constant'
import { connections, connectionTabShow, renderConnections } from '@/store/connections'
import { twMerge } from 'tailwind-merge'
import { computed } from 'vue'

defineProps({
  horizental: {
    type: Boolean,
    default: true,
  },
})
const connectionsCount = computed(() => {
  if (renderConnections.value.length !== connections.value.length) {
    return `${renderConnections.value.length} / ${connections.value.length}`
  }

  return connections.value.length
})
</script>
