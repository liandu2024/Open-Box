<template>
  <div class="ctrls-bar">
    <!-- 概览页顶栏。原来放的是内核版本号(sing-box x.y.z),那个信息在「设置 → 后端设置」
         的内核卡片里有,这里让位给站点推广:左边超市,右边两个 AI 中转站。 -->
    <div class="app-card-padding flex h-12 flex-row items-center gap-2 overflow-hidden text-sm">
      <!-- 手机上一行放不下,只留两边的站名:左「安格超市」,右「SUPERDOOR | OPENDOOR」 -->
      <span class="text-base-content/70 hidden truncate sm:inline">{{ $t('marketPromo') }}</span>
      <!-- 只露站名,网址藏在 href 里。颜色往 base-content 方向调深一点:纯 link-primary
           在浅色主题下太淡,和正文挤在一起看不出是链接;混 base-content 而不是混黑色,
           深色主题下同样是"更贴近正文色"而不是糊成一团。 -->
      <a
        :href="MARKET_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="link link-hover inline-flex shrink-0 items-center gap-1 font-semibold"
        :style="linkColor"
      >
        <BuildingStorefrontIcon class="h-4 w-4 shrink-0" />
        {{ $t('marketName') }}
      </a>

      <!-- 右对齐的一组:窄屏先收起说明文字,再收起前缀,链接本身始终在 -->
      <div class="ml-auto flex shrink-0 flex-row items-center gap-2">
        <span class="text-base-content/70 hidden md:inline">{{ $t('aiRelayLabel') }}</span>
        <a
          :href="SUPERDOOR_URL"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-hover inline-flex items-center gap-1 font-semibold"
          :style="linkColor"
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
          :style="linkColor"
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
import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { BoltIcon, BuildingStorefrontIcon, TicketIcon } from '@heroicons/vue/24/outline'

const MARKET_URL = 'https://blog.angeworld.cc/market'
const SUPERDOOR_URL = 'https://ai.superdoor.top'
const OPENDOOR_URL = 'https://ai.opendoor.sbs/'
const linkColor = { color: 'color-mix(in srgb, var(--color-primary) 70%, var(--color-base-content) 30%)' }

useCtrlsBar()
</script>
