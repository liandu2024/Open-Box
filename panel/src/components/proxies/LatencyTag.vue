<template>
  <div
    :class="
      twMerge(
        'latency-tag bg-base-100 flex h-5 w-10 cursor-pointer items-center justify-center rounded-xl text-xs select-none',
        color,
      )
    "
    @mouseenter="handlerHistoryTip"
  >
    <span
      v-if="loading"
      class="loading loading-dots loading-xs text-base-content/80"
    ></span>
    <BoltIcon
      v-else-if="latency === NOT_CONNECTED || !latency"
      class="text-base-content h-3 w-3"
    />
    <div
      v-show="latency !== NOT_CONNECTED && !loading"
      ref="latencyRef"
    >
      {{ latency }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { NOT_CONNECTED } from '@/constant'
import { getColorForLatency } from '@/helper'
import { useTooltip } from '@/helper/tooltip'
import { isSingBox } from '@/api'
import { MAX_LATENCY_HISTORY, getRecentLatencyHistory, type LatencySample } from '@/store/latencyHistory'
import { getHistoryByName, getLatencyByName, getNowProxyNodeName, proxyMap } from '@/store/proxies'
import { independentLatencyTest } from '@/store/settings'
import { BoltIcon } from '@heroicons/vue/24/outline'
import { CountUp } from 'countup.js'
import dayjs from 'dayjs'
import { twMerge } from 'tailwind-merge'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { showTip } = useTooltip()
// 最近 10 次结果,新的在上:mihomo 的独立测试模式内核自己留了多条,照用;sing-box 每个节点只留
// 最新一次,用服务端攒的时间线(store/latencyHistory.ts),一条都没攒到就退回内核那一条。
// 组看组自己的时间线(每笔带当时选中的节点),节点看节点的;标签本身显示的是当前所选节点的延迟
const timelineTarget = () => {
  if (props.timelineName) return props.timelineName
  const name = props.name ?? ''
  return proxyMap.value[name]?.all?.length ? name : getNowProxyNodeName(name)
}
const recentHistory = (): LatencySample[] => {
  const name = props.name ?? ''
  const fromKernel = (): LatencySample[] =>
    [...getHistoryByName(name, props.groupName)].reverse().slice(0, MAX_LATENCY_HISTORY).map((h) => ({ time: h.time, delay: h.delay }))
  if (independentLatencyTest.value && !isSingBox.value) return fromKernel()
  const own = getRecentLatencyHistory(timelineTarget())
  if (own.length) return own
  return fromKernel()
}
// 类名要写全,Tailwind 只编它在源码里见过的类;从 text-* 动态拼 bg-* 会被裁掉
const dotColor = (delay: number) => {
  switch (getColorForLatency(delay)) {
    case 'text-green-500': return 'bg-green-500'
    case 'text-yellow-500': return 'bg-yellow-500'
    case 'text-red-500': return 'bg-red-500'
    default: return 'bg-gray-400'
  }
}
const handlerHistoryTip = (e: Event) => {
  const history = recentHistory()

  if (!history.length) return

  // 竖着的时间线:左边时间、中间一根线穿过每次的点(顶端箭头,新的在上)、右边延迟按阈值着色;
  // 组的样本在时间上面用小字标出那一笔是当时选中的哪个节点测出来的
  const withNode = history.some((item) => Boolean(item.node))
  const historyList = document.createElement('div')
  // 顶部留出箭头的位置:箭头探出第一行 0.45rem + 自身 7px,pt-3 的 12px 刚好包住它,再加浮层
  // 自己的内边距,箭头尖离浮层边缘约 10px,不会顶到边
  historyList.className = 'grid grid-cols-[auto_1rem_auto] items-stretch gap-x-3 pt-3 pb-1'
  history.forEach((item, i) => {
    const time = document.createElement('div')
    time.className = `flex flex-col items-end justify-center ${withNode ? 'py-0.5' : ''}`
    if (withNode) {
      const node = document.createElement('div')
      node.className = 'text-[10px] leading-tight opacity-70'
      node.textContent = item.node || ''
      time.append(node)
    }
    const stamp = document.createElement('div')
    stamp.className = 'text-xs leading-tight tabular-nums'
    stamp.textContent = dayjs(item.time).format('YYYY-MM-DD HH:mm:ss')
    time.append(stamp)

    // 行高跟着左边那格走(组的样本是两行),线从上到下连着
    const cell = document.createElement('div')
    cell.className = 'relative flex min-h-6 items-center justify-center'
    const line = document.createElement('div')
    line.className = 'absolute bottom-0 left-1/2 w-px -translate-x-1/2'
    // 跟着浮层的文字色走(浮层深色底白字),深浅主题都看得清
    line.style.background = 'color-mix(in srgb, currentColor 45%, transparent)'
    line.style.top = i === 0 ? '-0.3rem' : '0'
    cell.append(line)
    if (i === 0) {
      const arrow = document.createElement('div')
      arrow.className = 'border-x-transparent absolute left-1/2 -translate-x-1/2 border-x-[4px] border-b-[7px]'
      arrow.style.top = '-0.45rem'
      arrow.style.borderBottomColor = 'color-mix(in srgb, currentColor 55%, transparent)'
      cell.append(arrow)
    }
    const dot = document.createElement('div')
    dot.className = `relative z-10 h-2.5 w-2.5 rounded-full ${dotColor(item.delay)}`
    cell.append(dot)

    const latency = document.createElement('div')
    latency.className = `flex items-center text-xs tabular-nums ${getColorForLatency(item.delay)}`
    latency.textContent = item.delay === NOT_CONNECTED ? t('latencyTimeout') : `${item.delay}ms`

    historyList.append(time, cell, latency)
  })

  // interactive:鼠标从标签移进浮层里不关,离开浮层才关
  showTip(e, historyList, {
    delay: [1000, 150],
    trigger: 'mouseenter',
    touch: false,
    interactive: true,
    interactiveBorder: 8,
  })
}

const props = defineProps<{
  name?: string
  loading?: boolean
  groupName?: string
  // 悬停浮层看谁的时间线:组卡片标题的标签 name 是当前所选节点,时间线却要看组自己的
  timelineName?: string
}>()
const latencyRef = ref()
const latency = computed(() => getLatencyByName(props.name ?? '', props.groupName))
let countUp: CountUp | null = null

onMounted(() => {
  watch(latency, (value, OldValue) => {
    if (!countUp) {
      nextTick(() => {
        countUp = new CountUp(latencyRef.value, latency.value, {
          duration: 1,
          separator: '',
          enableScrollSpy: false,
          startVal: OldValue,
        })
        countUp?.update(value)
      })
    } else {
      countUp?.update(value)
    }
  })
})

onUnmounted(() => {
  countUp = null
})

const color = computed(() => {
  return getColorForLatency(latency.value)
})
</script>
