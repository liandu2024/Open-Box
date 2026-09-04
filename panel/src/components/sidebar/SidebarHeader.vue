<template>
  <!-- 侧边栏顶部:左边产品标识,右边收起/展开。折叠时只剩那个按钮。 -->
  <!-- 不加内边距:上下左右统一吃侧边栏那层 p-2(8px),和底部卡片同一条边 -->
  <div
    class="flex items-center"
    :class="isSidebarCollapsed ? 'justify-center' : 'justify-between gap-2'"
  >
    <!-- 产品标识用图片(src/assets/logo.png,已抠掉背景)。深色主题下墨迹是深藏青,
         在 forest 底色上几乎看不见,靠 main.css 里的滤镜整体翻亮,绿橙两个点缀色不变。
         版本号和发布日期不在这里显示了——「设置 → 后端设置」的更新卡片上就有 -->
    <img
      v-if="!isSidebarCollapsed"
      :src="logoUrl"
      class="app-logo h-6 w-auto min-w-0"
      alt="Open-Box"
    />
    <button
      type="button"
      class="btn btn-ghost btn-sm btn-square shrink-0"
      v-tip="$t(isSidebarCollapsed ? 'sidebarExpand' : 'sidebarCollapse')"
      @click="isSidebarCollapsed = !isSidebarCollapsed"
    >
      <svg
        class="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect
          x="3"
          y="4"
          width="18"
          height="16"
          rx="3"
        />
        <path d="M9 4v16" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import logoUrl from '@/assets/logo.png'
import { isSidebarCollapsed } from '@/store/settings'
</script>
