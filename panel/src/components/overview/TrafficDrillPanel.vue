<template>
  <!-- 一条流量记录的构成:页签切换按哪一维拆(终端设备 / 节点 / 访问目标),占比相对这条记录本身 -->
  <div class="flex flex-col gap-2">
    <div
      role="tablist"
      class="tabs-box tabs tabs-xs w-fit"
    >
      <a
        v-for="d in dims"
        :key="d"
        role="tab"
        class="tab"
        :class="by === d && 'tab-active'"
        @click="by = d"
      >
        {{ dimLabel(d) }}<template v-if="cache[d]"> ({{ cache[d]!.count }})</template>
      </a>
    </div>
    <!-- 卡片内边距用全局统一的 app-card-inset;表格密度和外层主表一致(table-sm),不再用更紧的 table-xs -->
    <div class="app-plain-table app-card-inset bg-base-100/60 overflow-x-auto rounded-lg">
      <table class="table-sm table">
        <thead>
          <tr class="text-base-content/60">
            <th>{{ $t('trafficName') }}</th>
            <th class="text-right">{{ $t('trafficIn') }}</th>
            <th class="text-right">{{ $t('trafficOut') }}</th>
            <th class="text-right">{{ $t('trafficTotal') }}</th>
            <th class="w-44">{{ $t('trafficShare') }}</th>
          </tr>
        </thead>
        <tbody>
          <template
            v-for="e in entries"
            :key="e.type === 'row' ? e.row.key : 'rest'"
          >
            <tr
              v-if="e.type === 'row'"
              class="hover"
            >
              <td
                class="max-w-[24rem] truncate"
                :title="e.row.key"
              >
                {{ e.row.key || '—' }}
                <span
                  v-if="trafficRowNote(e.row, t)"
                  class="text-base-content/60 ml-1"
                >{{ trafficRowNote(e.row, t) }}</span>
              </td>
              <td class="text-right tabular-nums">{{ fmt(e.row.down) }}</td>
              <td class="text-right tabular-nums">{{ fmt(e.row.up) }}</td>
              <td class="text-right tabular-nums">{{ fmt(e.row.up + e.row.down) }}</td>
              <td>
                <div class="flex items-center gap-2">
                  <progress
                    class="progress progress-primary w-24"
                    :value="share(e.row)"
                    max="100"
                  />
                  <span class="w-10 text-xs tabular-nums">{{ share(e.row) }}%</span>
                </div>
              </td>
            </tr>
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
          <!-- 父行总量减去构成合计 = 记录时还没有交叉明细(旧版本记的)或没采样到的部分 -->
          <tr
            v-if="unrecorded && unrecorded.up + unrecorded.down > 1024"
            class="text-base-content/60"
          >
            <td>
              <span class="inline-flex items-center gap-1">
                {{ $t('trafficDrillUnrecorded') }}
                <InformationCircleIcon
                  v-tip="$t('trafficDrillUnrecordedHint')"
                  class="h-3.5 w-3.5 cursor-help"
                />
              </span>
            </td>
            <td class="text-right tabular-nums">{{ fmt(unrecorded.down) }}</td>
            <td class="text-right tabular-nums">{{ fmt(unrecorded.up) }}</td>
            <td class="text-right tabular-nums">{{ fmt(unrecorded.up + unrecorded.down) }}</td>
            <td>
              <div class="flex items-center gap-2">
                <progress
                  class="progress w-24"
                  :value="share(unrecorded)"
                  max="100"
                />
                <span class="w-10 text-xs tabular-nums">{{ share(unrecorded) }}%</span>
              </div>
            </td>
          </tr>
          <tr v-if="loading && !current">
            <td
              colspan="5"
              class="text-center"
            >
              <span class="loading loading-spinner loading-xs" />
            </td>
          </tr>
          <tr v-else-if="error">
            <td
              colspan="5"
              class="text-error"
            >
              {{ error }}
            </td>
          </tr>
          <tr v-else-if="current && !current.rows.length">
            <td
              colspan="5"
              class="text-base-content/50"
            >
              {{ $t('trafficDrillEmpty') }}
            </td>
          </tr>
        </tbody>
      </table>
      <p
        v-if="hidden > 0"
        class="text-base-content/50 px-2 py-1 text-xs"
      >
        {{ $t('trafficDrillMore', { n: hidden }) }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  fetchTrafficDrill,
  type OpenboxTrafficDim,
  type OpenboxTrafficDrill,
  type OpenboxTrafficRow,
} from '@/api/openbox'
import { prettyBytesHelper } from '@/helper/utils'
import { trafficCountDirect } from '@/store/settings'
import { ChevronDownIcon, ChevronUpIcon, InformationCircleIcon } from '@heroicons/vue/24/outline'
import { trafficRowNote } from '@/helper/trafficName'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const TOP_N = 10

