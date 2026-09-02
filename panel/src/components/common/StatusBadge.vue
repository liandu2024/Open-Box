<template>
  <!-- 全局统一的状态小标签:开/在跑 = 绿色,关/停 = 灰色。别在各处自己拼 badge 配色。 -->
  <span
    class="badge badge-sm whitespace-nowrap"
    :class="on ? 'badge-success' : 'badge-ghost'"
  >
    {{ on ? onText : offText }}
  </span>
</template>

<script setup lang="ts">
defineProps<{
  on: boolean
  onText: string
  offText: string
}>()
</script>
