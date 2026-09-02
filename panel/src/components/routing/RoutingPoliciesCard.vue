<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h2 class="text-base font-semibold">{{ $t('routingPoliciesTitle') }}</h2>
          <p class="text-base-content/60 text-xs">{{ $t('routingPoliciesDescription') }}</p>
        </div>
        <button
          type="button"
          class="btn btn-primary btn-sm shrink-0"
          @click="openEditor(null)"
        >
          <PlusIcon class="h-4 w-4" />
          {{ $t('routingPolicyAdd') }}
        </button>
      </div>

      <p
        v-if="!rows.length"
        class="text-base-content/50 text-xs"
      >
        {{ $t('routingPoliciesEmpty') }}
      </p>

      <!-- 顺序即优先级:sing-box 按首条命中生效,拖拽排序改的就是这个。拖完立刻存,
           不然刷新一下就白拖了(和节点组那边一致)。 -->
      <Draggable
        v-model="rows"
        :animation="150"
        :force-fallback="true"
        handle=".drag-handle"
        ghost-class="opacity-40"
        item-key="id"
        class="flex flex-col gap-2"
        @end="persist(rows)"
      >
        <template #item="{ element: policy }">
          <div class="border-base-300/60 flex items-center gap-2 rounded-lg border p-2.5">
            <Bars3Icon class="drag-handle text-base-content/40 h-4 w-4 shrink-0 cursor-move" />
            <CountryFlag
              v-if="policy.icon"
              :code="policy.icon"
              :size="18"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{{ policy.name }}</div>
              <div class="text-base-content/60 mt-0.5 truncate text-xs">{{ conditionSummary(policy) }}</div>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-square btn-sm"
              :aria-label="$t('edit')"
              @click="openEditor(policy)"
            >
              <PencilSquareIcon class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-square btn-sm hover:text-error"
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
      <div class="border-base-300/60 bg-base-200/40 flex items-center gap-2 rounded-lg border border-dashed p-2.5">
        <span class="w-4 shrink-0" />
        <CountryFlag
          :code="FALLBACK_ICON"
          :size="18"
        />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{{ FALLBACK_NAME }}</div>
          <div class="text-base-content/60 mt-0.5 truncate text-xs">{{ $t('routingFallbackHint') }}</div>
        </div>
        <span class="badge badge-ghost badge-sm shrink-0">{{ $t('routingFallbackBadge') }}</span>
      </div>
    </div>

    <!-- 删掉一个站点集会连带删掉内核里那个同名 selector(代理页上就没了),先确认一次 -->
    <DialogWrapper
      v-model="showDelete"
      :title="$t('routingPolicyDeleteTitle')"
    >
      <div class="flex flex-col gap-4 p-2">
        <p class="text-sm">{{ $t('routingPolicyDeleteConfirm', { name: pendingDelete?.name || '' }) }}</p>
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
            <div class="w-32">
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
                v-for="opt in RULE_TYPES"
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
import { Bars3Icon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Draggable from 'vuedraggable'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

// 兜底站点集的名字和图标是数据不是文案:名字直接当内核里的出站 tag 用,改了名
// 代理页上原来的选择就对不上号了(服务端同一份定义在 engine/routing-model.mjs)。
const FALLBACK_NAME = '其他'
const FALLBACK_ICON = 'globe:earth-meridians'

const { t } = useI18n()

type ConditionKey = 'rulesets' | 'domain' | 'domainSuffix' | 'domainKeyword' | 'ipCidr'
const CONDITION_FIELDS: { key: ConditionKey; labelKey: string; placeholderKey: string }[] = [
  { key: 'rulesets', labelKey: 'routingPolicyRulesets', placeholderKey: 'routingPolicyRulesetsPlaceholder' },
  { key: 'domainSuffix', labelKey: 'routingPolicyDomainSuffix', placeholderKey: 'routingPolicyDomainSuffixPlaceholder' },
  { key: 'domain', labelKey: 'routingPolicyDomain', placeholderKey: 'routingPolicyDomainPlaceholder' },
  { key: 'domainKeyword', labelKey: 'routingPolicyDomainKeyword', placeholderKey: 'routingPolicyDomainKeywordPlaceholder' },
  { key: 'ipCidr', labelKey: 'routingPolicyIpCidr', placeholderKey: 'routingPolicyIpCidrPlaceholder' },
]

// 编辑弹窗里的一行 = 一条规则。geosite/geoip 只是规则集的糖:写 cn 存下去就是
// geosite-cn —— 官方规则集全是这两个前缀,让人每次手打前缀没有意义。前缀之外的
// 规则集(老档案里可能有)走 ruleset 这一档,原样存。
type RuleType = 'domainSuffix' | 'domain' | 'domainKeyword' | 'ipCidr' | 'geosite' | 'geoip' | 'ruleset'
const RULE_TYPES: { type: RuleType; labelKey: string; placeholderKey: string }[] = [
  { type: 'domainSuffix', labelKey: 'routingPolicyDomainSuffix', placeholderKey: 'routingPolicyRuleDomainSuffixPlaceholder' },
  { type: 'domain', labelKey: 'routingPolicyDomain', placeholderKey: 'routingPolicyRuleDomainPlaceholder' },
  { type: 'domainKeyword', labelKey: 'routingPolicyDomainKeyword', placeholderKey: 'routingPolicyRuleDomainKeywordPlaceholder' },
  { type: 'ipCidr', labelKey: 'routingPolicyIpCidr', placeholderKey: 'routingPolicyRuleIpCidrPlaceholder' },
  { type: 'geosite', labelKey: 'routingPolicyGeosite', placeholderKey: 'routingPolicyRuleGeoPlaceholder' },
  { type: 'geoip', labelKey: 'routingPolicyGeoip', placeholderKey: 'routingPolicyRuleGeoPlaceholder' },
  { type: 'ruleset', labelKey: 'routingPolicyRulesets', placeholderKey: 'routingPolicyRulesetsPlaceholder' },
]
const placeholderKey = (type: RuleType) =>
  RULE_TYPES.find((r) => r.type === type)?.placeholderKey || 'routingPolicyRuleDomainPlaceholder'

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
watch(policies, (value) => { rows.value = [...value] }, { immediate: true, deep: true })

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
const saving = ref(false)

const addRule = (type: RuleType = 'domainSuffix', value = '') => {
  rules.value.push({ key: ++ruleKeySeed, type, value })
}

// 存下来的规则集 tag → 界面上的一行。geosite-cn 显示成 geosite + cn,
// 其余前缀原样落到 ruleset 那一档。
const rulesetToRow = (tag: string): RuleRow => {
  for (const type of ['geosite', 'geoip'] as const) {
    if (tag.startsWith(`${type}-`)) return { key: ++ruleKeySeed, type, value: tag.slice(type.length + 1) }
  }
  return { key: ++ruleKeySeed, type: 'ruleset', value: tag }
}

const openEditor = (policy: OpenboxRoutingPolicy | null) => {
  editing.value = policy
  draft.value = policy ? JSON.parse(JSON.stringify(policy)) : { id: '', name: '', icon: '' }
  rules.value = []
  if (policy) {
    for (const tag of policy.rulesets || []) rules.value.push(rulesetToRow(tag))
    for (const type of ['domainSuffix', 'domain', 'domainKeyword', 'ipCidr'] as const) {
      for (const value of policy[type] || []) addRule(type, value)
    }
  }
  if (!rules.value.length) addRule()
  showEditor.value = true
}

const persist = async (next: OpenboxRoutingPolicy[]) => {
  await props.patchProfile({ routing: { policies: next } })
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
    rulesets: [], domain: [], domainSuffix: [], domainKeyword: [], ipCidr: [],
  }
  for (const row of rules.value) {
    const value = row.value.trim()
    if (!value) continue
    if (row.type === 'geosite' || row.type === 'geoip') collected.rulesets.push(`${row.type}-${value}`)
    else if (row.type === 'ruleset') collected.rulesets.push(value)
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
