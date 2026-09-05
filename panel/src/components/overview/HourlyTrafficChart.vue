<template>
  <!-- 选中那天的 24 小时曲线:进站 / 出站两条平滑面积线。数据是内核计数器按采样时刻落到小时桶里的
       (traffic-collector 的 kind='hour'),和上面的柱子同源、同一对颜色。
       图下面那行图例常驻写着某个小时的进站 / 出站——默认是峰值那个小时,鼠标(或手指)在图上移到
       哪个小时就换成哪个小时,离开又回到峰值;悬停时还在光标旁弹「时段 + 进站 / 出站」的浮层。 -->
  <div class="flex flex-col gap-2">
    <div class="relative h-44 w-full">
      <div
        ref="chartEl"
        class="h-full w-full"
      />
      <!-- 颜色探针:进站用 primary、出站用 secondary,和柱子一致;浮层底色和概览其他图表一样是
           base-100/70;字体跟着面板 -->
      <div
        ref="probe"
        class="bg-primary text-secondary border-t-base-100/70 hidden"
      />
    </div>
    <div class="text-base-content/70 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs tabular-nums">
      <span>
        <span
          v-if="hoverIndex === null && shown.total > 0"
          class="text-base-content/50"
        >
          {{ $t('trafficPeakHour') }}
        </span>
        {{ shown.label }}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <i class="bg-primary inline-block h-2.5 w-2.5 rounded-sm" />
        {{ $t('trafficIn') }} {{ fmt(shown.down) }}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <i class="bg-secondary inline-block h-2.5 w-2.5 rounded-sm" />
        {{ $t('trafficOut') }} {{ fmt(shown.up) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxTrafficHour } from '@/api/openbox'
import { cssColorToRgb, prettyBytesHelper } from '@/helper/utils'
import { font, theme } from '@/store/settings'
import { useElementSize } from '@vueuse/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

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
// 上一次画进图里的数据;明细每 30 秒静默刷一次,数据没变就不重画,免得曲线闪
let drawnSig = ''

const fmt = (n: number) => prettyBytesHelper(Math.max(0, Math.round(n || 0)), { maximumFractionDigits: 1 })

// 真正画出来的那些小时(今天截到当前小时)
const drawn = computed(() => {
  const last = Math.min(23, Math.max(0, props.upToHour ?? 23))
  return props.hours.filter((h) => h.hour <= last)
})
// 峰值那个小时;并列取靠后的,全是 0 就落到最后一个小时
const peakIndex = computed(() => {
  let best = drawn.value.length - 1
  let max = -1
  drawn.value.forEach((h, i) => {
    const total = h.up + h.down
    if (total >= max) {
      max = total
      best = i
    }
  })
  return best
})
// 鼠标(手指)当前停在哪个小时上;不在图上就是 null
const hoverIndex = ref<number | null>(null)
const shown = computed(() => {
  const list = drawn.value
  const i = hoverIndex.value !== null && hoverIndex.value < list.length ? hoverIndex.value : peakIndex.value
  const h = list[i]
  if (!h) return { label: '', up: 0, down: 0, total: 0 }
  const hh = String(h.hour).padStart(2, '0')
  return { label: `${hh}:00–${hh}:59`, up: h.up, down: h.down, total: h.up + h.down }
})

// 颜色要先折算成 rgb(见 cssColorToRgb 的说明),不然一悬停曲线就没了
const colors = () => {
  const s = probe.value ? getComputedStyle(probe.value) : null
  return {
    inbound: cssColorToRgb(s?.backgroundColor || '') || '#22c55e',
    outbound: cssColorToRgb(s?.color || '') || '#3b82f6',
    text: cssColorToRgb(s?.getPropertyValue('--color-base-content') || '') || '#000',
    tooltipBg: cssColorToRgb(s?.borderTopColor || '') || 'rgba(255, 255, 255, 0.7)',
    fontFamily: s?.fontFamily || '',
  }
}

const render = (force = false) => {
  if (!chart) return
  const hours = drawn.value
  const sig = JSON.stringify(hours)
  if (!force && sig === drawnSig) return
  drawnSig = sig
  const c = colors()
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
  })
  // 不用 notMerge:整图重建会把曲线从头再长一遍,看着像图闪没了又出来;合并更新只是平滑地挪一下
  chart.setOption({
    animationDuration: 300,
    grid: { left: 56, right: 12, top: 12, bottom: 24 },
    // 悬停浮层:一个小时一格,标题写成 13:00–13:59,下面两行进站 / 出站;样式和概览其他图表一致
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBg,
      padding: [4, 8],
      textStyle: { color: c.text, fontFamily: c.fontFamily },
      axisPointer: { type: 'line', lineStyle: { color: c.text, opacity: 0.35 } },
      formatter: (params: { axisValue: string; seriesName: string; value: number; marker: string }[]) => {
        const p = Array.isArray(params) ? params : [params]
        const title = p[0] ? `${p[0].axisValue}–${p[0].axisValue.slice(0, 2)}:59` : ''
        return [title, ...p.map((x) => `${x.marker}${x.seriesName} ${fmt(x.value)}`)].join('<br/>')
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
  })
  // 正悬停着刷新的话,把竖线放回原来那个小时
  if (hoverIndex.value !== null) {
    chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: hoverIndex.value })
  }
}

onMounted(() => {
  if (!chartEl.value) return
  chart = echarts.init(chartEl.value)
  chart.on('updateAxisPointer', (e: unknown) => {
    const ev = e as { dataIndex?: number; axesInfo?: { value: number }[] }
    const v = ev.axesInfo?.length ? ev.axesInfo[0].value : ev.dataIndex
    hoverIndex.value = typeof v === 'number' && v >= 0 ? v : null
  })
  chart.on('globalout', () => {
    hoverIndex.value = null
  })
  render()
})
onUnmounted(() => {
  chart?.dispose()
  chart = undefined
})
watch(drawn, () => render())
// 换主题 / 字体后颜色要重新取
watch([theme, font], () => render(true))
watch(width, () => chart?.resize())
</script>
