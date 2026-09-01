<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <p class="text-base-content/60 text-xs">{{ $t('groupsHint') }}</p>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        @click="openEditor(null)"
      >
        <PlusIcon class="h-4 w-4" />
        {{ $t('groupAdd') }}
      </button>
    </div>

    <p
      v-if="error"
      class="text-error text-sm"
    >
      {{ error }}
    </p>

    <!-- 服务端把「按当前节点跑一遍」的结果一并返回。落地不了的组必须说出来:
         成员是按名字引用的,节点一改名(比如打开订阅名前缀)引用就会悬空,
         组会被静默丢掉——不提示的话,用户只会发现配置里少了个组,却不知道为什么。 -->
    <p
      v-for="item in dropped"
      :key="item.name"
      class="text-warning text-sm"
    >
      {{ $t(item.reason === 'cycle' ? 'groupDroppedCycle' : 'groupDroppedEmpty', { name: item.name }) }}
    </p>

    <div
      v-if="loading && !groups.length"
      class="flex justify-center py-10"
    >
      <span class="loading loading-spinner loading-md" />
    </div>

    <div
      v-else
      class="flex flex-col gap-2"
    >
      <div
        v-for="group in groups"
        :key="group.id"
        class="card bg-base-100 border-base-content/10 flex flex-row items-center gap-2 border p-3"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-base font-medium">{{ group.name }}</span>
            <span class="badge badge-outline badge-sm">{{ $t(`groupType_${group.type}`) }}</span>
          </div>
          <div class="text-base-content/60 mt-0.5 text-xs">
            {{ memberSummary(group) }}
            <template v-if="group.type === 'urltest'">
              · {{ $t('groupInterval') }} {{ group.interval }} · {{ $t('groupTolerance') }} {{ group.tolerance }}ms
            </template>
          </div>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-square btn-sm"
          :aria-label="$t('groupEdit')"
          @click="openEditor(group)"
        >
          <PencilSquareIcon class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-square btn-sm hover:text-error"
          :aria-label="$t('delete')"
          @click="removeGroup(group)"
        >
          <TrashIcon class="h-4 w-4" />
        </button>
      </div>
    </div>

    <DialogWrapper
      v-model="showEditor"
      :title="$t(editing?.id ? 'groupEditTitle' : 'groupAddTitle')"
      box-class="w-full max-w-2xl"
    >
      <div
        v-if="draft"
        class="flex flex-col gap-4"
      >
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('groupNameLabel') }}</label>
          <input
            v-model="draft.name"
            type="text"
            class="input input-sm w-full"
          />
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
          </template>
        </div>
        <p
          v-if="draft.type === 'urltest'"
          class="text-base-content/50 text-xs"
        >
          {{ $t('groupUrltestHint') }}
        </p>

        <div class="divider my-0" />

        <!-- 左右穿梭:左边是还没选的,右边是已选的。点一条就挪到另一边,不再用勾选框
             ——勾选框要靠"有没有打勾"去分辨选没选,几十个节点混在一列里根本看不出来
             自己到底选了哪些;拆成两栏后"已选"本身就是一份清单。 -->
        <div class="grid grid-cols-2 gap-3">
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
                  @select-all="selectAll(scopeOf(memberSub, memberFilter))"
                  @invert="invertSelection(scopeOf(memberSub, memberFilter))"
                  @clear="clearSelection(scopeOf(memberSub, memberFilter))"
                />
              </div>
              <div class="max-h-64 overflow-y-auto">
                <p
                  v-if="!filteredAvailable.length"
                  class="text-base-content/50 p-3 text-center text-xs"
                >
                  {{ $t('groupNoCandidates') }}
                </p>
                <button
                  v-for="item in filteredAvailable"
                  :key="item.kind + item.name"
                  type="button"
                  class="hover:bg-base-200/60 flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
                  @click="addMember(item.name)"
                >
                  <span class="truncate">{{ item.name }}</span>
                  <span
                    v-if="item.kind === 'group'"
                    class="badge badge-ghost badge-xs"
                  >{{ $t('groupsTab') }}</span>
                  <ChevronRightIcon class="text-base-content/30 ml-auto h-4 w-4 shrink-0" />
                </button>
              </div>
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
                  @select-all="selectAll(scopeOf(selectedSub, selectedFilter))"
                  @invert="invertSelection(scopeOf(selectedSub, selectedFilter))"
                  @clear="clearSelection(scopeOf(selectedSub, selectedFilter))"
                />
              </div>
              <div class="max-h-64 overflow-y-auto">
                <p
                  v-if="!filteredSelected.length"
                  class="text-base-content/50 p-3 text-center text-xs"
                >
                  {{ $t('groupNoSelected') }}
                </p>
                <button
                  v-for="name in filteredSelected"
                  :key="name"
                  type="button"
                  class="hover:bg-base-200/60 flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
                  @click="removeMember(name)"
                >
                  <ChevronLeftIcon class="text-base-content/30 h-4 w-4 shrink-0" />
                  <span class="truncate">{{ name }}</span>
                </button>
              </div>
            </div>
        </div>

        <p
          v-if="editorError"
          class="text-error text-sm"
        >
          {{ editorError }}
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showEditor = false"
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
  </div>
</template>

