<template>
  <!-- 侧边栏顶部:左边产品名 + 版本号,右边收起/展开侧边栏。折叠时只剩那个图标。 -->
  <div
    class="flex items-center px-2 pt-1"
    :class="isSidebarCollapsed ? 'justify-center' : 'justify-between gap-2'"
  >
    <div
      v-if="!isSidebarCollapsed"
      class="flex min-w-0 flex-col leading-tight"
    >
      <span class="text-base font-semibold">Open-Box</span>
      <span
        class="text-base-content/60 truncate font-mono text-[11px]"
        :title="openboxVersion"
      >{{ openboxVersion || '—' }}</span>
    </div>
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
import { fetchUpdateStatus } from '@/api/openbox'
import { isSidebarCollapsed } from '@/store/settings'
import { onMounted, ref } from 'vue'

// 版本号整个会话里不会变,取一次就够
const openboxVersion = ref('')
onMounted(async () => {
  if (openboxVersion.value) return
  try {
    openboxVersion.value = (await fetchUpdateStatus()).version || ''
  } catch {
    openboxVersion.value = ''
  }
})
</script>
