<template>
  <!-- 侧边栏顶部:左边产品标识,右边收起/展开。折叠时只剩那个按钮。 -->
  <!-- 不加内边距:上下左右统一吃侧边栏那层 p-2(8px),和底部卡片同一条边 -->
  <!-- 高度写死 h-9(36px,和收起按钮、菜单项一样高):折叠时这一行只有收起按钮,展开时多了 24px 高的标识,
       不定死的话两种状态行高不一样,下面整列图标就会上下漂 -->
  <div
    class="flex h-9 shrink-0 items-center"
    :class="isSidebarCollapsed ? 'justify-center' : 'justify-between gap-2'"
  >
    <!-- 产品标识(src/assets/logo.png,透明底)。只在展开时出现:折叠后这一列全是
         单色的功能图标,中间夹一个彩色标识会打乱这条视觉线。
         深色主题下墨迹是深藏青,在 forest 底色上几乎看不见,靠 main.css 里的滤镜整体
         翻亮,绿橙两个点缀色不变。
         版本号和发布日期不在这里显示了——「设置 → 后端设置」的更新卡片上就有 -->
    <img
      v-if="!isSidebarCollapsed"
      :src="logoUrl"
      class="app-logo h-6 w-auto min-w-0"
      alt="Open-Box"
    />
    <button
      type="button"
      class="btn btn-ghost btn-sm btn-square h-9 w-9 shrink-0"
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
