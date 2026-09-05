<template>
  <!-- 和节点管理同一种排版:没有外层大卡片和标题,每个站点集一张独立卡片。
       「添加站点集」按钮在顶部页签栏右上角(RoutingPage 里 Teleport 过去)。 -->
  <div class="flex flex-col gap-2">
    <p
      v-if="!rows.length"
      class="text-base-content/50 px-1 text-xs"
    >
      {{ $t('routingPoliciesEmpty') }}
    </p>

    <!-- 顺序即优先级:sing-box 按首条命中生效,拖拽排序改的就是这个。拖完立刻存,
           不然刷新一下就白拖了(和节点组那边一致)。 -->
    <!-- force-fallback:用鼠标事件模拟拖拽,不走浏览器原生拖放(原生的半透明快照在各浏览器
           表现不一)。fallback-on-body 必须一起开:跟着指针走的那份克隆是 position: fixed,
           默认挂在列表父节点下;而卡片开了 backdrop-filter(面板的背景模糊),这类属性会让
           fixed 改以卡片为参照,克隆就跑到离指针老远的地方去。挂到 body 上就没有这层干扰。 -->
    <Draggable
      v-model="rows"
      :animation="150"
      :force-fallback="true"
      :fallback-on-body="true"
      handle=".drag-handle"
      ghost-class="opacity-40"
      item-key="id"
      class="flex flex-col gap-2"
      @end="persist(rows)"
    >
      <template #item="{ element: policy }">
        <div
          class="card bg-base-100 border-base-content/10 flex flex-row items-center gap-2 border p-3"
          :class="policy.enabled === false && 'opacity-50'"
        >
          <Bars3Icon class="drag-handle text-base-content/40 h-4 w-4 shrink-0 cursor-move" />
          <CountryFlag
            v-if="policy.icon"
            :code="policy.icon"
            :size="18"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-base font-medium">{{ policy.name }}</span>
              <StatusBadge
                v-if="policy.enabled === false"
                :on="false"
                on-text=""
                :off-text="$t('groupDisabledBadge')"
              />
            </div>
            <div class="text-base-content/60 mt-0.5 truncate text-xs">
              {{ conditionSummary(policy) }}
            </div>
          </div>
          <!-- 启用/停用:停用的留在列表里,不进内核配置 -->
          <button
            type="button"
            class="btn btn-ghost btn-square btn-sm"
            :class="policy.enabled === false ? 'text-base-content/40' : 'text-success'"
            v-tip="$t(policy.enabled === false ? 'groupEnable' : 'groupDisable')"
            :aria-label="$t(policy.enabled === false ? 'groupEnable' : 'groupDisable')"
            :disabled="saving"
            @click="toggleEnabled(policy)"
          >
            <PowerIcon class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-square btn-sm"
            v-tip="$t('edit')"
            :aria-label="$t('edit')"
            @click="openEditor(policy)"
          >
            <PencilSquareIcon class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-square btn-sm hover:text-error"
            v-tip="$t('delete')"
            :aria-label="$t('delete')"
            @click="askDelete(policy)"
          >
            <TrashIcon class="h-4 w-4" />
          </button>
        </div>
      </template>
    </Draggable>

    <!-- 兜底:上面都没命中的流量走它。系统生成、删不掉、拖不动——内核的 route.final
           必须指向某个出站,少了它整份配置就不成立。走哪条线路在「代理」页点选。 -->
    <div
      class="card bg-base-100 border-base-content/10 flex flex-row items-center gap-2 border border-dashed p-3"
    >
      <span class="w-4 shrink-0" />
      <CountryFlag
        :code="fallbackIcon"
        :size="18"
      />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="truncate text-base font-medium">{{ fallbackName }}</span>
          <span class="badge badge-ghost badge-sm shrink-0">{{ $t('routingFallbackBadge') }}</span>
        </div>
        <div class="text-base-content/60 mt-0.5 truncate text-xs">
          {{ $t('routingFallbackHint') }}
        </div>
      </div>
      <!-- 三个图标和普通站点集对齐;兜底不能停用、不能删除,这两个置灰,只能改名字和图标 -->
      <button
        type="button"
        class="btn btn-ghost btn-square btn-sm text-base-content/30 cursor-not-allowed"
        v-tip="$t('routingFallbackNoDisable')"
        :aria-label="$t('routingFallbackNoDisable')"
        aria-disabled="true"
      >
        <PowerIcon class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-square btn-sm"
        v-tip="$t('edit')"
        :aria-label="$t('edit')"
        @click="openFallbackEditor"
      >
        <PencilSquareIcon class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-square btn-sm text-base-content/30 cursor-not-allowed"
        v-tip="$t('routingFallbackNoDelete')"
        :aria-label="$t('routingFallbackNoDelete')"
        aria-disabled="true"
      >
        <TrashIcon class="h-4 w-4" />
      </button>
    </div>

    <!-- 兜底站点集:只能改名字和图标 -->
    <DialogWrapper
      v-model="showFallbackEditor"
      :title="$t('routingFallbackEditTitle')"
      box-class="w-full max-w-md"
    >
      <div
        v-if="fallbackDraft"
        class="flex flex-col gap-4"
      >
        <div class="flex items-end gap-2">
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupIconLabel') }}</label>
            <div class="w-56">
              <CountrySelect
                v-model="fallbackDraft.icon"
                clearable
                globes
                brands
                :placeholder="$t('groupIconNone')"
              />
            </div>
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('routingPolicyNameLabel') }}</label>
            <input
              v-model="fallbackDraft.name"
              type="text"
              class="input input-sm w-full"
            />
          </div>
        </div>
        <p class="text-base-content/50 text-xs">{{ $t('routingFallbackEditHint') }}</p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showFallbackEditor = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="saving"
            @click="saveFallback"
          >
            <span
              v-if="saving"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('save') }}
          </button>
        </div>
      </div>
    </DialogWrapper>

    <!-- 删掉一个站点集会连带删掉内核里那个同名 selector(代理页上就没了),先确认一次 -->
    <DialogWrapper
      v-model="showDelete"
      :title="$t('routingPolicyDeleteTitle')"
    >
      <div class="flex flex-col gap-4 p-2">
        <p class="text-sm">
          {{ $t('routingPolicyDeleteConfirm', { name: pendingDelete?.name || '' }) }}
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showDelete = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-error btn-sm"
            :disabled="saving"
            @click="confirmDelete"
          >
            <span
              v-if="saving"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('confirm') }}
          </button>
        </div>
      </div>
    </DialogWrapper>

    <DialogWrapper
      v-model="showEditor"
      :title="$t(editing ? 'routingPolicyEditTitle' : 'routingPolicyAddTitle')"
      box-class="w-full max-w-xl"
    >
      <div
        v-if="draft"
        class="flex flex-col gap-4"
      >
        <div class="flex items-end gap-2">
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupIconLabel') }}</label>
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
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('routingPolicyNameLabel') }}</label>
            <input
              v-model="draft.name"
              type="text"
              class="input input-sm w-full"
              :placeholder="$t('routingPolicyNamePlaceholder')"
            />
          </div>
        </div>

        <!-- 一条规则一行:类型 + 值。同一个站点集里各行是「或」的关系(和内核一致),
             所以行与行之间没有先后可言——不给拖拽柄,免得暗示一个并不存在的顺序。
             站点集走哪条线路不在这儿定:在「代理」页点选。 -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <label class="text-xs font-medium">{{ $t('routingPolicyRulesLabel') }}</label>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              @click="addRule()"
            >
              <PlusIcon class="h-3.5 w-3.5" />
              {{ $t('routingPolicyRuleAdd') }}
            </button>
          </div>

          <p
            v-if="!rules.length"
            class="text-base-content/50 text-xs"
          >
            {{ $t('routingPolicyNoRuleYet') }}
          </p>

          <div
            v-for="(rule, index) in rules"
            :key="rule.key"
            class="flex items-center gap-2"
          >
            <select
              v-model="rule.type"
              class="select select-sm w-36 shrink-0"
            >
              <option
                v-for="opt in ruleTypeOptions(rule.type)"
                :key="opt.type"
                :value="opt.type"
              >
                {{ $t(opt.labelKey) }}
              </option>
            </select>
            <!-- geosite/geoip 的值来自上游真有的那份名单,给带搜索的下拉框,
                 外加一个「详情」看它到底包含哪些域名/IP -->
            <GeoRuleValue
              v-if="rule.type === 'geosite' || rule.type === 'geoip'"
              v-model="rule.value"
              :kind="rule.type"
              :placeholder="$t(placeholderKey(rule.type))"
              :exclude="pickedElsewhere(index)"
            />
            <input
              v-else
              v-model="rule.value"
              type="text"
              class="input input-sm min-w-0 flex-1 font-mono text-xs"
              :placeholder="$t(placeholderKey(rule.type))"
            />
            <button
              type="button"
              class="btn btn-ghost btn-square btn-sm hover:text-error"
              v-tip="$t('delete')"
              :aria-label="$t('delete')"
              @click="rules.splice(index, 1)"
            >
              <TrashIcon class="h-4 w-4" />
            </button>
          </div>
        </div>

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
import type { OpenboxProfile, OpenboxRoutingPolicy } from '@/api/openbox'
import { RULESET_TAG_PATTERN } from '@/api/openbox'
import CountryFlag from '@/components/common/CountryFlag.vue'
import CountrySelect from '@/components/common/CountrySelect.vue'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import GeoRuleValue from '@/components/routing/GeoRuleValue.vue'
import { showNotification } from '@/helper/notification'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { Bars3Icon, PencilSquareIcon, PlusIcon, PowerIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Draggable from 'vuedraggable'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

// 兜底站点集:默认叫「其他」、彩色地球(服务端同一份默认在 engine/routing-model.mjs)。
// 名字直接当内核里的出站 tag 用,用户可以改;图标也可以改。存在本身是固定的。
const DEFAULT_FALLBACK_NAME = '其他'
const DEFAULT_FALLBACK_ICON = 'globe:earth-meridians'
const fallbackName = computed(() => props.profile.routing.fallbackName?.trim() || DEFAULT_FALLBACK_NAME)
const fallbackIcon = computed(() => props.profile.routing.fallbackIcon?.trim() || DEFAULT_FALLBACK_ICON)

const showFallbackEditor = ref(false)
const fallbackDraft = ref<{ name: string; icon: string } | null>(null)
const openFallbackEditor = () => {
  fallbackDraft.value = { name: fallbackName.value, icon: fallbackIcon.value }
  showFallbackEditor.value = true
}
const saveFallback = async () => {
  const d = fallbackDraft.value
  if (!d || saving.value) return
  const name = d.name.trim()
  if (!name) {
    showNotification({ content: 'routingPolicyNameRequired', type: 'alert-error' })
    return
  }
  // 名字就是内核里的出站 tag,和普通站点集重名同样不行
  if (rows.value.some((p) => p.name === name)) {
    showNotification({ content: 'routingPolicyNameDuplicate', type: 'alert-error' })
    return
  }
  saving.value = true
  try {
    await props.patchProfile({ routing: { fallbackName: name, fallbackIcon: d.icon || '' } })
    showNotification({ content: 'routingPolicySaved', type: 'alert-success' })
    showFallbackEditor.value = false
  } catch (err) {
    showNotification({
      content: 'routingSaveFailed',
      params: { message: err instanceof Error ? err.message : String(err) },
      type: 'alert-error',
    })
  } finally {
    saving.value = false
  }
}

// 启用/停用:停用的站点集留在列表里,不进内核配置(重启内核后生效,和别的改动一样)
const toggleEnabled = async (policy: OpenboxRoutingPolicy) => {
  if (saving.value) return
  saving.value = true
  try {
    await persist(rows.value.map((p) => (p.id === policy.id ? { ...p, enabled: p.enabled === false } : p)))
  } catch (err) {
    showNotification({
      content: 'routingSaveFailed',
      params: { message: err instanceof Error ? err.message : String(err) },
      type: 'alert-error',
    })
  } finally {
    saving.value = false
  }
}

const { t } = useI18n()

type ConditionKey = 'rulesets' | 'ruleUrls' | 'domain' | 'domainSuffix' | 'domainKeyword' | 'ipCidr'
const CONDITION_FIELDS: { key: ConditionKey; labelKey: string; placeholderKey: string }[] = [
  {
    key: 'rulesets',
    labelKey: 'routingPolicyRulesets',
    placeholderKey: 'routingPolicyRulesetsPlaceholder',
  },
  {
    key: 'ruleUrls',
    labelKey: 'routingPolicyRuleUrl',
    placeholderKey: 'routingPolicyRuleUrlPlaceholder',
  },
  {
    key: 'domainSuffix',
    labelKey: 'routingPolicyDomainSuffix',
    placeholderKey: 'routingPolicyDomainSuffixPlaceholder',
  },
  {
    key: 'domain',
    labelKey: 'routingPolicyDomain',
    placeholderKey: 'routingPolicyDomainPlaceholder',
  },
  {
    key: 'domainKeyword',
    labelKey: 'routingPolicyDomainKeyword',
    placeholderKey: 'routingPolicyDomainKeywordPlaceholder',
  },
  {
    key: 'ipCidr',
    labelKey: 'routingPolicyIpCidr',
    placeholderKey: 'routingPolicyIpCidrPlaceholder',
  },
]

// 编辑弹窗里的一行 = 一条规则。geosite/geoip 只是规则集的糖:写 cn 存下去就是
// geosite-cn —— 官方规则集全是这两个前缀,让人每次手打前缀没有意义。前缀之外的
// 规则集(老档案里可能有)走 ruleset 这一档,原样存。
type RuleType =
  | 'domainSuffix'
  | 'domain'
  | 'domainKeyword'
  | 'ipCidr'
  | 'geosite'
  | 'geoip'
  | 'ruleUrl'
  | 'ruleset'
const RULE_TYPES: { type: RuleType; labelKey: string; placeholderKey: string }[] = [
  {
    type: 'domainSuffix',
    labelKey: 'routingPolicyDomainSuffix',
    placeholderKey: 'routingPolicyRuleDomainSuffixPlaceholder',
  },
  {
    type: 'domain',
    labelKey: 'routingPolicyDomain',
    placeholderKey: 'routingPolicyRuleDomainPlaceholder',
  },
  {
    type: 'domainKeyword',
    labelKey: 'routingPolicyDomainKeyword',
    placeholderKey: 'routingPolicyRuleDomainKeywordPlaceholder',
  },
  {
    type: 'ipCidr',
    labelKey: 'routingPolicyIpCidr',
    placeholderKey: 'routingPolicyRuleIpCidrPlaceholder',
  },
  {
    type: 'geosite',
    labelKey: 'routingPolicyGeosite',
    placeholderKey: 'routingPolicyRuleGeoPlaceholder',
  },
  {
    type: 'geoip',
    labelKey: 'routingPolicyGeoip',
    placeholderKey: 'routingPolicyRuleGeoPlaceholder',
  },
  {
    type: 'ruleUrl',
    labelKey: 'routingPolicyRuleUrl',
    placeholderKey: 'routingPolicyRuleUrlPlaceholder',
  },
  // 老档案里可能存着不带 geosite- / geoip- 前缀的规则集名字,得有地方显示,
  // 但不进新增的下拉(见 ruleTypeOptions)
  {
    type: 'ruleset',
    labelKey: 'routingPolicyRulesets',
    placeholderKey: 'routingPolicyRulesetsPlaceholder',
  },
]
const placeholderKey = (type: RuleType) =>
  RULE_TYPES.find((r) => r.type === type)?.placeholderKey || 'routingPolicyRuleDomainPlaceholder'

// 「规则集」那一档不进新增的下拉:官方规则集全是 geosite- / geoip- 两个前缀,上面两档
// 已经全覆盖,而且带搜索、带说明、能先看「详情」。它只剩兼容作用——老档案里存过别的
// 前缀的名字,打开时才让它出现在自己那一行,换成别的类型之后就再也选不回来。
const ruleTypeOptions = (current: RuleType) =>
  RULE_TYPES.filter((r) => r.type !== 'ruleset' || current === 'ruleset')

interface RuleRow {
  // 列表渲染要一个稳定的 key:类型和值都会被改,不能拿它们当 key
  key: number
  type: RuleType
  value: string
}
let ruleKeySeed = 0

const policies = computed<OpenboxRoutingPolicy[]>(() => props.profile.routing.policies || [])
// 拖拽要求 v-model 绑一个 ref(vuedraggable 会整个替换数组),所以列表在本地存一份
const rows = ref<OpenboxRoutingPolicy[]>([])
watch(
  policies,
  (value) => {
    rows.value = [...value]
  },
  { immediate: true, deep: true },
)

const conditionSummary = (policy: OpenboxRoutingPolicy) => {
  const parts: string[] = []
  for (const field of CONDITION_FIELDS) {
    const values = policy[field.key] || []
    if (values.length) parts.push(`${t(field.labelKey)}: ${values.join(', ')}`)
  }
  return parts.length ? parts.join(' · ') : t('routingPolicyNoCondition')
}

const showEditor = ref(false)
const editing = ref<OpenboxRoutingPolicy | null>(null)
const draft = ref<OpenboxRoutingPolicy | null>(null)
const rules = ref<RuleRow[]>([])

// 这一行以外、同类型规则已经选了的分类:下拉框里不再出现,同一个集不会被加两遍
const pickedElsewhere = (index: number) =>
  rules.value.filter((r, i) => i !== index && r.type === rules.value[index]?.type).map((r) => r.value)
const saving = ref(false)

const addRule = (type: RuleType = 'domainSuffix', value = '') => {
  rules.value.push({ key: ++ruleKeySeed, type, value })
}

// 存下来的规则集 tag → 界面上的一行。geosite-cn 显示成 geosite + cn,
// 其余前缀原样落到 ruleset 那一档。
const rulesetToRow = (tag: string): RuleRow => {
  for (const type of ['geosite', 'geoip'] as const) {
    if (tag.startsWith(`${type}-`))
      return { key: ++ruleKeySeed, type, value: tag.slice(type.length + 1) }
  }
  return { key: ++ruleKeySeed, type: 'ruleset', value: tag }
}

const openEditor = (policy: OpenboxRoutingPolicy | null) => {
  editing.value = policy
  draft.value = policy ? JSON.parse(JSON.stringify(policy)) : { id: '', name: '', icon: '' }
  rules.value = []
  if (policy) {
    for (const url of policy.ruleUrls || []) rules.value.push({ key: ++ruleKeySeed, type: 'ruleUrl', value: url })
    for (const tag of policy.rulesets || []) rules.value.push(rulesetToRow(tag))
    for (const type of ['domainSuffix', 'domain', 'domainKeyword', 'ipCidr'] as const) {
      for (const value of policy[type] || []) addRule(type, value)
    }
  }
  if (!rules.value.length) addRule()
  showEditor.value = true
}
defineExpose({ openEditor })

// 新增 / 修改 / 删除 / 拖拽排序都走这里。保存只是写档案,内核还在跑旧配置,所以每次都
// 用右上角的标准提示告诉一声"重启内核后生效",由用户自己去内核页重启。
const persist = async (next: OpenboxRoutingPolicy[]) => {
  await props.patchProfile({ routing: { policies: next } })
  showNotification({ content: 'routingPolicySaved', type: 'alert-success' })
}

const saveDraft = async () => {
  if (!draft.value || saving.value) return
  const name = draft.value.name.trim()
  if (!name) {
    showNotification({ content: 'routingPolicyNameRequired', type: 'alert-error' })
    return
  }
  // 站点集的名字就是内核里的出站名,重名会生成两个同名出站
  if (rows.value.some((p) => p.name === name && p.id !== draft.value?.id)) {
    showNotification({ content: 'routingPolicyNameDuplicate', type: 'alert-error' })
    return
  }
  // 规则行 → 存储用的那五个数组。空值的行直接忽略(加了一行没填就是没填)
  const collected: Record<ConditionKey, string[]> = {
    rulesets: [],
    ruleUrls: [],
    domain: [],
    domainSuffix: [],
    domainKeyword: [],
    ipCidr: [],
  }
  for (const row of rules.value) {
    const value = row.value.trim()
    if (!value) continue
    if (row.type === 'geosite' || row.type === 'geoip')
      collected.rulesets.push(`${row.type}-${value}`)
    else if (row.type === 'ruleset') collected.rulesets.push(value)
    else if (row.type === 'ruleUrl') collected.ruleUrls.push(value)
    else collected[row.type].push(value)
  }
  // 规则集 tag 会被拼进 .srs 路径,和服务端同一道校验(路径穿越防线,不是排版讲究)
  if (collected.rulesets.some((tag) => !RULESET_TAG_PATTERN.test(tag))) {
    showNotification({ content: 'routingRulesetInvalidChars', type: 'alert-error' })
    return
  }

  const item: OpenboxRoutingPolicy = {
    ...draft.value,
    id: draft.value.id || `policy-${Date.now()}`,
    name,
    ...collected,
  }
  if (!CONDITION_FIELDS.some((f) => (item[f.key] || []).length)) {
    showNotification({ content: 'routingPolicyConditionRequired', type: 'alert-error' })
    return
  }

  saving.value = true
  try {
    const next = editing.value
      ? rows.value.map((p) => (p.id === editing.value?.id ? item : p))
      : [...rows.value, item]
    await persist(next)
    showEditor.value = false
  } catch (error) {
    showNotification({
      content: 'routingSaveFailed',
      type: 'alert-error',
      params: { message: error instanceof Error ? error.message : String(error) },
    })
  } finally {
    saving.value = false
  }
}

const showDelete = ref(false)
const pendingDelete = ref<OpenboxRoutingPolicy | null>(null)
const askDelete = (policy: OpenboxRoutingPolicy) => {
  pendingDelete.value = policy
  showDelete.value = true
}
const confirmDelete = async () => {
  const policy = pendingDelete.value
  if (!policy || saving.value) return
  saving.value = true
  try {
    await persist(rows.value.filter((p) => p.id !== policy.id))
    showDelete.value = false
    pendingDelete.value = null
  } catch (error) {
    showNotification({
      content: 'routingSaveFailed',
      type: 'alert-error',
      params: { message: error instanceof Error ? error.message : String(error) },
    })
  } finally {
    saving.value = false
  }
}
</script>
