<template>
  <!-- 侧边栏顶部:左边产品名 + 版本号,右边收起/展开侧边栏。折叠时只剩那个图标。 -->
  <!-- 不加内边距:上下左右都吃侧边栏那层 p-2(8px)。之前额外加了 pt-1,顶上就比
       底部的卡片多出 4px,一眼看得出不齐 -->
  <div
    class="flex items-center"
    :class="isSidebarCollapsed ? 'justify-center' : 'justify-between gap-2'"
  >
    <div
      v-if="!isSidebarCollapsed"
      class="flex min-w-0 flex-col leading-tight"
    >
      <span class="text-base font-semibold">Open-Box</span>
      <span
        class="text-base-content/60 truncate font-mono text-[11px]"
        :title="openboxBuiltAt"
      >{{ versionLabel || '—' }}</span>
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
import { computed, onMounted, ref } from 'vue'

// 版本号整个会话里不会变,取一次就够
const openboxVersion = ref('')
// 发布时间(meta.json 的 builtAt,UTC ISO),侧边栏显示成 v0.1.79 | 20260904(按浏览器所在时区取日期)
const openboxBuiltAt = ref('')
const versionLabel = computed(() => {
  if (!openboxVersion.value) return ''
  const d = openboxBuiltAt.value ? new Date(openboxBuiltAt.value) : null
  if (!d || Number.isNaN(d.getTime())) return openboxVersion.value
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `${openboxVersion.value} | ${ymd}`
})
onMounted(async () => {
  if (openboxVersion.value) return
  try {
    const status = await fetchUpdateStatus()
    openboxVersion.value = status.version || ''
    openboxBuiltAt.value = status.builtAt || ''
  } catch {
    openboxVersion.value = ''
  }
})
</script>
