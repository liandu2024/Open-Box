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
        v-if="!policies.length"
        class="text-base-content/50 text-xs"
      >
        {{ $t('routingPoliciesEmpty') }}
      </p>

      <!-- 顺序即优先级:sing-box 按首条命中生效,拖拽排序改的就是这个。拖完立刻存,
           不然刷新一下就白拖了(和节点组那边一致)。 -->
      <Draggable
        v-else
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
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium">{{ policy.name }}</span>
                <span class="badge badge-outline badge-xs shrink-0">{{ targetLabel(policy) }}</span>
              </div>
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
    </div>

    <!-- 删掉一条策略会连带删掉内核里那个同名 selector(代理页上就没了),先确认一次 -->
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

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('routingPolicyDefaultLabel') }}</label>
          <select
            v-model="draft.default"
            class="select select-sm w-full"
          >
            <option
              v-for="opt in outboundOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
          <p class="text-base-content/50 text-xs">{{ $t('routingPolicyDefaultHint') }}</p>
        </div>

        <!-- 五类条件各一行。同一条策略里多类条件是「或」的关系,和内核一致。 -->
        <div class="flex flex-col gap-2">
          <div
            v-for="field in CONDITION_FIELDS"
            :key="field.key"
            class="flex flex-col gap-1"
          >
            <label class="text-xs font-medium">{{ $t(field.labelKey) }}</label>
            <input
              v-model="draftText[field.key]"
              type="text"
              class="input input-sm w-full font-mono text-xs"
              :placeholder="$t(field.placeholderKey)"
            />
          </div>
          <p class="text-base-content/50 text-xs">{{ $t('routingPolicyConditionHint') }}</p>
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-base-content/60 text-xs">{{ $t('routingCategoryPresetsLabel') }}</span>
            <button
              v-for="preset in CATEGORY_PRESETS"
              :key="preset.ruleset"
              type="button"
              class="badge badge-outline badge-sm cursor-pointer"
              @click="fillPreset(preset)"
            >
              {{ $t(preset.labelKey) }}
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
import { showNotification } from '@/helper/notification'
import { Bars3Icon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Draggable from 'vuedraggable'

const props = defineProps<{
  profile: OpenboxProfile
  groupNames: string[]
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const { t } = useI18n()

type ConditionKey = 'rulesets' | 'domain' | 'domainSuffix' | 'domainKeyword' | 'ipCidr'
const CONDITION_FIELDS: { key: ConditionKey; labelKey: string; placeholderKey: string }[] = [
  { key: 'rulesets', labelKey: 'routingPolicyRulesets', placeholderKey: 'routingPolicyRulesetsPlaceholder' },
  { key: 'domainSuffix', labelKey: 'routingPolicyDomainSuffix', placeholderKey: 'routingPolicyDomainSuffixPlaceholder' },
  { key: 'domain', labelKey: 'routingPolicyDomain', placeholderKey: 'routingPolicyDomainPlaceholder' },
  { key: 'domainKeyword', labelKey: 'routingPolicyDomainKeyword', placeholderKey: 'routingPolicyDomainKeywordPlaceholder' },
  { key: 'ipCidr', labelKey: 'routingPolicyIpCidr', placeholderKey: 'routingPolicyIpCidrPlaceholder' },
]

// 沿用改版前那几个「快速填入」:点一下把规则集填进去,不直接保存。
const CATEGORY_PRESETS = [
  { labelKey: 'routingPresetAI', ruleset: 'geosite-openai' },
  { labelKey: 'routingPresetStreaming', ruleset: 'geosite-netflix' },
  { labelKey: 'routingPresetGoogle', ruleset: 'geosite-google' },
  { labelKey: 'routingPresetGithub', ruleset: 'geosite-github' },
  { labelKey: 'routingPresetTelegram', ruleset: 'geosite-telegram' },
] as const

const policies = computed<OpenboxRoutingPolicy[]>(() => props.profile.routing.policies || [])
// 拖拽要求 v-model 绑一个 ref(vuedraggable 会整个替换数组),所以列表在本地存一份
const rows = ref<OpenboxRoutingPolicy[]>([])
watch(policies, (value) => { rows.value = [...value] }, { immediate: true, deep: true })

const enabled = (key: 'direct' | 'reject' | 'groups') =>
  props.profile.routing.outboundOptions?.[key] !== false

// 默认出站的候选:和内核里 selector 的成员表一致(见 engine/routing-model.mjs)
const outboundOptions = computed(() => {
  const list: { value: string; label: string }[] = []
  if (enabled('direct')) list.push({ value: 'direct', label: t('direct') })
  if (enabled('groups')) list.push(...props.groupNames.map((name) => ({ value: name, label: name })))
  if (enabled('reject')) list.push({ value: 'block', label: t('routingOutboundReject') })
  return list.length ? list : [{ value: 'direct', label: t('direct') }]
})

const targetLabel = (policy: OpenboxRoutingPolicy) => {
  const hit = outboundOptions.value.find((o) => o.value === policy.default)
  return hit ? hit.label : t('routingPolicyDefaultUnset')
}

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
const draftText = reactive<Record<ConditionKey, string>>({
  rulesets: '', domain: '', domainSuffix: '', domainKeyword: '', ipCidr: '',
})
const saving = ref(false)

const splitList = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean)

const openEditor = (policy: OpenboxRoutingPolicy | null) => {
  editing.value = policy
  draft.value = policy
    ? JSON.parse(JSON.stringify(policy))
    : { id: '', name: '', icon: '', default: outboundOptions.value[0].value }
  for (const field of CONDITION_FIELDS) {
    draftText[field.key] = (policy?.[field.key] || []).join(',')
  }
  showEditor.value = true
}

const fillPreset = (preset: { ruleset: string }) => {
  const existing = splitList(draftText.rulesets)
  if (!existing.includes(preset.ruleset)) existing.push(preset.ruleset)
  draftText.rulesets = existing.join(',')
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
  // 策略名就是内核里的出站名,重名会生成两个同名出站
  if (rows.value.some((p) => p.name === name && p.id !== draft.value?.id)) {
    showNotification({ content: 'routingPolicyNameDuplicate', type: 'alert-error' })
    return
  }
  const rulesets = splitList(draftText.rulesets)
  // 规则集 tag 会被拼进 .srs 路径,和服务端同一道校验(路径穿越防线,不是排版讲究)
  const badTag = rulesets.find((tag) => !RULESET_TAG_PATTERN.test(tag))
  if (badTag) {
    showNotification({ content: 'routingRulesetInvalidChars', type: 'alert-error' })
    return
  }

  const item: OpenboxRoutingPolicy = {
    ...draft.value,
    id: draft.value.id || `policy-${Date.now()}`,
    name,
    rulesets,
    domain: splitList(draftText.domain),
    domainSuffix: splitList(draftText.domainSuffix),
    domainKeyword: splitList(draftText.domainKeyword),
    ipCidr: splitList(draftText.ipCidr),
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
