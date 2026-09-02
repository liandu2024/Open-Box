<template>
  <!-- 全局统一的状态小标签:正常/运行中/开启 = 浅绿底绿字,反之 = 浅红底红字。
       配色写在 main.css 的 .status-badge 里(带 !important):面板开了背景图时,
       zashboard 会把所有 .badge 统一刷成半透明的 base-200,不加权重就全变灰。 -->
  <span
    class="status-badge badge badge-sm whitespace-nowrap"
    :class="on ? 'status-on' : 'status-off'"
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
