<template>
  <div class="ctrls-bar">
    <!-- 概览页顶栏。原来放的是内核版本号(sing-box x.y.z),那个信息在「设置 → 后端设置」
         的内核卡片里有,这里让位给站点推广。 -->
    <div class="app-card-padding flex h-12 flex-row items-center gap-1 overflow-hidden text-sm">
      <span class="text-base-content/70 shrink-0">{{ $t('marketPromo') }}</span>
      <a
        :href="MARKET_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="link link-primary truncate font-medium"
        @mouseenter="checkTruncation"
      >
        {{ $t('marketName') }} {{ MARKET_URL }}
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { checkTruncation } from '@/helper/tooltip'
import { useCtrlsBar } from '@/composables/useCtrlsBar'

const MARKET_URL = 'https://blog.angeworld.cc/market'

useCtrlsBar()
</script>
