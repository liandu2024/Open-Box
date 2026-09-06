<template>
  <!-- 侧边栏只放一张实时速度图,不再在速度 / 内存 / 连接之间切换。
       内边距 8px(card p-2),和下面那张统计卡片一样,两张卡片的内容左边对齐。 -->
  <div class="card p-2 text-sm">
    <SpeedCharts class="h-28" />
  </div>
</template>

<script setup lang="ts">
import SpeedCharts from '@/components/overview/SpeedCharts.vue'
</script>
