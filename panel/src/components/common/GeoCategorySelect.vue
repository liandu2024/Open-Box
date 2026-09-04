<template>
  <!-- geosite/geoip 的值选择器。列表就是 Open-Box 真正会去下载的那两个仓库里有的
       规则集(见 constant/geo-catalog.ts),所以这里是下拉框而不是输入框:手打一个
       上游没有的名字,部署会卡在"拉规则集"那一步,而那时错误离这里已经很远了。 -->
  <div class="w-full">
    <div
      ref="triggerRef"
      role="button"
      tabindex="0"
      class="input input-sm hover:border-base-content/30 flex w-full cursor-pointer items-center gap-1.5 font-mono text-xs"
      @click="onTriggerClick"
      @keydown.enter.prevent="onTriggerClick"
    >
      <span
        class="min-w-0 flex-1 truncate text-left"
        :class="{ 'text-base-content/40': !modelValue }"
      >
        {{ modelValue || placeholder }}
      </span>
      <span
        v-if="currentNote"
        class="text-base-content/50 hidden max-w-[45%] truncate font-sans sm:block"
      >
        {{ currentNote }}
      </span>
      <ChevronDownIcon class="text-base-content/40 h-3.5 w-3.5 shrink-0" />
    </div>

    <!-- 面板挂到 #app-content:留在原地会被弹窗的 overflow 裁掉(见 composables/anchoredDropdown.ts) -->
    <Teleport to="#app-content">
      <div
        v-if="open"
        ref="panelRef"
        class="app-popover border-base-content/10 z-[1000] flex flex-col rounded-lg border p-2 shadow-lg"
        :style="style"
      >
        <!-- geoip 的目录里国家地区码和按服务的 IP 段混在一起:给个范围下拉,搜索框相应缩窄 -->
        <div class="flex items-center gap-2">
          <TextInput
            v-model="keyword"
            class="min-w-0 flex-1"
            :placeholder="$t('geoCategorySearch')"
            clearable
          />
          <select
            v-if="kind === 'geoip'"
            v-model="scope"
            class="select select-sm w-24 shrink-0"
          >
            <option value="all">{{ $t('geoScopeAll') }}</option>
            <option value="region">{{ $t('geoScopeRegion') }}</option>
            <option value="other">{{ $t('geoScopeOther') }}</option>
          </select>
        </div>
        <ul
        ref="listRef"
        class="mt-1 min-h-0 flex-1 overflow-y-auto"
        @scroll.passive="onScroll"
      >
          <li
            v-if="loading"
            class="text-base-content/50 px-2 py-3 text-center text-xs"
          >
            <span class="loading loading-spinner loading-xs" />
          </li>
          <li
            v-for="row in visible"
            :key="row[0]"
          >
            <!-- 名字一行、说明一行:说明是选这条的依据,不能截断 -->
            <button
              type="button"
              class="hover:bg-base-200 flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left"
              :class="{ 'bg-base-200': row[0] === modelValue }"
              :data-active="row[0] === modelValue"
              @click="choose(row[0])"
            >
              <span class="font-mono text-xs">{{ row[0] }}</span>
              <span
                v-if="note(row)"
                class="text-base-content/60 text-xs leading-snug whitespace-normal"
              >{{ note(row) }}</span>
            </button>
          </li>
          <li
            v-if="!loading && !visible.length"
            class="text-base-content/50 px-2 py-3 text-center text-xs"
          >
            {{ $t('geoCategoryNoMatch') }}
          </li>
          <!-- 滚到底自动续下一批;这行本身就是"还没到底"的记号 -->
          <li
            v-else-if="hiddenCount > 0"
            class="text-base-content/50 px-2 py-2 text-center text-xs"
          >
            {{ $t('geoCategoryMore', { count: hiddenCount }) }}
          </li>
        </ul>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import TextInput from '@/components/common/TextInput.vue'
import { useAnchoredDropdown } from '@/composables/anchoredDropdown'
import type { GeoCategoryRow } from '@/constant/geo-catalog'
import { composeGeoNote } from '@/helper/geoCatalog'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue: string
  kind: 'geosite' | 'geoip'
  placeholder?: string
  // 同一个站点集里别的规则已经选了的分类:不再列出来,免得同一个集加两遍
  exclude?: string[]
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const { locale, t } = useI18n()

// 一批渲染这么多条:geosite 有 1800+ 条,一次性全画出来光 DOM 就够卡一下的。
// 往下滚到底就自动续一批,所以不是"只能看 60 条",只是不一次性画完。
const PAGE_SIZE = 60

// 目录 176KB,按需加载:不打开这个下拉框的人不该为它付流量。
// 模块级缓存,同一页里几十行规则只会加载一次。
const cache = { geosite: [] as readonly GeoCategoryRow[], geoip: [] as readonly GeoCategoryRow[] }
const rows = ref<readonly GeoCategoryRow[]>(cache[props.kind])
const loading = ref(false)

const { open, triggerRef, panelRef, style, toggle, close, focusAndReveal } = useAnchoredDropdown({ minWidth: 320 })

