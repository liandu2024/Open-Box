<template>
  <div
    class="relative flex size-full min-h-0 flex-col overflow-hidden"
    :style="!useConnectionCard && padding"
  >
    <template v-if="useConnectionCard">
      <ConnectionCardList />
    </template>
    <template v-else>
      <ConnectionCtrl />
      <ConnectionTable />
    </template>
    <ConnectionDetails />
  </div>
</template>

<script setup lang="ts">
import ConnectionCardList from '@/components/connections/ConnectionCardList.vue'
import ConnectionDetails from '@/components/connections/ConnectionDetails.vue'
import ConnectionTable from '@/components/connections/ConnectionTable.vue'
import ConnectionCtrl from '@/components/sidebar/ConnectionCtrl.tsx'
import { usePaddingForViews } from '@/composables/paddingViews'
import { useConnectionCard } from '@/store/settings'
// 表格外面已经包了一层 8px(ConnectionTable 的 app-card-padding),把公共逻辑给的
// 8px 安全边距抵掉,表格离工具栏 / 底部导航正好 8px,和其它页面一致
const { padding } = usePaddingForViews({
  offsetTop: -8,
  offsetBottom: -8,
})
</script>

<style>
.vjs-tree {
  font-family:
    NotoEmoji,
    Monaco,
    Menlo,
    Consolas,
    Bitstream Vera Sans Mono,
    monospace;
}
.vjs-tree-node.is-highlight,
.vjs-tree-node:hover {
  background-color: var(--color-base-200);
}
</style>
