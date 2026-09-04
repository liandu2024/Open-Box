<template>
  <div class="ctrls-bar">
    <!-- 概览页顶栏。原来放的是内核版本号(sing-box x.y.z),那个信息在「设置 → 后端设置」
         的内核卡片里有,这里让位给站点推广。 -->
    <div class="app-card-padding flex h-12 flex-row items-center gap-1 overflow-hidden text-sm">
      <span class="text-base-content/70 truncate">{{ $t('marketPromo') }}</span>
      <!-- 只露站名,网址藏在 href 里。颜色往 base-content 方向调深一点:纯 link-primary
           在浅色主题下太淡,和正文挤在一起看不出是链接;混 base-content 而不是混黑色,
           深色主题下同样是"更贴近正文色"而不是糊成一团。 -->
      <a
        :href="MARKET_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="link link-hover inline-flex shrink-0 items-center gap-1 font-semibold"
        :style="{ color: 'color-mix(in srgb, var(--color-primary) 70%, var(--color-base-content) 30%)' }"
      >
        <BuildingStorefrontIcon class="h-4 w-4 shrink-0" />
        {{ $t('marketName') }}
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { BuildingStorefrontIcon } from '@heroicons/vue/24/outline'

const MARKET_URL = 'https://blog.angeworld.cc/market'

useCtrlsBar()
</script>
