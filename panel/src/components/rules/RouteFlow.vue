<template>
  <!-- 自下而上的流程图:左边一根主线,顶端箭头,每个节点一个实底圆圈;右边每行对应一个节点。
       nodes 按从上到下的顺序给(流向是自下而上),每行固定等高,三段线等长。 -->
  <div class="flex gap-4">
    <div class="relative w-16 shrink-0 pt-[0.85rem] pb-1">
      <div
        class="border-x-transparent absolute top-0 left-1/2 -translate-x-1/2 border-x-[6px] border-b-[10px]"
        style="border-bottom-color: var(--color-primary)"
      />
      <div
        class="absolute left-1/2 w-0.5 -translate-x-1/2 rounded-full"
        style="top: 0.55rem; bottom: 0; background: color-mix(in srgb, var(--color-primary) 55%, transparent)"
      />
      <div
        v-for="node in nodes"
        :key="node.key"
        class="flex h-16 items-center justify-center"
      >
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
    </div>
    <div class="flex min-w-0 flex-1 flex-col pt-[0.85rem]">
      <div
        v-for="node in nodes"
        :key="node.key"
        class="flex h-16 flex-col justify-center gap-1"
      >
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
