<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h2 class="text-base font-semibold">{{ $t('routingRegionTitle') }}</h2>
          <p class="text-base-content/60 text-xs">{{ $t('routingRegionDescription') }}</p>
        </div>
        <button
          type="button"
          class="btn btn-primary btn-sm shrink-0"
          :disabled="saving"
          @click="addRegion"
        >
          <PlusIcon class="h-4 w-4" />
          {{ $t('routingRegionAdd') }}
        </button>
      </div>

      <!-- 一行四个。点哪张卡就用哪个地区,它的分流设置直接展开在下面,不再弹窗。
           顺序可拖(vuedraggable 对网格一样适用),删除要确认。 -->
      <Draggable
        v-model="rows"
        :animation="150"
        :force-fallback="true"
        handle=".drag-handle"
        ghost-class="opacity-40"
        item-key="id"
        class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
        @end="persist(rows)"
      >
        <template #item="{ element: region }">
          <div
            class="border-base-300/60 hover:border-base-content/20 flex cursor-pointer flex-col gap-1 rounded-lg border p-2.5"
            :class="region.id === currentId && 'border-primary bg-primary/5'"
            @click="choose(region)"
          >
            <div class="flex items-center gap-1.5">
              <Bars3Icon
                class="drag-handle text-base-content/40 h-4 w-4 shrink-0 cursor-move"
                @click.stop
              />
              <input
                type="radio"
                class="radio radio-xs shrink-0"
                :checked="region.id === currentId"
                :disabled="saving"
                @click.stop="choose(region)"
              />
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ region.name }}</span>
              <button
                type="button"
                class="btn btn-ghost btn-square btn-xs hover:text-error"
                :aria-label="$t('delete')"
                @click.stop="askDelete(region)"
              >
                <TrashIcon class="h-3.5 w-3.5" />
              </button>
            </div>
            <div class="text-base-content/60 line-clamp-2 text-xs">{{ summary(region) }}</div>
          </div>
        </template>
      </Draggable>

      <!-- 选中那个地区的分流设置,就地改 -->
      <div
        v-if="draft"
        class="border-base-300/60 flex flex-col gap-3 rounded-lg border p-3"
      >
        <div class="text-sm font-medium">{{ $t('routingRegionSettingsTitle', { name: selectedName }) }}</div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('routingRegionNameLabel') }}</label>
          <input
            v-model="draft.name"
            type="text"
            class="input input-sm w-full max-w-xs"
            :placeholder="$t('routingRegionNamePlaceholder')"
          />
        </div>

        <!-- 规则表。顺序即匹配顺序(内核首条命中生效),所以这里能拖、拖完就是新顺序;
             每条自己带动作,内网那几段(127/8、192.168/16……)不在表里——生成配置时
             固定排在所有规则之前,删不掉也不用管。 -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <label class="text-xs font-medium">{{ $t('routingRegionRulesLabel') }}</label>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              @click="addRule()"
            >
              <PlusIcon class="h-3.5 w-3.5" />
              {{ $t('routingRegionRuleAdd') }}
            </button>
          </div>

          <div
            v-if="draftRules.length"
            class="text-base-content/50 flex items-center gap-2 px-1 text-xs"
          >
            <span class="w-4 shrink-0" />
            <span class="w-32 shrink-0">{{ $t('routingRuleTypeHeader') }}</span>
            <span class="min-w-0 flex-1">{{ $t('routingRuleValueHeader') }}</span>
            <span class="w-24 shrink-0">{{ $t('routingRuleActionHeader') }}</span>
            <span class="w-8 shrink-0" />
          </div>

          <Draggable
            v-model="draftRules"
            :animation="150"
            :force-fallback="true"
            handle=".rule-handle"
            ghost-class="opacity-40"
            item-key="key"
            class="flex flex-col gap-1.5"
          >
            <template #item="{ element: rule, index }: { element: RuleRow; index: number }">
              <div class="flex items-center gap-2">
                <Bars3Icon class="rule-handle text-base-content/40 h-4 w-4 shrink-0 cursor-move" />
                <select
                  v-model="rule.type"
                  class="select select-sm w-32 shrink-0"
                >
                  <option
                    v-for="type in REGION_RULE_TYPES"
                    :key="type"
                    :value="type"
                  >
                    {{ type }}
                  </option>
                </select>
                <!-- geosite/geoip 的值来自上游真有的那份名单,给带搜索的下拉框;
                     域名/IP 那几类是用户自己写的,给普通输入框 -->
                <GeoCategorySelect
                  v-if="rule.type === 'geosite' || rule.type === 'geoip'"
                  v-model="rule.value"
                  :kind="rule.type"
                  :placeholder="RULE_PLACEHOLDER[rule.type]"
                  class="min-w-0 flex-1"
                />
                <input
                  v-else
                  v-model="rule.value"
                  type="text"
                  class="input input-sm min-w-0 flex-1 font-mono text-xs"
                  :placeholder="RULE_PLACEHOLDER[rule.type]"
                />
                <select
                  v-model="rule.action"
                  class="select select-sm w-24 shrink-0"
                >
                  <option value="direct">{{ $t('direct') }}</option>
                  <option value="proxy">{{ $t('routingRegionViaProxy') }}</option>
                </select>
                <button
                  type="button"
                  class="btn btn-ghost btn-square btn-sm hover:text-error"
                  :aria-label="$t('delete')"
                  @click="draftRules.splice(index, 1)"
                >
                  <TrashIcon class="h-4 w-4" />
                </button>
              </div>
            </template>
          </Draggable>

          <p
            v-if="!draftRules.length"
            class="text-base-content/50 text-xs"
          >
            {{ $t('routingRegionNoRules') }}
          </p>
        </div>

        <div class="flex w-40 flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('routingRegionFallbackLabel') }}</label>
          <select
            v-model="draft.catchAll"
            class="select select-sm w-full"
          >
            <option value="direct">{{ $t('direct') }}</option>
            <option value="proxy">{{ $t('routingRegionViaProxy') }}</option>
          </select>
        </div>

        <div class="flex items-center justify-between gap-2">
          <span class="text-base-content/60 min-w-0 truncate text-xs">{{ summary(previewRegion) }}</span>
          <button
            type="button"
            class="btn btn-primary btn-sm shrink-0"
            :disabled="saving || !dirty"
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

      <p class="text-base-content/50 text-xs">{{ $t('routingRegionDirectNote') }}</p>
    </div>

    <DialogWrapper
      v-model="showDelete"
      :title="$t('routingRegionDeleteTitle')"
    >
      <div class="flex flex-col gap-4 p-2">
        <p class="text-sm">{{ $t('routingRegionDeleteConfirm', { name: pendingDelete?.name || '' }) }}</p>
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
  </div>