const props = defineProps<{
  day: string
  // 只看某个小时时是那个小时,整天是 null
  hour?: number | null
  kind: OpenboxTrafficDim
  itemKey: string
  // 可以拆成哪几维,第一个是默认页签
  dims: OpenboxTrafficDim[]
  // 这条记录自己的流量,占比按它算
  total: { up: number; down: number }
}>()

const { t } = useI18n()
const by = ref<OpenboxTrafficDim>(props.dims[0])
const cache = ref<Partial<Record<OpenboxTrafficDim, OpenboxTrafficDrill>>>({})
// 加载中 / 出错都按维度记:快速切页签时先发的请求回来不能把当前页签的 spinner 收掉或把错误贴过来
const loadingBy = ref<Partial<Record<OpenboxTrafficDim, boolean>>>({})
const errorBy = ref<Partial<Record<OpenboxTrafficDim, string>>>({})
const loading = computed(() => Boolean(loadingBy.value[by.value]))
const error = computed(() => errorBy.value[by.value] || '')
const restExpanded = ref(false)

const LABEL_KEY: Record<OpenboxTrafficDim, string> = {
  client: 'trafficByClient',
  node: 'trafficByNode',
  host: 'trafficByHost',
}
const dimLabel = (d: OpenboxTrafficDim) => t(LABEL_KEY[d])
const fmt = (n?: number) => prettyBytesHelper(Math.max(0, Math.round(n || 0)), { maximumFractionDigits: 1 })

const current = computed(() => cache.value[by.value])
const rows = computed<OpenboxTrafficRow[]>(() => current.value?.rows ?? [])
const restRows = computed(() => rows.value.slice(TOP_N))
const restSummary = computed(() =>
  restRows.value.reduce(
    (acc, r) => ({ up: acc.up + r.up, down: acc.down + r.down }),
    { up: 0, down: 0 },
  ),
)
type Entry = { type: 'row'; row: OpenboxTrafficRow } | { type: 'rest' }
const entries = computed<Entry[]>(() => {
  const head: Entry[] = rows.value.slice(0, TOP_N).map((row) => ({ type: 'row', row }))
  if (!restRows.value.length) return head
  head.push({ type: 'rest' })
  if (restExpanded.value) for (const row of restRows.value) head.push({ type: 'row', row })
  return head
})
const hidden = computed(() => (current.value ? Math.max(0, current.value.count - current.value.rows.length) : 0))
// 父行总量减去全部构成的合计(sum 不受 limit 影响);没有 sum 的老接口不算
const unrecorded = computed(() => {
  const s = current.value?.sum
  if (!s) return null
  return { up: Math.max(0, props.total.up - s.up), down: Math.max(0, props.total.down - s.down) }
})
const parentTotal = computed(() => props.total.up + props.total.down)
const share = (r: { up: number; down: number }) =>
  parentTotal.value > 0 ? Math.min(100, Math.round(((r.up + r.down) / parentTotal.value) * 100)) : 0

const load = async () => {
  const dim = by.value
  if (cache.value[dim] || loadingBy.value[dim]) return
  loadingBy.value = { ...loadingBy.value, [dim]: true }
  errorBy.value = { ...errorBy.value, [dim]: '' }
  try {
    cache.value[dim] = await fetchTrafficDrill(props.day, props.kind, props.itemKey, dim, 200, props.hour ?? null, trafficCountDirect.value)
  } catch (e) {
    errorBy.value = { ...errorBy.value, [dim]: e instanceof Error ? e.message : String(e) }
  } finally {
    loadingBy.value = { ...loadingBy.value, [dim]: false }
  }
}
watch(
  by,
  () => {
    restExpanded.value = false
    void load()
  },
  { immediate: true },
)

// 「统计直连流量」开关变了:服务端扣不扣直连的结果不一样,缓存作废、当前这一维重新拉
watch(trafficCountDirect, () => {
  cache.value = {}
  void load()
})
</script>