const ensureLoaded = async () => {
  if (rows.value.length || loading.value) return
  loading.value = true
  try {
    const mod = await import('@/constant/geo-catalog')
    cache.geosite = mod.GEOSITE_CATEGORIES
    cache.geoip = mod.GEOIP_CATEGORIES
    rows.value = cache[props.kind]
  } finally {
    loading.value = false
  }
}
// 换类型(geosite ↔ geoip)时换一份表;已经加载过就直接换,不再请求
watch(
  () => props.kind,
  (kind) => {
    rows.value = cache[kind]
  },
)

const keyword = ref('')

// 说明的取法(按语言挑列、@属性子集拼基名说明)在 helper/geoCatalog.ts,和详情弹窗共用
const noteByName = computed(() => new Map(rows.value.map((r) => [r[0], r])))
const note = (row: GeoCategoryRow): string => composeGeoNote(row, noteByName.value, locale.value, t)

const currentNote = computed(() => {
  const hit = rows.value.find((r) => r[0] === props.modelValue)
  return hit ? note(hit) : ''
})

// 按匹配度排:同名的排最前。搜 cn 时,clearasil@cn、cloudflare-cn 这些也含 "cn",
// 按字母序排的话真正想要的那条 `cn` 会被埋在中间——名字完全相同的必须第一个。
//   0 完全同名        cn
//   1 同名的属性变体   cn@ads
//   2 名字以它开头     cnbc
//   3 名字里含它       cloudflare-cn
//   4 只有说明命中     搜「奈飞」命中 netflix 的中文说明
const scoreOf = (row: GeoCategoryRow, kw: string) => {
  const name = row[0].toLowerCase()
  if (name === kw) return 0
  if (name.startsWith(`${kw}@`)) return 1
  if (name.startsWith(kw)) return 2
  if (name.includes(kw)) return 3
  return 4
}

// 名称、中文、英文、繁体一起参与检索。注意说明是一句描述、不是别名表:搜 netflix 或
// 「流媒体」能找到 geosite:netflix,搜「奈飞」找不到——它的说明里没这两个字。
const excluded = computed(() => new Set((props.exclude || []).filter((v) => v && v !== props.modelValue)))
// geoip 的范围:地区 = 两位国家地区码(ad、cn、us…),其他 = 按服务的 IP 段(cloudflare、telegram…)
const scope = ref<'all' | 'region' | 'other'>('all')
const isRegion = (row: GeoCategoryRow) => /^[a-z]{2}$/i.test(row[0])
const candidates = computed(() => {
  let list = excluded.value.size ? rows.value.filter((r) => !excluded.value.has(r[0])) : rows.value
  if (props.kind === 'geoip' && scope.value !== 'all') {
    list = list.filter((r) => (scope.value === 'region' ? isRegion(r) : !isRegion(r)))
  }
  return list
})

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return candidates.value
  const hits = candidates.value.filter((r) => r.some((cell) => (cell || '').toLowerCase().includes(kw)))
  // 同档之内短的排前面(cn@ads 先于 cnbeta@ads),再按原顺序稳定收尾
  return hits
    .map((row, index) => ({ row, index, score: scoreOf(row, kw) }))
    .sort((a, b) => a.score - b.score || a.row[0].length - b.row[0].length || a.index - b.index)
    .map((x) => x.row)
})
const shown = ref(PAGE_SIZE)
const listRef = ref<HTMLElement | null>(null)

const visible = computed(() => filtered.value.slice(0, shown.value))
const hiddenCount = computed(() => Math.max(0, filtered.value.length - shown.value))

// 快到底了就再放一批出来。阈值给 80px:等真滚到底再加载,手感上会顿一下。
const onScroll = () => {
  const el = listRef.value
  if (!el || hiddenCount.value <= 0) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) shown.value += PAGE_SIZE
}

// 换关键词/换类型就从头来:上一次滚到第 600 条,不该影响新结果
watch([keyword, scope, () => props.kind], () => {
  shown.value = PAGE_SIZE
  if (listRef.value) listRef.value.scrollTop = 0
})

// 这里刻意不给「直接使用手打的值」那条路:名单就是上游真有的那些,打一个不存在的
// 名字面板这边一点反应都没有,直到部署时卡在"拉规则集"——错误离犯错的地方太远了。
// 上游加了新分类,重跑 scripts/gen-geo-catalog.mjs 刷新名单即可。

// 名单是分批渲染的(PAGE_SIZE 一批),选中的那条可能排在第几百位——先把它所在的那一批
// 放出来,焦点和居中滚动才有东西可落。目录是按需加载的,所以要等 ensureLoaded 完再来一次。
const revealSelected = () => {
  const index = props.modelValue ? filtered.value.findIndex((r) => r[0] === props.modelValue) : -1
  if (index >= shown.value) shown.value = (Math.floor(index / PAGE_SIZE) + 1) * PAGE_SIZE
  focusAndReveal()
}

const onTriggerClick = () => {
  toggle()
  if (!open.value) return
  revealSelected()
  void ensureLoaded().then(revealSelected)
}

const choose = (value: string) => {
  emit('update:modelValue', value)
  scope.value = 'all'
  keyword.value = ''
  close()
}
</script>
