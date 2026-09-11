<template>
  <!-- 每日流量:后端按连接采样记下每天的入口/出口字节数(server/system/traffic-collector.mjs),
       这里画成月视图柱状图;点一根柱子下钻到当天按终端设备、节点、访问目标的明细,每一行再能点开看它的构成。 -->
  <div class="card w-full">
    <div class="flex flex-wrap items-center gap-2 px-4 pt-4">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-base font-semibold">{{ $t('dailyTraffic') }}</h2>
          <span
            v-if="loading"
            class="loading loading-spinner loading-xs"
          />
          <!-- 统计直连流量:关掉后服务端把走直连出站的那部分从总量 / 曲线 / 列表里扣掉,库里数据不动 -->
          <label
            class="text-base-content/70 flex cursor-pointer items-center gap-1.5 text-xs font-normal"
            :title="$t('trafficCountDirectHint')"
          >
            <span>{{ $t('trafficCountDirect') }}</span>
            <input
              v-model="trafficCountDirect"
              type="checkbox"
              class="toggle toggle-xs toggle-primary"
            >
          </label>
        </div>
        <p v-if="error" class="text-error text-xs">{{ error }}</p>
        <i18n-t
          v-else-if="monthData"
          keypath="trafficMonthSummary"
          tag="p"
          class="text-base-content/60 text-xs"
        >
          <template #month>{{ monthLabel(month) }}</template>
          <template #total><b class="text-primary">{{ fmt(monthData.total.up + monthData.total.down) }}</b></template>
          <template #conns><b class="text-base-content">{{ monthData.total.conns }}</b></template>
        </i18n-t>
      </div>
      <!-- 月份切换:和明细页签同一套 tabs-box 样式(圆角高亮块),两侧箭头用圆形幽灵按钮 -->
      <div
        v-if="month"
        class="ml-auto flex items-center gap-1"
      >
        <button
          type="button"
          class="btn btn-ghost btn-circle btn-sm"
          @click="shiftMonth(-1)"
        >
          <ChevronLeftIcon class="h-4 w-4" />
        </button>
        <div
          role="tablist"
          class="tabs-box tabs tabs-sm"
        >
          <a
            role="tab"
            class="tab"
            @click="shiftMonth(-1)"
          >{{ monthLabel(prevMonth) }}</a>
          <a
            role="tab"
            class="tab tab-active font-semibold"
          >{{ monthLabel(month) }}</a>
          <a
            role="tab"
            class="tab"
            :class="!canGoNext && 'tab-disabled'"
            @click="canGoNext && shiftMonth(1)"
          >{{ monthLabel(nextMonth) }}</a>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-circle btn-sm"
          :disabled="!canGoNext"
          @click="shiftMonth(1)"
        >
          <ChevronRightIcon class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div class="card-body gap-4">
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
        <!-- 图例顺手写上选中那天的进站 / 出站,不用点开明细就能看到 -->
        <span class="inline-flex items-center gap-1.5">
          <i class="bg-primary inline-block h-2.5 w-2.5 rounded-sm" />
          {{ $t('trafficIn') }}
          <span
            v-if="selectedBar"
            class="text-base-content font-medium tabular-nums"
          >
            {{ fmt(selectedBar.down) }}
          </span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <i class="bg-secondary inline-block h-2.5 w-2.5 rounded-sm" />
          {{ $t('trafficOut') }}
          <span
            v-if="selectedBar"
            class="text-base-content font-medium tabular-nums"
          >
            {{ fmt(selectedBar.up) }}
          </span>
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
          <span
            v-if="selectedHour !== null"
            class="tabular-nums"
          >{{ hourLabel(selectedHour) }}</span>
          <span class="text-base-content/40">·</span>
          <span>{{ $t('trafficTotal') }} {{ fmt(detailTotal) }}</span>
          <span class="text-base-content/60 font-normal">{{ $t('trafficConns', { n: detail.total.conns }) }}</span>
          <!-- 右上角回整天的键:平时就摆着但置灰,点了曲线上某个小时才能点;样式和设置页
               「修改密码」那个键一样(btn btn-sm) -->
          <button
            type="button"
            class="btn btn-sm ml-auto"
            :disabled="selectedHour === null"
            @click="backToDay"
          >
            {{ $t('trafficBackToDay') }}
          </button>
        </div>
        <!-- 这天的 24 小时曲线,跟在这天的总数后面;今天只画到路由器此刻的小时(服务端给的,
             浏览器和路由器可能不在一个时区;老服务端没给才退回浏览器的钟)。
             点某个小时,下面的明细就只看那个小时 -->
        <HourlyTrafficChart
          :hours="detail.hours || []"
          :up-to-hour="detail.day === detail.today ? (detail.nowHour ?? currentHour) : 23"
          :selected-hour="selectedHour"
          @select="selectHour"
        />
        <p
          v-if="hourDetailMissing"
          class="text-warning text-xs"
        >
          {{ $t('trafficHourNoDetail', { days: detail.hourDetailKeepDays ?? 7 }) }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            class="tabs-box tabs tabs-xs"
          >
            <a
              role="tab"
              class="tab"
              :class="tab === 'clients' && 'tab-active'"
              @click="tab = 'clients'"
            >
              {{ $t('trafficByClient') }} ({{ detail.clientsCount }})
            </a>
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
            v-if="tab !== 'nodes'"
            v-model="filter"
            class="w-56"
            :placeholder="$t('search')"
            :clearable="true"
          />
        </div>
        <div class="app-plain-table bg-base-200/50 overflow-x-auto rounded-lg">
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
              <!-- 每一行点开看构成;访问目标 / 终端设备的前 10 条之外合并成「其他」,行尾展开/收起 -->
              <template
                v-for="e in entries"
                :key="e.type === 'row' ? e.row.key : 'rest'"
              >
                <TrafficDetailRow
                  v-if="e.type === 'row'"
                  :row="e.row"
                  :share="share(e.row)"
                  :expanded="expandedKey === e.row.key"
                  :day="selectedDay || ''"
                  :hour="selectedHour"
                  :kind="KIND_OF[tab]"
                  :dims="DRILL_DIMS[tab]"
                  @toggle="toggleRow(e.row.key)"
                />
                <tr
                  v-else
                  class="text-base-content/70"
                >
                  <td>
                    <span class="inline-flex items-center gap-2">
                      {{ $t('trafficOthersCount', { n: restRows.length }) }}
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs whitespace-nowrap"
                        @click="restExpanded = !restExpanded"
                      >
                        {{ $t(restExpanded ? 'trafficCollapseRest' : 'trafficExpandRest') }}
                        <ChevronUpIcon
                          v-if="restExpanded"
                          class="h-3.5 w-3.5"
                        />
                        <ChevronDownIcon
                          v-else
                          class="h-3.5 w-3.5"
                        />
                      </button>
                    </span>
                  </td>
                  <td class="text-right tabular-nums">{{ fmt(restSummary.down) }}</td>
                  <td class="text-right tabular-nums">{{ fmt(restSummary.up) }}</td>
                  <td class="text-right tabular-nums">{{ fmt(restSummary.up + restSummary.down) }}</td>
                  <td>
                    <div class="flex items-center gap-2">
                      <progress
                        class="progress w-24"
                        :value="share(restSummary)"
                        max="100"
                      />
                      <span class="w-10 text-xs tabular-nums">{{ share(restSummary) }}%</span>
                    </div>
                  </td>
                </tr>
              </template>
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
              <tr v-if="!rows.length && !(tab === 'nodes' && otherTotal > 0)">
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
  type OpenboxTrafficDim,
  type OpenboxTrafficMonth,
  type OpenboxTrafficRow,
} from '@/api/openbox'
import TextInput from '@/components/common/TextInput.vue'
import TrafficDetailRow from '@/components/overview/TrafficDetailRow.vue'
import HourlyTrafficChart from '@/components/overview/HourlyTrafficChart.vue'
import { prettyBytesHelper } from '@/helper/utils'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  InformationCircleIcon,
} from '@heroicons/vue/24/outline'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { trafficCountDirect } from '@/store/settings'
import { getNowProxyNodeName } from '@/store/proxies'
import { isFailoverInternalTag } from '@/store/openboxFailover'
import { useI18n } from 'vue-i18n'

