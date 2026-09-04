<template>
  <a
    :href="MARKET_URL"
    target="_blank"
    rel="noopener noreferrer"
    class="link link-hover inline-flex shrink-0 items-center gap-1 font-semibold"
    :style="MARKET_LINK_STYLE"
  >
    <BuildingStorefrontIcon
      v-if="icon"
      class="h-4 w-4 shrink-0"
    />
    {{ $t('marketName') }}
  </a>
</template>

<script setup lang="ts">
import { MARKET_LINK_STYLE, MARKET_URL } from '@/constant/market'
import { BuildingStorefrontIcon } from '@heroicons/vue/24/outline'

withDefaults(defineProps<{ icon?: boolean }>(), { icon: false })
</script>
