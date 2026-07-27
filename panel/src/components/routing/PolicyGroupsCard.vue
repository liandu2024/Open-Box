<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-2 p-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-base font-semibold">{{ $t('routingPolicyGroupsTitle') }}</h2>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          :aria-label="$t('refresh')"
          :disabled="loading"
          @click="$emit('retry')"
        >
          <ArrowPathIcon
            class="h-3.5 w-3.5"
            :class="loading && 'animate-spin'"
          />
        </button>
      </div>
      <p class="text-base-content/60 text-xs">{{ $t('routingPolicyGroupsDescription') }}</p>

      <p
        v-if="error"
        class="text-error text-xs"
      >
        {{ error }}
      </p>

      <div
        v-else-if="!loading && policyGroups.length === 0"
        class="text-base-content/50 text-xs"
      >
        {{ $t('routingPolicyGroupsEmpty') }}
      </div>

      <div
        v-else
        class="flex flex-wrap gap-2"
      >
        <div
          v-for="group in policyGroups"
          :key="group.name"
          class="badge badge-outline gap-1.5 py-3 text-xs"
        >
          <span class="font-mono font-medium">{{ group.name }}</span>
          <span class="text-base-content/40">·</span>
          <span>{{ $t('routingPolicyGroupNodeCount', { count: group.nodeCount }) }}</span>
          <span class="text-base-content/40">·</span>
          <span>{{
            group.type === 'urltest' ? $t('routingPolicyGroupTypeUrltest') : $t('routingPolicyGroupTypeSelector')
          }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxPolicyGroup } from '@/api/openbox'
import { ArrowPathIcon } from '@heroicons/vue/24/outline'

defineProps<{
  policyGroups: OpenboxPolicyGroup[]
  loading: boolean
  error: string
}>()

defineEmits<{
  retry: []
}>()
</script>
