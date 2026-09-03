<template>
  <!-- 每日流量:后端按连接采样记下每天的入口/出口字节数(server/system/traffic-collector.mjs),
       这里画成月视图柱状图;点一根柱子下钻到当天按节点、按域名/IP 的明细。 -->
  <div class="card w-full">
    <div class="card-title flex flex-wrap items-center gap-2 px-4 pt-4">
      <span>{{ $t('dailyTraffic') }}</span>
      <span
        v-if="loading"
        class="loading loading-spinner loading-xs"
      />
      <div
        v-if="month"
        class="join ml-auto"
      >
        <button
          type="button"
          class="btn btn-ghost btn-sm join-item px-2"
          @click="shiftMonth(-1)"
        >
          <ChevronLeftIcon class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm join-item font-normal"
          @click="shiftMonth(-1)"
        >
          {{ monthLabel(prevMonth) }}
        </button>
        <span class="btn btn-ghost btn-sm join-item no-animation pointer-events-none font-semibold">
          {{ monthLabel(month) }}
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-sm join-item font-normal"
          :disabled="!canGoNext"
          @click="shiftMonth(1)"
        >
          {{ monthLabel(nextMonth) }}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm join-item px-2"
          :disabled="!canGoNext"
          @click="shiftMonth(1)"
        >
          <ChevronRightIcon class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div class="card-body gap-4">
      <p
        v-if="error"
        class="text-error text-sm"
      >
        {{ error }}
      </p>
      <i18n-t
        v-else-if="monthData"
        keypath="trafficMonthSummary"
        tag="p"
        class="text-base-content/70 text-sm"
      >
        <template #month>{{ monthLabel(month) }}</template>
        <template #total>
          <b class="text-primary">{{ fmt(monthData.total.up + monthData.total.down) }}</b>
        </template>
        <template #conns>
          <b class="text-base-content">{{ monthData.total.conns }}</b>
        </template>
      </i18n-t>

      <!-- 柱状图:每天一根,下段入口(primary)、上段出口(secondary);虚线是日均 -->
      <!-- 不做横向滚动:31 根柱子平分卡片宽度,窄屏只藏掉柱顶数值。
           滚动容器在 Windows 上会冒出横竖两条占位的滚动条,很难看 -->
      <div
        v-if="days.length"
        class="relative px-2 pt-6"
      >
        <div class="relative">
          <div
            v-if="avgTotal > 0"
            class="border-warning pointer-events-none absolute right-0 left-0 z-10 border-t border-dashed"
            :style="{ bottom: `${AXIS_H + px(avgTotal)}px` }"
          >
            <span class="text-warning absolute right-0 bottom-0.5 text-xs font-medium whitespace-nowrap">
              {{ $t('trafficDailyAvg') }} {{ fmt(avgTotal) }}
            </span>
          </div>
          <div
            class="flex items-end gap-1"
            :style="{ height: `${LABEL_H + CHART_H + AXIS_H}px` }"
          >
            <div
              v-for="d in days"
              :key="d.day"
              class="group flex h-full min-w-0 flex-1 flex-col items-center justify-end px-px"
              :class="d.future ? 'cursor-default' : 'cursor-pointer'"
              @click="pick(d)"
            >
              <span
                class="mb-1 hidden text-[10px] leading-none whitespace-nowrap tabular-nums md:block"
                :class="labelClass(d)"
              >
                {{ fmtShort(d.total) }}
              </span>
              <div
                class="flex w-full max-w-6 flex-col justify-end overflow-hidden rounded-t transition-opacity"
                :class="barClass(d)"
                :style="{ height: `${d.hUp + d.hDown}px` }"
              >
                <div
                  class="bg-secondary w-full"
                  :style="{ height: `${d.hUp}px` }"
                />
                <div
                  class="bg-primary w-full"
                  :style="{ height: `${d.hDown}px` }"
                />
              </div>
              <span
                class="mt-2 text-[10px] leading-none tabular-nums md:text-xs"
                :class="dayClass(d)"
              >
                {{ d.n }}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="days.length"
        class="text-base-content/70 flex flex-wrap items-center gap-4 text-xs"
      >
        <span class="inline-flex items-center gap-1.5">
          <i class="bg-primary inline-block h-2.5 w-2.5 rounded-sm" />
          {{ $t('trafficIn') }}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <i class="bg-secondary inline-block h-2.5 w-2.5 rounded-sm" />
          {{ $t('trafficOut') }}
        </span>
        <InformationCircleIcon
          v-tip="$t('trafficDirectionHint')"
          class="h-4 w-4 cursor-help"
        />
      </div>

      <!-- 选中那天的明细 -->
      <div
        v-if="selectedDay && detail"
        class="flex flex-col gap-3"
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold">
          <span>{{ selectedDay }}</span>
          <span class="text-base-content/40">·</span>
          <span>{{ $t('trafficIn') }} {{ fmt(detail.total.down) }}</span>
          <span>{{ $t('trafficOut') }} {{ fmt(detail.total.up) }}</span>
          <span>{{ $t('trafficTotal') }} {{ fmt(detailTotal) }}</span>
          <span class="text-base-content/60 font-normal">{{ $t('trafficConns', { n: detail.total.conns }) }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            class="tabs-box tabs tabs-xs"
          >
            <a
              role="tab"
              class="tab"
              :class="tab === 'nodes' && 'tab-active'"
              @click="tab = 'nodes'"
            >
              {{ $t('trafficByNode') }} ({{ detail.nodes.length }})
            </a>
            <a
              role="tab"
              class="tab"
              :class="tab === 'hosts' && 'tab-active'"
              @click="tab = 'hosts'"
            >
              {{ $t('trafficByHost') }} ({{ detail.hostsCount }})
            </a>
          </div>
          <TextInput
            v-if="tab === 'hosts'"
            v-model="filter"
            class="w-56"
            :placeholder="$t('search')"
            :clearable="true"
          />
        </div>
        <div class="bg-base-200/50 overflow-x-auto rounded-lg">
          <table class="table-sm table">
            <thead>
              <tr>
                <th>{{ $t('trafficName') }}</th>
                <th class="text-right">{{ $t('trafficIn') }}</th>
                <th class="text-right">{{ $t('trafficOut') }}</th>
                <th class="text-right">{{ $t('trafficTotal') }}</th>
                <th class="w-44">{{ $t('trafficShare') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in visibleRows"
                :key="row.key"
                class="hover"
              >
                <td
                  class="max-w-[28rem] truncate"
                  :title="row.key"
                >
                  {{ row.key || '—' }}
                </td>
                <td class="text-right tabular-nums">{{ fmt(row.down) }}</td>
                <td class="text-right tabular-nums">{{ fmt(row.up) }}</td>
                <td class="text-right tabular-nums">{{ fmt(row.up + row.down) }}</td>
                <td>
                  <div class="flex items-center gap-2">
                    <progress
                      class="progress progress-primary w-24"
                      :value="share(row)"
                      max="100"
                    />
                    <span class="w-10 text-xs tabular-nums">{{ share(row) }}%</span>
                  </div>
                </td>
              </tr>
              <tr
                v-if="tab === 'nodes' && otherTotal > 0"
                class="text-base-content/60"
              >
                <td>
                  <span class="inline-flex items-center gap-1">
                    {{ $t('trafficOther') }}
                    <InformationCircleIcon
                      v-tip="$t('trafficOtherHint')"
                      class="h-3.5 w-3.5 cursor-help"
                    />
                  </span>
                </td>
                <td class="text-right tabular-nums">{{ fmt(detail.other.down) }}</td>
                <td class="text-right tabular-nums">{{ fmt(detail.other.up) }}</td>
                <td class="text-right tabular-nums">{{ fmt(otherTotal) }}</td>
                <td>
                  <div class="flex items-center gap-2">
                    <progress
                      class="progress w-24"
                      :value="share(detail.other)"
                      max="100"
                    />
                    <span class="w-10 text-xs tabular-nums">{{ share(detail.other) }}%</span>
                  </div>
                </td>
              </tr>
              <tr v-if="!visibleRows.length && !(tab === 'nodes' && otherTotal > 0)">
                <td
                  colspan="5"
                  class="text-base-content/50 text-center"
                >
                  {{ $t('trafficEmptyDay') }}
                </td>
              </tr>
            </tbody>
          </table>
          <p
            v-if="hiddenRows > 0"
            class="text-base-content/50 px-2 py-1 text-xs"
          >
            {{ $t('trafficMoreRows', { n: hiddenRows }) }}
          </p>
        </div>
      </div>
      <p
        v-else-if="days.length && !loading"
        class="text-base-content/50 text-sm"
      >
        {{ $t('trafficPickDay') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  fetchTrafficDay,
  fetchTrafficMonth,
  type OpenboxTrafficDay,
  type OpenboxTrafficMonth,
} from '@/api/openbox'
import TextInput from '@/components/common/TextInput.vue'
import { prettyBytesHelper } from '@/helper/utils'
import { ChevronLeftIcon, ChevronRightIcon, InformationCircleIcon } from '@heroicons/vue/24/outline'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

// 柱子区高度、柱顶数值行高、底部日期行高(px),日均线的定位要和这几个数对齐
const CHART_H = 160
const LABEL_H = 18
const AXIS_H = 20
const ROW_LIMIT = 100

interface DayBar {
  day: string
  n: number
  up: number
  down: number
  total: number
  conns: number
  future: boolean
  hUp: number
  hDown: number
}

const { t } = useI18n()

const loading = ref(false)
const error = ref('')
const monthData = ref<OpenboxTrafficMonth | null>(null)
const month = ref('')
// 服务端的"今天"(路由器时区),别用浏览器的
const today = ref('')
const selectedDay = ref<string | null>(null)
const detail = ref<OpenboxTrafficDay | null>(null)
const tab = ref<'nodes' | 'hosts'>('nodes')
const filter = ref('')

const pad2 = (n: number) => String(n).padStart(2, '0')
const addMonths = (m: string, delta: number) => {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(y, mm - 1 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}
const prevMonth = computed(() => (month.value ? addMonths(month.value, -1) : ''))
const nextMonth = computed(() => (month.value ? addMonths(month.value, 1) : ''))
const canGoNext = computed(
  () => Boolean(month.value && today.value) && nextMonth.value <= today.value.slice(0, 7),
)
const monthLabel = (m: string) => {
  if (!m) return ''
  const [y, mm] = m.split('-')
  return t('trafficMonthLabel', { y, m: Number(mm), mm })
}

const fmt = (n?: number) => prettyBytesHelper(Math.max(0, Math.round(n || 0)), { maximumFractionDigits: 1 })
// 柱顶的数值标签,越短越好:三位数以上就不要小数了(930MB 而不是 930.2MB)
const fmtShort = (n: number) => {
  const v = Math.max(0, Math.round(n))
  const s = prettyBytesHelper(v, { maximumFractionDigits: 1, space: false })
  return parseFloat(s) >= 100 ? prettyBytesHelper(v, { maximumFractionDigits: 0, space: false }) : s
}

const maxTotal = computed(() => Math.max(0, ...(monthData.value?.days.map((d) => d.up + d.down) ?? [0])))
const px = (v: number) => (maxTotal.value > 0 ? Math.round((v / maxTotal.value) * CHART_H) : 0)
const days = computed<DayBar[]>(() =>
  (monthData.value?.days ?? []).map((d) => {
    const total = d.up + d.down
    let hUp = px(d.up)
    let hDown = px(d.down)
    // 有流量但比例太小画不出来的,至少给 2px,让人看得见这天有数据
    if (total > 0 && hUp + hDown < 2) {
      if (d.down >= d.up) hDown = 2
      else hUp = 2
    }
    return {
      day: d.day,
      n: Number(d.day.slice(8)),
      up: d.up,
      down: d.down,
      total,
      conns: d.conns,
      future: d.day > today.value,
      hUp,
      hDown,
    }
  }),
)
const avgTotal = computed(() => (monthData.value ? monthData.value.avg.up + monthData.value.avg.down : 0))

const barClass = (d: DayBar) =>
  d.day === selectedDay.value ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'
const labelClass = (d: DayBar) =>
  !d.total
    ? 'invisible'
    : d.day === selectedDay.value
      ? 'text-base-content font-semibold'
      : 'text-base-content/60'
const dayClass = (d: DayBar) =>
  d.day === selectedDay.value
    ? 'text-primary font-semibold'
    : d.future
      ? 'text-base-content/30'
      : d.day === today.value
        ? 'text-base-content font-semibold'
        : 'text-base-content/60'

const errorText = (e: unknown) => t('trafficLoadError', { message: e instanceof Error ? e.message : String(e) })

const loadDay = async (day: string | null) => {
  if (!day) {
    detail.value = null
    return
  }
  try {
    detail.value = await fetchTrafficDay(day)
  } catch (e) {
    error.value = errorText(e)
  }
}

const loadMonth = async (m?: string, { silent = false } = {}) => {
  if (!silent) loading.value = true
  try {
    const data = await fetchTrafficMonth(m)
    error.value = ''
    monthData.value = data
    month.value = data.month
    today.value = data.today
    // 默认选中:当月选今天,往月选最后一个有流量的日子
    if (!selectedDay.value || !selectedDay.value.startsWith(data.month)) {
      const withData = data.days.filter((d) => d.up + d.down > 0)
      selectedDay.value =
        data.month === data.today.slice(0, 7)
          ? data.today
          : withData.length
            ? withData[withData.length - 1].day
            : null
    }
    await loadDay(selectedDay.value)
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

const shiftMonth = (delta: number) => {
  if (!month.value) return
  if (delta > 0 && !canGoNext.value) return
  selectedDay.value = null
  void loadMonth(addMonths(month.value, delta))
}

const pick = (d: DayBar) => {
  if (d.future) return
  selectedDay.value = d.day
  void loadDay(d.day)
}

const rows = computed(() => {
  const d = detail.value
  if (!d) return []
  const list = tab.value === 'nodes' ? d.nodes : d.hosts
  const q = filter.value.trim().toLowerCase()
  return q ? list.filter((r) => r.key.toLowerCase().includes(q)) : list
})
const visibleRows = computed(() => rows.value.slice(0, ROW_LIMIT))
const hiddenRows = computed(() => {
  const clientHidden = Math.max(0, rows.value.length - ROW_LIMIT)
  const serverHidden =
    tab.value === 'hosts' && detail.value && !filter.value.trim()
      ? Math.max(0, detail.value.hostsCount - detail.value.hosts.length)
      : 0
  return clientHidden + serverHidden
})
const detailTotal = computed(() => (detail.value ? detail.value.total.up + detail.value.total.down : 0))
const otherTotal = computed(() => (detail.value ? detail.value.other.up + detail.value.other.down : 0))
const share = (r: { up: number; down: number }) =>
  detailTotal.value > 0 ? Math.round(((r.up + r.down) / detailTotal.value) * 100) : 0

let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void loadMonth()
  // 看当月时每 30 秒刷一次,今天那根柱子和明细跟着长
  timer = setInterval(() => {
    if (month.value && today.value && month.value === today.value.slice(0, 7)) {
      void loadMonth(month.value, { silent: true })
    }
  }, 30_000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>