<script setup lang="ts">
import type { OpenboxUserGroup } from '@/api/openbox'
import { fetchNodeGroups, saveNodeGroups } from '@/api/openbox'
import BulkPick from '@/components/subscription/BulkPick.vue'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { routingPendingDeploy } from '@/store/routing'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/vue/24/outline'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const groups = ref<OpenboxUserGroup[]>([])
const availableNodes = ref<Array<{ name: string; subscription: string }>>([])
const loading = ref(false)
const error = ref('')
// 保存后服务端回报的「落地不了的组」,见模板里的说明
const dropped = ref<Array<{ name: string; reason: string }>>([])

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchNodeGroups()
    groups.value = data.groups
    availableNodes.value = data.availableNodes
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const memberSummary = (group: OpenboxUserGroup) =>
  group.allNodes
    ? t('groupAllNodesSummary', { count: availableNodes.value.length })
    : t('groupMembersSummary', { count: group.members.length })

const showEditor = ref(false)
const editing = ref<OpenboxUserGroup | null>(null)
const draft = ref<OpenboxUserGroup | null>(null)
const memberFilter = ref('')
const selectedFilter = ref('')
// 两栏各自的订阅下拉框,'' = 全部
const memberSub = ref('')
const selectedSub = ref('')
const editorError = ref('')
const saving = ref(false)

const openEditor = (group: OpenboxUserGroup | null) => {
  editing.value = group
  // 深拷贝:直接编辑列表里的对象会让"取消"也留下改动
  draft.value = group
    ? JSON.parse(JSON.stringify(group))
    : {
        id: '',
        name: '',
        type: 'urltest',
        allNodes: false,
        members: [],
        interval: '3m',
        tolerance: 50,
      }
  // 编辑器里不再有「包含所有有效节点」这个开关(改成了全选/反选/全不选),所以打开
  // 一个 allNodes 组时,把它当前代表的节点落成一份显式名单摆到「已选」里——否则右栏
  // 会是空的,看起来像这个组什么都没选。代价:保存后它就变成固定名单,不再随订阅
  // 刷新自动跟着变。
  if (draft.value?.allNodes) {
    draft.value.allNodes = false
    draft.value.members = availableNodes.value.map((n) => n.name)
  }
  memberFilter.value = ''
  selectedFilter.value = ''
  memberSub.value = ''
  selectedSub.value = ''
  editorError.value = ''
  showEditor.value = true
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
// 范围来:下拉框选中某条订阅、再按「全选」,加进来的正好是那条订阅的节点——这也是
// 加这个下拉框的用处。两个都不设时,范围就是整份候选集,和以前一样。
const scopeOf = (sub: string, keyword: string) => {
  const kw = keyword.trim().toLowerCase()
  return candidates.value.filter(
    (item) =>
      (!sub || item.subscription === sub) &&
      (!kw || item.name.toLowerCase().includes(kw)),
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
}

const removeMember = (name: string) => {
  if (!draft.value) return
  draft.value.members = draft.value.members.filter((m) => m !== name)
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

// 三个批量动作作用于**按下它的那一栏当前框出来的范围**(见 scopeOf):所见即所动。
// 两栏各有自己的下拉框与过滤框,所以各自传自己的范围进来。
const selectAll = (scope: Array<{ name: string }>) => {
  if (!draft.value) return
  const chosen = new Set(draft.value.members)
  draft.value.members = [
    ...draft.value.members,
    ...scope.map((c) => c.name).filter((n) => !chosen.has(n)),
  ]
}
const clearSelection = (scope: Array<{ name: string }>) => {
  if (!draft.value) return
  const drop = new Set(scope.map((c) => c.name))
  draft.value.members = draft.value.members.filter((n) => !drop.has(n))
}
const invertSelection = (scope: Array<{ name: string }>) => {
  if (!draft.value) return
  const chosen = new Set(draft.value.members)
  // 范围内已选的去掉、没选的加上;范围外的一个不动
  const flipped = scope.map((c) => c.name).filter((n) => !chosen.has(n))
  const dropped = new Set(scope.map((c) => c.name).filter((n) => chosen.has(n)))
  draft.value.members = [...draft.value.members.filter((n) => !dropped.has(n)), ...flipped]
}

const persist = async (next: OpenboxUserGroup[]) => {
  const res = await saveNodeGroups(next)
  groups.value = res.groups
  dropped.value = res.dropped || []
  // 组的构成会改变生成的配置,和改订阅/分流一样要提示需要重新部署
  routingPendingDeploy.value = true
  return res
}

const saveDraft = async () => {
  if (!draft.value || saving.value) return
  const name = draft.value.name.trim()
  if (!name) {
    editorError.value = t('groupNameRequired')
    return
  }
  // 组名就是 sing-box 的出站 tag,重名会生成两个同名出站——在这里就拦住,别等部署时才炸
  if (groups.value.some((g) => g.name === name && g.id !== draft.value?.id)) {
    editorError.value = t('groupNameDuplicate')
    return
  }
  if (!draft.value.members.length) {
    editorError.value = t('groupMembersRequired')
    return
  }

  saving.value = true
  editorError.value = ''
  try {
    const item: OpenboxUserGroup = { ...draft.value, name, id: draft.value.id || `g-${Date.now()}` }
    const next = editing.value
      ? groups.value.map((g) => (g.id === editing.value?.id ? item : g))
      : [...groups.value, item]
    await persist(next)
    showEditor.value = false
  } catch (err) {
    editorError.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

const removeGroup = async (group: OpenboxUserGroup) => {
  try {
    await persist(groups.value.filter((g) => g.id !== group.id))
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
</script>