// 柱子区高度、柱顶数值行高、底部日期行高(px),日均线的定位要和这几个数对齐
const CHART_H = 160
const LABEL_H = 18
const AXIS_H = 20
// 访问目标 / 终端设备默认只展示前 10 条,其余合并成「其他」,点开才展开
const TOP_N = 10
type Tab = 'clients' | 'nodes' | 'hosts'
// 页签对应后端的维度名,以及点开一行后能按哪几维拆(第一个是默认页签)
const KIND_OF: Record<Tab, OpenboxTrafficDim> = { clients: 'client', nodes: 'node', hosts: 'host' }
const DRILL_DIMS: Record<Tab, OpenboxTrafficDim[]> = {
  clients: ['host', 'node'],
  nodes: ['client', 'host'],
  hosts: ['client', 'node'],
}

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
// 点了曲线上的某个小时:下面的明细只看那个小时(服务端按「天@小时」那份取),null 是整天
const selectedHour = ref<number | null>(null)
const hourLabel = (h: number) => `${pad2(h)}:00–${pad2(h)}:59`
// 今天的曲线只画到这个小时(明细一刷新就跟着刷新,不用另起定时器)
const currentHour = computed(() => (detail.value ? new Date().getHours() : 23))
const tab = ref<Tab>('clients')
const filter = ref('')
// 当前点开看构成的那一行(同一时间只开一行)
const expandedKey = ref<string | null>(null)
const toggleRow = (key: string) => {
  expandedKey.value = expandedKey.value === key ? null : key
}

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

