<template>
  <div
    class="sidebar bg-base-200 text-base-content scrollbar-hidden h-full overflow-x-hidden p-2 transition-all"
    :class="isSidebarCollapsed ? 'w-13' : 'w-64'"
  >
    <!-- 展开/收缩都保留外层 p-2 的 8px 安全边距:收缩态内容列 56px,菜单项、顶部图标、底部卡片同一条边 -->
    <!-- 折叠时整栏 52px = 36px 的一列(菜单项、底部按钮、顶上的展开键都是这个宽)+ 左右各 8px,
         和上下的 p-2 一样——四边留白相等,元素不用在一条更宽的槽里居中 -->
    <div :class="twMerge('flex h-full flex-col gap-2', isSidebarCollapsed ? 'w-9' : 'w-60')">
      <SidebarHeader />
      <!-- 菜单去掉 daisyUI 自带的 p-2:菜单项、顶部标题、底部卡片共用同一条左右边 -->
      <ul class="menu w-full flex-1 p-0">
        <li
          v-for="r in renderRoutes"
          :key="r"
          @mouseenter="(e) => mouseenterHandler(e, r)"
        >
          <!-- 行高写死 h-9(36px):折叠时只有 20px 的图标,展开时多一行文字,靠内边距
               撑高的话两种状态每一项差一两像素,一路累加下来整列图标就对不齐了。
               折叠时宽也写死 w-9 居中:和底部启动 / 停止 / 重启那几个按钮一样大、同一条中线、
               同样的左右边距——不然选中项那块底色横跨整列,比下面的圆按钮宽一截。 -->
          <a
            :class="[
              r === route.name ? 'menu-active' : '',
              isSidebarCollapsed && 'mx-auto w-9 justify-center px-0',
              'flex h-9 items-center py-0',
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
      <!-- 折叠时底部只留启动 / 停止 / 重启三个按钮,不套卡片、不摆统计——那一列全是单色
           小图标,中间夹一块白卡片会打乱视觉线;按钮居中,左右和上面的菜单图标对齐 -->
      <template v-if="isSidebarCollapsed">
        <KernelActionButtons vertical />
      </template>
      <template v-else>
        <OverviewCarousel v-if="route.name !== ROUTE_NAME.overview" />
        <CommonSidebar />
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
import { isSidebarCollapsed } from '@/store/settings'
import { twMerge } from 'tailwind-merge'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import OverviewCarousel from './OverviewCarousel.vue'
import KernelActionButtons from './KernelActionButtons.vue'
import SidebarHeader from './SidebarHeader.vue'

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
