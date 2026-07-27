<template>
  <div class="card bg-base-100 border-base-content/10 border p-3">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <div class="truncate text-base font-medium">{{ subscription.name }}</div>
        <div class="text-base-content/60 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span>{{ $t('subscriptionNodeCount', { count: subscription.nodeCount }) }}</span>
          <span>·</span>
          <span>{{ $t('updated') }} {{ updatedAtText }}</span>
        </div>
      </div>
      <div class="flex shrink-0 gap-1.5">
        <button
          type="button"
          class="btn btn-circle btn-ghost btn-sm"
          :aria-label="$t('refresh')"
          :disabled="refreshing"
          @click="$emit('refresh')"
        >
          <ArrowPathIcon :class="['h-4 w-4', refreshing && 'animate-spin']" />
        </button>
        <button
          type="button"
          class="btn btn-circle btn-ghost btn-sm hover:text-error"
          :aria-label="$t('delete')"
          @click="$emit('delete')"
        >
          <TrashIcon class="h-4 w-4" />
        </button>
      </div>
    </div>
    <p
      v-if="refreshError"
      class="text-error mt-1 text-xs"
    >
      {{ refreshError }}
    </p>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxSubscription } from '@/api/openbox'
import { ArrowPathIcon, TrashIcon } from '@heroicons/vue/24/outline'
import dayjs from 'dayjs'
import { computed } from 'vue'

const props = defineProps<{
  subscription: OpenboxSubscription
  refreshing?: boolean
  refreshError?: string
}>()

defineEmits<{
  refresh: []
  delete: []
}>()

const updatedAtText = computed(() => dayjs(props.subscription.updatedAt).fromNow())
</script>