// 选中那根柱子(图例里的进站 / 出站数值取它,月数据一到就有,不用等明细)
const selectedBar = computed(() => days.value.find((d) => d.day === selectedDay.value) ?? null)

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

// 请求序号:30 秒一次的静默轮询和用户的切换会交错,晚到的旧响应不能盖掉新状态
// (轮询在途时点「上月」,轮询回来会把月份改回当月、再把选中的日子重置成今天)
let monthSeq = 0
let daySeq = 0

const loadDay = async (day: string | null) => {
  const seq = ++daySeq
  if (!day) {
    detail.value = null
    return
  }
  const hour = selectedHour.value
  try {
    const data = await fetchTrafficDay(day, 500, hour, trafficCountDirect.value)
    if (seq !== daySeq || selectedDay.value !== day || selectedHour.value !== hour) return
    detail.value = data
  } catch (e) {
    if (seq !== daySeq) return
    error.value = errorText(e)
  }
}

const loadMonth = async (m?: string, { silent = false } = {}) => {
  const seq = ++monthSeq
  if (!silent) loading.value = true
  try {
    const data = await fetchTrafficMonth(m, trafficCountDirect.value)
    if (seq !== monthSeq) return
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
    if (seq !== monthSeq) return
    error.value = errorText(e)
  } finally {
    if (seq === monthSeq) loading.value = false
  }
}

const shiftMonth = (delta: number) => {
  if (!month.value) return
  if (delta > 0 && !canGoNext.value) return
  selectedDay.value = null
  selectedHour.value = null
  void loadMonth(addMonths(month.value, delta))
}

const pick = (d: DayBar) => {
  if (d.future) return
  selectedDay.value = d.day
  selectedHour.value = null
  void loadDay(d.day)
}
const selectHour = (h: number) => {
  if (selectedHour.value === h) return
  selectedHour.value = h
  void loadDay(selectedDay.value)
}
const backToDay = () => {
  selectedHour.value = null
  void loadDay(selectedDay.value)
}

