<template>
  <DialogWrapper
    v-model="show"
    :title="$t(editing?.id ? 'groupEditTitle' : 'groupAddTitle')"
    box-class="w-full max-w-2xl"
  >
    <div
      v-if="draft"
      class="flex flex-col gap-4"
    >
      <div class="flex items-end gap-2">
        <!-- 图标:和地区关键词那边同一个国旗选择器。节点组多半就是按国家/地区分的
             (香港-自动、台湾-自动),给它配一面旗,列表里一眼就找得到。 -->
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('groupIconLabel') }}</label>
          <!-- w-56:公司名(Google 云端硬盘)和通用图标名(拒绝(停止))比国名长得多,窄了就截断 -->
          <div class="w-56">
            <CountrySelect
              v-model="draft.icon"
              clearable
              globes
              brands
              :placeholder="$t('groupIconNone')"
            />
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('iconScaleLabel') }}</label>
          <IconScaleInput v-model="draft.iconScale" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('groupNameLabel') }}</label>
          <input
            v-model="draft.name"
            type="text"
            class="input input-sm w-full"
          />
        </div>
      </div>

      <div class="flex flex-wrap items-end gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('groupTypeLabel') }}</label>
          <select
            v-model="draft.type"
            class="select select-sm"
          >
            <option value="urltest">{{ $t('groupType_urltest') }}</option>
            <option value="selector">{{ $t('groupType_selector') }}</option>
          </select>
        </div>
        <!-- 检测间隔/容差只对 urltest 有意义:selector 是手动选,不会自己去测 -->
        <template v-if="draft.type === 'urltest'">
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupInterval') }}</label>
            <div class="flex items-center gap-1">
              <input
                v-model.number="intervalMinutes"
                type="number"
                min="1"
                class="input input-sm w-20"
              />
              <span class="text-base-content/60 text-xs">{{ $t('groupUnitMinute') }}</span>
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupTolerance') }}</label>
            <div class="flex items-center gap-1">
              <input
                v-model.number="draft.tolerance"
                type="number"
                min="0"
                class="input input-sm w-20"
              />
              <span class="text-base-content/60 text-xs">{{ $t('groupUnitMs') }}</span>
            </div>
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupTestUrl') }}</label>
            <input
              v-model="draft.testUrl"
              type="url"
              class="input input-sm w-full font-mono text-xs"
              :placeholder="$t('groupTestUrlPlaceholder')"
            />
          </div>
        </template>
      </div>
      <!-- 成员怎么来:动态组按关键词现算,静态组手工挑。放在这儿是因为下面整块
           (穿梭框 / 关键词框)都归它管。 -->
      <div
        role="tablist"
        class="tabs-box tabs tabs-sm w-fit"
      >
        <a
          role="tab"
          :class="['tab', draft.mode === 'dynamic' && 'tab-active']"
          @click="draft.mode = 'dynamic'"
        >
          {{ $t('groupModeDynamic') }}
        </a>
        <a
          role="tab"
          :class="['tab', draft.mode === 'static' && 'tab-active']"
          @click="draft.mode = 'static'"
        >
          {{ $t('groupModeStatic') }}
        </a>
      </div>

      <!-- 左右穿梭:左边是还没选的,右边是已选的,中间两个箭头搬运勾中的条目。
           每行的勾选框只表示"这条要不要搬",与"选没选中它当成员"是两回事——后者
           由它在左边还是右边表示,所以不会出现"几十个节点混在一列里看不出选了谁"
           的老问题。行末的 › ‹ 是单条快捷键:不用先勾再按箭头,一下就挪过去。 -->
      <div
        v-if="draft.mode === 'static'"
        class="grid grid-cols-[1fr_auto_1fr] gap-3"
      >
          <div class="border-base-content/10 flex min-h-0 flex-col rounded-lg border">
            <div class="border-base-content/10 flex flex-col gap-1 border-b px-2 py-1.5">
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium whitespace-nowrap">
                  {{ $t('groupAvailable') }} ({{ availableCandidates.length }})
                </span>
                <input
                  v-model="memberFilter"
                  type="text"
                  class="input input-xs min-w-0 flex-1"
                  :placeholder="$t('groupMemberFilter')"
                />
              </div>
              <BulkPick
                v-model:subscription="memberSub"
                :subscriptions="subscriptionOptions"
                @select-all="tickAll('available')"
                @invert="tickInvert('available')"
                @clear="tickNone('available')"
              />
            </div>
            <div class="max-h-64 overflow-y-auto">
              <p
                v-if="!filteredAvailable.length"
                class="text-base-content/50 p-3 text-center text-xs"
              >
                {{ $t('groupNoCandidates') }}
              </p>
              <label
                v-for="item in filteredAvailable"
                :key="item.kind + item.name"
                class="hover:bg-base-200/60 flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm"
              >
                <input
                  v-model="checkedAvailable"
                  type="checkbox"
                  class="checkbox checkbox-xs shrink-0"
                  :value="item.name"
                />
                <span class="truncate">{{ item.name }}</span>
                <span
                  v-if="item.kind === 'group'"
                  class="badge badge-ghost badge-xs"
                >{{ $t('groupsTab') }}</span>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs ml-auto shrink-0 px-1"
                  v-tip="$t('groupMoveRight')"
                  @click.prevent="addMember(item.name)"
                >
                  <ChevronRightIcon class="text-base-content/30 h-4 w-4" />
                </button>
              </label>
            </div>
          </div>

          <!-- 中间的搬运按钮:把勾中的条目整批挪过去。没勾任何东西时置灰,
               免得按下去什么都不发生还以为是坏的。 -->
          <div class="flex flex-col items-center justify-center gap-2">
            <button
              type="button"
              class="btn btn-sm btn-square"
              :disabled="!checkedAvailable.length"
              v-tip="$t('groupMoveRight')"
              @click="moveRight"
            >
              <ChevronRightIcon class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="btn btn-sm btn-square"
              :disabled="!checkedSelected.length"
              v-tip="$t('groupMoveLeft')"
              @click="moveLeft"
            >
              <ChevronLeftIcon class="h-4 w-4" />
            </button>
          </div>

          <div class="border-base-content/10 flex min-h-0 flex-col rounded-lg border">
            <div class="border-base-content/10 flex flex-col gap-1 border-b px-2 py-1.5">
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium whitespace-nowrap">
                  {{ $t('groupSelected') }} ({{ draft.members.length }})
                </span>
                <input
                  v-model="selectedFilter"
                  type="text"
                  class="input input-xs min-w-0 flex-1"
                  :placeholder="$t('groupMemberFilter')"
                />
              </div>
              <BulkPick
                v-model:subscription="selectedSub"
                :subscriptions="subscriptionOptions"
                @select-all="tickAll('selected')"
                @invert="tickInvert('selected')"
                @clear="tickNone('selected')"
              />
            </div>
            <div class="max-h-64 overflow-y-auto">
              <p
                v-if="!filteredSelected.length"
                class="text-base-content/50 p-3 text-center text-xs"
              >
                {{ $t('groupNoSelected') }}
              </p>
              <label
                v-for="name in filteredSelected"
                :key="name"
                class="hover:bg-base-200/60 flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm"
              >
                <input
                  v-model="checkedSelected"
                  type="checkbox"
                  class="checkbox checkbox-xs shrink-0"
                  :value="name"
                />
                <button
                  type="button"
                  class="btn btn-ghost btn-xs shrink-0 px-1"
                  v-tip="$t('groupMoveLeft')"
                  @click.prevent="removeMember(name)"
                >
                  <ChevronLeftIcon class="text-base-content/30 h-4 w-4" />
                </button>
                <span class="truncate">{{ name }}</span>
              </label>
            </div>
          </div>
      </div>

      <!-- 动态组:成员不落名单,只存关键词,生成配置时按当前节点现算。这样以后新加
           的订阅,只要节点名命中关键词,下次部署就自动进这个组,不用回来重勾一遍。
           下面实时列出"按现在的节点会选中谁",免得关键词写完还得靠猜。 -->
      <div
        v-else
        class="flex flex-col gap-2"
      >
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('groupKeywordsLabel') }}</label>
          <input
            v-model="keywordsText"
            type="text"
            class="input input-sm w-full"
            :placeholder="$t('groupKeywordsPlaceholder')"
          />
          <p class="text-base-content/50 text-xs">{{ $t('groupKeywordsHint') }}</p>
        </div>
        <div class="border-base-content/10 rounded-lg border">
          <div class="border-base-content/10 border-b px-3 py-1.5 text-xs font-medium">
            {{ $t('groupDynamicMatched', { count: dynamicMatched.length }) }}
          </div>
          <div class="max-h-56 overflow-y-auto">
            <p
              v-if="!dynamicMatched.length"
              class="text-base-content/50 p-3 text-center text-xs"
            >
              {{ $t('groupDynamicNoMatch') }}
            </p>
            <div
              v-for="name in dynamicMatched"
              :key="name"
              class="px-3 py-1.5 text-sm"
            >
              <span class="truncate">{{ name }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="btn btn-sm"
          @click="show = false"
        >
          {{ $t('cancel') }}
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="saving"
          @click="saveDraft"
        >
          <span
            v-if="saving"
            class="loading loading-spinner loading-xs"
          />
          {{ $t('subscriptionSave') }}
        </button>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import type { OpenboxUserGroup } from '@/api/openbox'
import { fetchNodeGroups, saveNodeGroups } from '@/api/openbox'
import BulkPick from '@/components/subscription/BulkPick.vue'
import CountrySelect from '@/components/common/CountrySelect.vue'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import IconScaleInput from '@/components/common/IconScaleInput.vue'
import {
  matchedNodeNames,
  notifyGroupError,
  reportGroupSaveResult,
  type NodeGroupSaveResult,
} from '@/components/subscription/nodeGroupsShared'
import { showNotification } from '@/helper/notification'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'

// 添加/修改一个分组的弹窗。原来长在节点管理列表(NodeGroupsPanel)里;代理页的节点
// 卡片上也要能就地改一个组,所以抽出来,自己拉数据、自己保存,两处都只管 open()。
// 保存成功后 emit('saved', 服务端返回的整份结果),父组件要更新列表就用它。
const emit = defineEmits<{
  saved: [res: NodeGroupSaveResult]
}>()

const show = ref(false)
const editing = ref<OpenboxUserGroup | null>(null)
const draft = ref<OpenboxUserGroup | null>(null)
const memberFilter = ref('')
const selectedFilter = ref('')
// 两栏各自的订阅下拉框,'' = 全部
const memberSub = ref('')
const selectedSub = ref('')
// 两栏各自的勾选状态(按名字记)。勾选 ≠ 成员:勾只表示"这条要不要被箭头搬走"。
const checkedAvailable = ref<string[]>([])
const checkedSelected = ref<string[]>([])
const saving = ref(false)

// 候选成员和"重名"检查都要整份组列表和节点池;每次打开现拉一遍,不依赖父组件手里
// 那份(代理页上根本没有节点池)。
const groups = ref<OpenboxUserGroup[]>([])
const availableNodes = ref<Array<{ name: string; subscription: string }>>([])
let loading: Promise<void> | null = null
const load = async () => {
  try {
    const data = await fetchNodeGroups()
    groups.value = data.groups
    availableNodes.value = data.availableNodes
  } catch (err) {
    notifyGroupError(err)
  }
}

const open = (group: OpenboxUserGroup | null) => {
  editing.value = group
  // 深拷贝:直接编辑列表里的对象会让"取消"也留下改动
  // 新建默认静态组:新建一个组多半是为了挑几个特定节点,默认成"不带关键词的动态组"
  // 等于一上来就把全部节点圈进去,不是人想要的。
  draft.value = group
    ? JSON.parse(JSON.stringify(group))
    : {
        id: '',
        name: '',
        type: 'urltest',
        mode: 'static',
        icon: '',
        keywords: [],
        members: [],
        interval: '5m',
        tolerance: 100,
        testUrl: '',
      }
  // 老记录可能没有这几个字段(服务端读的时候会补,但这里编辑的是本地副本)
  if (draft.value) {
    if (!draft.value.mode) draft.value.mode = 'static'
    if (!draft.value.keywords) draft.value.keywords = []
    if (draft.value.icon === undefined) draft.value.icon = ''
  }
  memberFilter.value = ''
  selectedFilter.value = ''
  memberSub.value = ''
  selectedSub.value = ''
  checkedAvailable.value = []
  checkedSelected.value = []
  loading = load()
  show.value = true
}

// 候选成员 = 所有节点 + 除自己以外的其它组(组可以套组,但不能套自己)
const candidates = computed(() => {
  const nodeItems = availableNodes.value.map((n) => ({
    kind: 'node' as const, name: n.name, subscription: n.subscription,
  }))
  const groupItems = groups.value
    .filter((g) => g.name !== draft.value?.name)
    .map((g) => ({ kind: 'group' as const, name: g.name, subscription: '' }))
  return [...groupItems, ...nodeItems]
})

// 订阅下拉框的选项:节点实际来自的订阅,去重后按出现顺序排。空字符串(来源未知的
// 老节点)不进下拉框——给一个选不出东西的选项没有意义。
const subscriptionOptions = computed(() => {
  const seen: string[] = []
  for (const n of availableNodes.value) {
    if (n.subscription && !seen.includes(n.subscription)) seen.push(n.subscription)
  }
  return seen
})

// 一栏的"作用范围" = 该栏下拉框 + 过滤框共同框定的候选集。三个批量按钮就按这个
// 范围来:下拉框选中某条订阅、再按「全选」,勾中的正好是那条订阅的节点——这也是
// 加这个下拉框的用处。两个都不设时,范围就是整份候选集。
// 下拉框的值:'' 全部 / 'kind:group' 全部节点组 / 'kind:node' 全部节点 /
// 'sub:<订阅名>' 单条订阅(前缀见 BulkPick.vue 里的说明)。
const scopeOf = (sel: string, keyword: string) => {
  const kw = keyword.trim().toLowerCase()
  const matchKind = (item: { kind: string; subscription: string }) => {
    if (!sel) return true
    if (sel === 'kind:group') return item.kind === 'group'
    if (sel === 'kind:node') return item.kind === 'node'
    if (sel.startsWith('sub:')) return item.subscription === sel.slice(4)
    return true
  }
  return candidates.value.filter(
    (item) => matchKind(item) && (!kw || item.name.toLowerCase().includes(kw)),
  )
}

// 左侧只列"还没选的":选走一个左边就少一个,不必再靠打勾去分辨状态。
const availableCandidates = computed(() =>
  candidates.value.filter((item) => !draft.value?.members.includes(item.name)),
)

const filteredAvailable = computed(() => {
  const inScope = new Set(scopeOf(memberSub.value, memberFilter.value).map((c) => c.name))
  return availableCandidates.value.filter((item) => inScope.has(item.name))
})

const addMember = (name: string) => {
  if (!draft.value || draft.value.members.includes(name)) return
  draft.value.members = [...draft.value.members, name]
  checkedAvailable.value = checkedAvailable.value.filter((n) => n !== name)
}

const removeMember = (name: string) => {
  if (!draft.value) return
  draft.value.members = draft.value.members.filter((m) => m !== name)
  checkedSelected.value = checkedSelected.value.filter((n) => n !== name)
}

// 界面上填的是分钟数,存进去仍是 sing-box 认的 "3m" 形式。原来直接让用户手写
// "3m" 这种带单位的字符串:写成 "3" 或 "3分钟" 都会被内核当成非法值,而界面上看不出
// 哪种写法才对。
const intervalMinutes = computed<number>({
  get: () => {
    const m = /^(\d+)/.exec(draft.value?.interval || '')
    return m ? Number(m[1]) : 3
  },
  set: (v: number) => {
    if (!draft.value) return
    const n = Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1
    draft.value.interval = `${n}m`
  },
})

const filteredSelected = computed(() => {
  const list = draft.value?.members || []
  const inScope = new Set(scopeOf(selectedSub.value, selectedFilter.value).map((c) => c.name))
  return list.filter((name) => inScope.has(name))
})

// 三个批量动作改的是**勾选状态**,不是成员归属:成员归属由"在左边还是右边"表示,
// 勾选只回答"这条要不要被箭头搬走"。作用范围是按下它的那一栏**当前列出来的那些**
// (下拉框 + 过滤框筛过之后),所见即所动;栏外、被筛掉的一条都不动。
type Pane = 'available' | 'selected'
const visibleOf = (pane: Pane) =>
  pane === 'available' ? filteredAvailable.value.map((i) => i.name) : filteredSelected.value
const checkedOf = (pane: Pane) => (pane === 'available' ? checkedAvailable : checkedSelected)

const tickAll = (pane: Pane) => {
  const box = checkedOf(pane)
  box.value = [...new Set([...box.value, ...visibleOf(pane)])]
}
const tickNone = (pane: Pane) => {
  const box = checkedOf(pane)
  const visible = new Set(visibleOf(pane))
  box.value = box.value.filter((n) => !visible.has(n))
}
const tickInvert = (pane: Pane) => {
  const box = checkedOf(pane)
  const ticked = new Set(box.value)
  const visible = visibleOf(pane)
  const add = visible.filter((n) => !ticked.has(n))
  const remove = new Set(visible.filter((n) => ticked.has(n)))
  box.value = [...box.value.filter((n) => !remove.has(n)), ...add]
}

// 两个箭头:把勾中的整批搬到另一边,搬完清掉这一侧的勾(它们已经不在这一栏了)
const moveRight = () => {
  if (!draft.value) return
  const chosen = new Set(draft.value.members)
  draft.value.members = [
    ...draft.value.members,
    ...checkedAvailable.value.filter((n) => !chosen.has(n)),
  ]
  checkedAvailable.value = []
}
const moveLeft = () => {
  if (!draft.value) return
  const drop = new Set(checkedSelected.value)
  draft.value.members = draft.value.members.filter((n) => !drop.has(n))
  checkedSelected.value = []
}

// 关键词在界面上是一行逗号分隔的文本,存下去是数组
const keywordsText = computed({
  get: () => (draft.value?.keywords || []).join(','),
  set: (v: string) => {
    if (!draft.value) return
    draft.value.keywords = v
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
  },
})

// 按当前节点实时算一遍:关键词写完能立刻看到会选中谁,不用保存了再回来看
const dynamicMatched = computed(() =>
  draft.value ? matchedNodeNames(draft.value, availableNodes.value.map((n) => n.name)) : [],
)

const saveDraft = async () => {
  if (!draft.value || saving.value) return
  const name = draft.value.name.trim()
  if (!name) {
    showNotification({ content: 'groupNameRequired', type: 'alert-error' })
    return
  }
  // 动态组不需要成员名单:关键词为空就是"全部节点",本身是合法的一种组
  if (draft.value.mode === 'static' && !draft.value.members.length) {
    showNotification({ content: 'groupMembersRequired', type: 'alert-error' })
    return
  }

  saving.value = true
  try {
    // 整份覆盖式保存,得先拿到最新的组列表;正常情况打开弹窗时早就拉完了
    await loading
    // 组名就是 sing-box 的出站 tag,重名会生成两个同名出站——在这里就拦住,别等部署时才炸
    if (groups.value.some((g) => g.name === name && g.id !== draft.value?.id)) {
      showNotification({ content: 'groupNameDuplicate', type: 'alert-error' })
      return
    }
    const item: OpenboxUserGroup = { ...draft.value, name, id: draft.value.id || `g-${Date.now()}` }
    const next = editing.value
      ? groups.value.map((g) => (g.id === editing.value?.id ? item : g))
      : [...groups.value, item]
    const res = await saveNodeGroups(next)
    groups.value = res.groups
    reportGroupSaveResult(res)
    show.value = false
    emit('saved', res)
  } catch (err) {
    notifyGroupError(err)
  } finally {
    saving.value = false
  }
}

defineExpose({ open })
</script>
