<template>
  <!-- 选中那天的 24 小时曲线:进站 / 出站两条平滑面积线。数据是内核计数器按采样时刻落到小时桶里的
       (traffic-collector 的 kind='hour'),和上面的柱子同源、同一对颜色。 -->
  <div class="relative h-44 w-full">
    <div
      ref="chartEl"
      class="h-full w-full"
    />
    <!-- 颜色探针:进站用 primary、出站用 secondary,和柱子一致;字体跟着面板 -->
    <div
      ref="probe"
      class="bg-primary text-secondary hidden"
    />
  </div>
</template>

<script setup lang="ts">
import type { OpenboxTrafficHour } from '@/api/openbox'
import { prettyBytesHelper } from '@/helper/utils'
import { font, theme } from '@/store/settings'
import { useElementSize } from '@vueuse/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  hours: OpenboxTrafficHour[]
  // 今天只画到当前这个小时,后面的还没发生,画成一条贴地的 0 只会误导
  upToHour?: number
}>()

const { t } = useI18n()
const chartEl = ref<HTMLElement>()
const probe = ref<HTMLElement>()
const { width } = useElementSize(chartEl)
let chart: echarts.ECharts | undefined

const colors = () => {
  const s = probe.value ? getComputedStyle(probe.value) : null
  return {
    inbound: s?.backgroundColor || '#22c55e',
    outbound: s?.color || '#3b82f6',
    text: s?.getPropertyValue('--color-base-content').trim() || '#000',
    fontFamily: s?.fontFamily || '',
  }
}

const render = () => {
  if (!chart) return
  const c = colors()
  const last = Math.min(23, Math.max(0, props.upToHour ?? 23))
  const hours = props.hours.filter((h) => h.hour <= last)
  const labels = hours.map((h) => `${String(h.hour).padStart(2, '0')}:00`)
  const series = (name: string, key: 'down' | 'up', color: string) => ({
    name,
    type: 'line',
    smooth: true,
    showSymbol: false,
    data: hours.map((h) => h[key]),
    lineStyle: { color, width: 2 },
    itemStyle: { color },
    areaStyle: { color, opacity: 0.18 },
    emphasis: { focus: 'series' },
  })
  chart.setOption(
    {
      animationDuration: 300,
      // 横轴刻度一行、图例一行,别挤在一起
      legend: { bottom: 0, textStyle: { color: c.text, fontFamily: c.fontFamily } },
      grid: { left: 56, right: 12, top: 12, bottom: 50 },
      tooltip: {
        trigger: 'axis',
        confine: true,
        textStyle: { fontFamily: c.fontFamily },
        // 一个小时一格:标题写成 13:00–13:59
        formatter: (params: { axisValue: string; seriesName: string; value: number; marker: string }[]) => {
          const p = Array.isArray(params) ? params : [params]
          const title = p[0] ? `${p[0].axisValue}–${p[0].axisValue.slice(0, 2)}:59` : ''
          return [title, ...p.map((x) => `${x.marker}${x.seriesName} ${prettyBytesHelper(x.value)}`)].join('<br/>')
        },
      },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: c.text, fontFamily: c.fontFamily, interval: 2 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLabel: { color: c.text, fontFamily: c.fontFamily, formatter: (v: number) => prettyBytesHelper(v) },
        splitLine: { lineStyle: { color: c.text, opacity: 0.08 } },
      },
      series: [series(t('trafficIn'), 'down', c.inbound), series(t('trafficOut'), 'up', c.outbound)],
    },
    true,
  )
}

onMounted(() => {
  if (!chartEl.value) return
  chart = echarts.init(chartEl.value)
  render()
})
onUnmounted(() => {
  chart?.dispose()
  chart = undefined
})
watch(() => [props.hours, props.upToHour], render, { deep: true })
// 换主题 / 字体后颜色要重新取
watch([theme, font], render)
watch(width, () => chart?.resize())
</script>
