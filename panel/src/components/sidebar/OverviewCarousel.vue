<template>
  <!-- 侧边栏只放一张实时速度图,不再在速度 / 内存 / 连接之间切换。
       上下左右内边距 12px(card p-3),和下面那张统计卡片一样,两张卡片的内容左边对齐。 -->
  <div class="card p-3 text-sm">
    <!-- 绘图区上边距从 15px 收到 8px 省下的 7px 直接从图高里扣掉(112 → 105),卡片跟着矮 -->
    <SpeedCharts
      class="h-[105px]!"
      :pausable="false"
      :tooltip="false"
    />
  </div>
</template>

<script setup lang="ts">
import SpeedCharts from '@/components/overview/SpeedCharts.vue'
</script>