const rows = computed(() => {
  const d = detail.value
  if (!d) return []
  // 故障转移的多节点页签在旧版本的流量记录里可能以 __fo:...:lane-... 作为节点键。
  // 内核当前的 /proxies 已经能解析出页签内实际选中的叶子节点；在展示层把这类历史行
  // 归并到真实节点，避免概览暴露内部标签，也避免同一真实节点拆成两行。
  const list = tab.value === 'nodes' ? mergeFailoverNodeRows(d.nodes) : tab.value === 'hosts' ? d.hosts : d.clients
  const q = filter.value.trim().toLowerCase()
  return q ? list.filter((r) => r.key.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q)) : list
})

const mergeFailoverNodeRows = (source: OpenboxTrafficRow[]) => {
  if (!source.length) return source
  const merged = new Map<string, OpenboxTrafficRow>()
  for (const row of source) {
    const key = isFailoverInternalTag(row.key) ? getNowProxyNodeName(row.key) : row.key
    const target = key || row.key
    const prev = merged.get(target)
    if (!prev) {
      merged.set(target, { ...row, key: target })
      continue
    }
    merged.set(target, {
      ...prev,
      up: prev.up + row.up,
      down: prev.down + row.down,
      conns: prev.conns + row.conns,
    })
  }
  return [...merged.values()].sort((a, b) => (b.up + b.down) - (a.up + a.down) || a.key.localeCompare(b.key))
}
const restExpanded = ref(false)
// 换页签、换日期、改搜索词都收回去
watch([tab, selectedDay, selectedHour, filter], () => {
  restExpanded.value = false
  expandedKey.value = null
})
const visibleRows = computed(() => (tab.value === 'nodes' ? rows.value : rows.value.slice(0, TOP_N)))
const restRows = computed(() => (tab.value === 'nodes' ? [] : rows.value.slice(TOP_N)))
type Entry = { type: 'row'; row: OpenboxTrafficRow } | { type: 'rest' }
const entries = computed<Entry[]>(() => {
  const list: Entry[] = visibleRows.value.map((row) => ({ type: 'row', row }))
  if (!restRows.value.length) return list
  list.push({ type: 'rest' })
  if (restExpanded.value) for (const row of restRows.value) list.push({ type: 'row', row })
  return list
})
const restSummary = computed(() =>
  restRows.value.reduce(
    (acc, r) => ({ up: acc.up + r.up, down: acc.down + r.down, conns: acc.conns + r.conns }),
    { up: 0, down: 0, conns: 0 },
  ),
)
const hiddenRows = computed(() => {
  const clientHidden = 0
  const d = detail.value
  const serverHidden =
    d && !filter.value.trim()
      ? tab.value === 'hosts'
        ? Math.max(0, d.hostsCount - d.hosts.length)
        : tab.value === 'clients'
          ? Math.max(0, d.clientsCount - d.clients.length)
          : 0
      : 0
  return clientHidden + serverHidden
})
const detailTotal = computed(() => (detail.value ? detail.value.total.up + detail.value.total.down : 0))
const otherTotal = computed(() => (detail.value ? detail.value.other.up + detail.value.other.down : 0))
// 选了小时但一条明细都没有(小时明细从升级后才开始记、只留最近几天):说一声,别让人以为坏了
const hourDetailMissing = computed(() => {
  const d = detail.value
  return Boolean(d && selectedHour.value !== null && detailTotal.value > 0 && !d.nodes.length && !d.clientsCount && !d.hostsCount)
})
const share = (r: { up: number; down: number }) =>
  detailTotal.value > 0 ? Math.round(((r.up + r.down) / detailTotal.value) * 100) : 0

let timer: ReturnType<typeof setInterval> | null = null
// 开关一变整月和当天都重新拉(服务端按开关扣或不扣直连)
watch(trafficCountDirect, () => {
  void loadMonth(month.value || undefined)
})
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
