<template>
  <div
    class="sidebar bg-base-200 text-base-content scrollbar-hidden h-full overflow-x-hidden p-2 transition-all"
    :class="isSidebarCollapsed ? 'w-18' : 'w-64'"
  >
    <!-- 展开/收缩都保留外层 p-2 的 8px 安全边距:收缩态内容列 56px,菜单项、顶部图标、底部卡片同一条边 -->
    <div :class="twMerge('flex h-full flex-col gap-2', isSidebarCollapsed ? 'w-14' : 'w-60')">
      <SidebarHeader />
      <!-- 菜单去掉 daisyUI 自带的 p-2:菜单项、顶部标题、底部卡片共用同一条左右边 -->
      <ul class="menu w-full flex-1 p-0">
        <li
          v-for="r in renderRoutes"
          :key="r"
          @mouseenter="(e) => mouseenterHandler(e, r)"
        >
          <a
            :class="[
              r === route.name ? 'menu-active' : '',
              isSidebarCollapsed && 'justify-center',
              'py-2',
            ]"
            @click.passive="() => router.push({ name: r })"
          >
            <component
              :is="ROUTE_ICON_MAP[r]"
              class="h-5 w-5"
            />
            <template v-if="!isSidebarCollapsed">
              {{ $t(r) }}
            </template>
          </a>
        </li>
      </ul>
      <template v-if="isSidebarCollapsed">
        <VerticalInfos v-if="showStatisticsWhenSidebarCollapsed">
          <KernelActionButtons vertical />
        </VerticalInfos>
        <KernelActionButtons
          v-else
          vertical
        />
      </template>
      <template v-else>
        <OverviewCarousel v-if="route.name !== ROUTE_NAME.overview" />
        <div class="card">
          <CommonSidebar />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import CommonSidebar from '@/components/sidebar/CommonCtrl.vue'
import { ROUTE_ICON_MAP, ROUTE_NAME } from '@/constant'
import { renderRoutes } from '@/helper'
import { useTooltip } from '@/helper/tooltip'
import router from '@/router'
import { isSidebarCollapsed, showStatisticsWhenSidebarCollapsed } from '@/store/settings'
import { twMerge } from 'tailwind-merge'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import OverviewCarousel from './OverviewCarousel.vue'
import KernelActionButtons from './KernelActionButtons.vue'
import SidebarHeader from './SidebarHeader.vue'
import VerticalInfos from './VerticalInfos.vue'

const { showTip } = useTooltip()
const { t } = useI18n()

const mouseenterHandler = (e: MouseEvent, r: string) => {
  if (!isSidebarCollapsed.value) return
  showTip(e, t(r), {
    placement: 'right',
  })
}

const route = useRoute()
</script>
