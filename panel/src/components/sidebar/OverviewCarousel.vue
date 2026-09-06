<template>
  <!-- 侧边栏只放一张实时上下行速度图,不再在速度 / 内存 / 连接之间切换。
       结构和下面那张统计卡片一模一样:card p-2 再套一层 p-2——统计卡片里的文字离卡片边 16px,
       这里图表的纵轴标签也从 16px 开始,两张卡片的内容左边对齐。 -->
  <div class="card p-2 text-sm">
    <div class="p-2">
      <SpeedCharts class="h-28" />
    </div>
  </div>
</template>

<script setup lang="ts">
import SpeedCharts from '@/components/overview/SpeedCharts.vue'
</script>
