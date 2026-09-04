<template>
  <div class="ctrls-bar">
    <!-- 概览页顶栏。原来放的是内核版本号(sing-box x.y.z),那个信息在「设置 → 后端设置」
         的内核卡片里有,这里让位给站点推广:左边超市,右边两个 AI 中转站。 -->
    <div class="app-card-padding flex h-12 flex-row items-center gap-2 overflow-hidden text-sm">
      <!-- 手机上一行放不下,只留两边的站名:左「安格超市」,右「SUPERDOOR | OPENDOOR」 -->
      <span class="text-base-content/70 hidden truncate sm:inline">{{ $t('marketPromo') }}</span>
      <!-- 只露站名,网址藏在 href 里(见 components/common/MarketLink.vue) -->
      <MarketLink icon />

      <!-- 右对齐的一组:窄屏先收起说明文字,再收起前缀,链接本身始终在 -->
      <div class="ml-auto flex shrink-0 flex-row items-center gap-2">
        <span class="text-base-content/70 hidden md:inline">{{ $t('aiRelayLabel') }}</span>
        <a
          :href="SUPERDOOR_URL"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-hover inline-flex items-center gap-1 font-semibold"
          :style="MARKET_LINK_STYLE"
        >
          <TicketIcon class="h-4 w-4 shrink-0" />
          SUPERDOOR
          <span class="hidden font-normal sm:inline">{{ $t('aiRelaySubscription') }}</span>
        </a>
        <span class="text-base-content/30">|</span>
        <a
          :href="OPENDOOR_URL"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-hover inline-flex items-center gap-1 font-semibold"
          :style="MARKET_LINK_STYLE"
        >
          <BoltIcon class="h-4 w-4 shrink-0" />
          OPENDOOR
          <span class="hidden font-normal sm:inline">{{ $t('aiRelayOnDemand') }}</span>
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import MarketLink from '@/components/common/MarketLink.vue'
import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { MARKET_LINK_STYLE, OPENDOOR_URL, SUPERDOOR_URL } from '@/constant/market'
import { BoltIcon, TicketIcon } from '@heroicons/vue/24/outline'

useCtrlsBar()
</script>
