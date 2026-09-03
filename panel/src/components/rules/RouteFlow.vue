<template>
  <!-- 自下而上的流程图:左边一根主线,顶端箭头,每个节点一个实底圆圈;右边每行对应一个节点。
       nodes 按从上到下的顺序给(流向是自下而上)。每一行是"圆圈格 + 文字格"一起撑高:
       桌面上文字一行放得下,行高就是最小的 4rem,三段线等长;手机上文字换行行就跟着长高,
       主线按行接续,不会像固定行高那样把下一行压在上面。 -->
  <div class="flex flex-col pt-[0.85rem]">
    <div
      v-for="(node, i) in nodes"
      :key="node.key"
      class="flex min-h-16 gap-4"
    >
      <div class="relative flex w-16 shrink-0 items-center justify-center py-1">
        <div
          v-if="i === 0"
          class="border-x-transparent absolute left-1/2 -translate-x-1/2 border-x-[6px] border-b-[10px]"
          style="top: -0.85rem; border-bottom-color: var(--color-primary)"
        />
        <div
          class="absolute left-1/2 w-0.5 -translate-x-1/2 rounded-full"
          :style="{
            top: i === 0 ? '-0.3rem' : '0',
            bottom: '0',
            background: 'color-mix(in srgb, var(--color-primary) 55%, transparent)',
          }"
        />
        <div
          class="route-node border-primary/70 text-base-content relative z-10 flex h-14 w-14 flex-col items-center justify-center rounded-full border shadow-sm"
        >
          <span class="text-xs leading-none font-medium">{{ node.label }}</span>
          <span
            v-if="node.sub"
            class="mt-1 text-[10px] leading-none opacity-80"
          >{{ node.sub }}</span>
        </div>
      </div>
      <div class="flex min-w-0 flex-1 flex-col justify-center gap-1 py-1">
        <slot :name="node.key" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface RouteFlowNode {
  key: string
  label: string
  sub?: string
}
defineProps<{ nodes: RouteFlowNode[] }>()
</script>

<style scoped>
/* 圆圈必须是实底:主线从它背后穿过,面板开了背景透明度时 .bg-base-100 会被刷成半透明 */
.route-node {
  background-color: var(--color-base-100) !important;
}
</style>