</template>

<script setup lang="ts">
import type { OpenboxProfile, OpenboxRegion, OpenboxRegionRule, OpenboxRegionRuleType, OpenboxRuleAction } from '@/api/openbox'
import { REGION_RULE_TYPES, RULESET_TAG_PATTERN } from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import GeoCategorySelect from '@/components/common/GeoCategorySelect.vue'
import { showNotification } from '@/helper/notification'
import { Bars3Icon, PlusIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Draggable from 'vuedraggable'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const { t } = useI18n()

// 老档案里可能只有 regionMode,服务端也是这么认的(engine/routing-model.mjs),
// 界面上跟着认一遍,免得升级上来的人看到"一张卡都没选中"。
const LEGACY_MODE_TO_ID: Record<string, string> = { CN: 'cn', HKMO: 'hkmo', OTHER: 'other' }

const regions = computed<OpenboxRegion[]>(() => props.profile.routing.regions || [])
// 拖拽要求 v-model 绑一个 ref(vuedraggable 会整个替换数组),列表在本地存一份
const rows = ref<OpenboxRegion[]>([])
watch(regions, (value) => { rows.value = [...value] }, { immediate: true, deep: true })

const currentId = computed(() => {
  const routing = props.profile.routing
  const wanted = routing.regionId || LEGACY_MODE_TO_ID[routing.regionMode || ''] || ''
  const hit = regions.value.find((r) => r.id === wanted)
  return hit ? hit.id : regions.value[0]?.id || ''
})
const selected = computed(() => regions.value.find((r) => r.id === currentId.value) || null)
const selectedName = computed(() => selected.value?.name || '')

const RULE_PLACEHOLDER: Record<OpenboxRegionRuleType, string> = {
  geosite: 'cn',
  geoip: 'cn',
  domain: 'www.example.com',
  domainSuffix: 'google.com',
  ipcidr: '8.8.8.8/32',
}

// 卡片上那一行摘要:几条规则 + 其余流量去哪。规则内容太长,卡片里塞不下也没必要。
const summary = (region: OpenboxRegion | null) => {
  if (!region) return ''
  const fallback = region.catchAll === 'proxy' ? t('routingRegionViaProxy') : t('direct')
  const count = (region.rules || []).length
  if (!count) return t('routingRegionSummaryAll', { fallback })
  return t('routingRegionSummaryRules', { count, fallback })
}

const saving = ref(false)

type RegionPatch = { region?: string; routing?: Record<string, unknown> }

const persist = async (next: OpenboxRegion[], extra: RegionPatch = {}) => {
  await props.patchProfile({ ...extra, routing: { regions: next, ...extra.routing } })
}

// ---- 选中那条的设置,就地编辑 ----

const draft = ref<OpenboxRegion | null>(null)
// 拖拽要求 v-model 绑一个数组;每行再带一个稳定 key,不然改类型/值会打乱行的复用
interface RuleRow extends OpenboxRegionRule { key: number }
const draftRules = ref<RuleRow[]>([])
let ruleKeySeed = 0

const addRule = (type: OpenboxRegionRuleType = 'geosite', value = '', action: OpenboxRuleAction = 'direct') => {
  draftRules.value.push({ key: ++ruleKeySeed, type, value, action })
}

// 换一张卡就把编辑区重置成那条的值。没保存的改动会丢——比"改着 A 的规则却存到 B 上"
// 安全得多,而且按钮上就写着保存,不存在悄悄丢的问题。
watch(selected, (region) => {
  draft.value = region ? JSON.parse(JSON.stringify(region)) : null
  draftRules.value = (region?.rules || []).map((r) => ({ ...r, key: ++ruleKeySeed }))
}, { immediate: true })

// 存盘用的规则表:空值的行直接忽略(加了一行没填就是没填)
const cleanRules = (): OpenboxRegionRule[] =>
  draftRules.value
    .map((r) => ({ type: r.type, value: r.value.trim(), action: r.action }))
    .filter((r) => r.value)

const previewRegion = computed<OpenboxRegion | null>(() =>
  draft.value ? { ...draft.value, rules: cleanRules() } : null,
)

const ruleKey = (rules: OpenboxRegionRule[]) =>
  rules.map((r) => `${r.type}|${r.value}|${r.action}`).join('\n')

const dirty = computed(() => {
  const current = selected.value
  const next = draft.value
  if (!current || !next) return false
  return (
    current.name !== next.name.trim() ||
    ruleKey(current.rules || []) !== ruleKey(cleanRules()) ||
    (current.catchAll || 'proxy') !== (next.catchAll || 'proxy')
  )
})

const saveDraft = async () => {
  const current = draft.value
  if (!current || saving.value) return
  const name = current.name.trim()
  if (!name) {
    showNotification({ content: 'routingRegionNameRequired', type: 'alert-error' })
    return
  }
  const rules = cleanRules()
  // geosite/geoip 的值会被拼成 <type>-<value>.srs 的路径,和服务端同一道校验
  // (路径穿越防线,不是排版讲究)
  const badGeo = rules.some(
    (r) => (r.type === 'geosite' || r.type === 'geoip') && !RULESET_TAG_PATTERN.test(r.value),
  )
  if (badGeo) {
    showNotification({ content: 'routingRulesetInvalidChars', type: 'alert-error' })
    return
  }

  saving.value = true
  try {
    const item: OpenboxRegion = { ...current, name, rules }
    const next = rows.value.map((r) => (r.id === item.id ? item : r))
    // 改的正是当前生效那条,顶层 region(引导页看的那句人话)跟着更新
    await persist(next, { region: name })
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

const choose = async (region: OpenboxRegion) => {
  if (saving.value || region.id === currentId.value) return
  saving.value = true
  try {
    // region(顶层)只是给引导页看的一句人话,真正生效的是 routing.regionId
    await props.patchProfile({ region: region.name, routing: { regionId: region.id } })
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

// 新建即选中:加一个地区就是为了切过去,名字和规则在下面的设置里改。
const addRegion = async () => {
  if (saving.value) return
  const name = t('routingRegionNewName')
  const item: OpenboxRegion = { id: `region-${Date.now()}`, name, rules: [], catchAll: 'proxy' }
  saving.value = true
  try {
    await persist([...rows.value, item], { region: name, routing: { regionId: item.id } })
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
const pendingDelete = ref<OpenboxRegion | null>(null)
const askDelete = (region: OpenboxRegion) => {
  // 一条都不剩的话地区这一层就没了(所有流量落到直连),先拦住
  if (rows.value.length <= 1) {
    showNotification({ content: 'routingRegionDeleteLast', type: 'alert-error' })
    return
  }
  pendingDelete.value = region
  showDelete.value = true
}
const confirmDelete = async () => {
  const region = pendingDelete.value
  if (!region || saving.value) return
  saving.value = true
  try {
    const next = rows.value.filter((r) => r.id !== region.id)
    // 删掉的正好是选中那条时,明确把选中改到第一条,而不是留个指向空气的 regionId
    const extra = region.id === currentId.value
      ? { region: next[0].name, routing: { regionId: next[0].id } }
      : {}
    await persist(next, extra)
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
