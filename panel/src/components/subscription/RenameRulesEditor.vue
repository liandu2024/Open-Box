<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold">{{ $t('subscriptionRenameEditorTitle') }}</h3>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        @click="resetToDefaults"
      >
        <ArrowUturnLeftIcon class="h-3.5 w-3.5" />
        {{ $t('reset') }}
      </button>
    </div>

    <!-- Template + unknown label + seq padding -->
    <div class="flex flex-col gap-2">
      <!-- 命名模板不再是一个要手写 {region}-{feature}-{seq} 的文本框:那对小白等于
           没说。改成三块可拖拽的牌子,拖出来的先后顺序就是节点名的组成顺序,分隔符
           固定用 "-"。下面那行实时显示算出来的样子。
           代价:自定义分隔符和模板里夹带的固定文字不再可编辑(旧配置若有,会在下次
           保存时按当前顺序规范化)。换来的是这一屏不用再解释什么叫占位符。 -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-base-content/50 text-xs">{{ $t('subscriptionRenameTokensHint') }}</span>
        <!-- force-fallback:走 Sortable 自己的指针实现,不用浏览器原生 HTML5 拖放。
             原生拖放会拖出一张浏览器自绘的半透明快照(小徽章上尤其难看),而且在触屏
             上行为不一致;fallback 模式拖的是 Sortable 复制出来的真实元素。 -->
        <Draggable
          v-model="tokenOrder"
          :animation="150"
          :force-fallback="true"
          class="flex flex-wrap items-center gap-1.5"
          ghost-class="opacity-40"
          :item-key="(item: string) => item"
        >
          <template #item="{ element: token }">
            <span
              class="badge badge-outline badge-sm cursor-move select-none"
              :title="token"
            >
              <Bars3Icon class="mr-1 h-3 w-3 opacity-50" />
              {{ $t(TOKEN_LABELS[token]) }}
            </span>
          </template>
        </Draggable>
      </div>
      <p class="text-base-content/60 text-xs">
        {{ $t('subscriptionRenameTemplateExample', { example: templateExample }) }}
      </p>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">{{ $t('subscriptionRenameUnknownLabel') }}</label>
        <input
          v-model="unknownLabel"
          type="text"
          class="input input-sm w-full"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">{{ $t('subscriptionRenameSeqPadLabel') }}</label>
        <input
          v-model.number="seqPad"
          type="number"
          min="1"
          max="4"
          class="input input-sm w-full"
        />
      </div>
    </div>

    <!-- Region dictionary -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <label class="text-xs font-medium">{{ $t('subscriptionRenameRegionDictLabel') }}</label>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          @click="addRegionRow"
        >
          <PlusIcon class="h-3.5 w-3.5" />
          {{ $t('subscriptionRenameAddRow') }}
        </button>
      </div>
      <p class="text-base-content/50 text-xs">{{ $t('subscriptionRenameRegionDictHint') }}</p>
      <div class="flex flex-col gap-1.5">
        <div
          v-for="row in regionRows"
          :key="row.id"
          class="flex items-center gap-1.5"
        >
          <input
            v-model="row.name"
            type="text"
            class="input input-sm w-24 shrink-0"
            :placeholder="$t('subscriptionRenameRegionNamePlaceholder')"
          />
          <input
            v-model="row.keywordsText"
            type="text"
            class="input input-sm min-w-0 flex-1"
            :placeholder="$t('subscriptionRenameKeywordsPlaceholder')"
          />
          <button
            type="button"
            class="btn btn-ghost btn-circle btn-xs shrink-0"
            :aria-label="$t('subscriptionRenameRemoveRow')"
            @click="removeRegionRow(row.id)"
          >
            <XMarkIcon class="h-3.5 w-3.5" />
          </button>
        </div>
        <p
          v-if="regionRows.length === 0"
          class="text-base-content/50 text-xs"
        >
          {{ $t('subscriptionRenameNoRows') }}
        </p>
      </div>
    </div>

    <!-- Feature dictionary -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <label class="text-xs font-medium">{{ $t('subscriptionRenameFeatureDictLabel') }}</label>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          @click="addFeatureRow"
        >
          <PlusIcon class="h-3.5 w-3.5" />
          {{ $t('subscriptionRenameAddRow') }}
        </button>
      </div>
      <p class="text-base-content/50 text-xs">{{ $t('subscriptionRenameFeatureDictHint') }}</p>
      <div class="flex flex-col gap-1.5">
        <div
          v-for="row in featureRows"
          :key="row.id"
          class="flex items-center gap-1.5"
        >
          <input
            v-model="row.label"
            type="text"
            class="input input-sm w-24 shrink-0"
            :placeholder="$t('subscriptionRenameFeatureLabelPlaceholder')"
          />
          <input
            v-model="row.keywordsText"
            type="text"
            class="input input-sm min-w-0 flex-1"
            :placeholder="$t('subscriptionRenameKeywordsPlaceholder')"
          />
          <button
            type="button"
            class="btn btn-ghost btn-circle btn-xs shrink-0"
            :aria-label="$t('subscriptionRenameRemoveRow')"
            @click="removeFeatureRow(row.id)"
          >
            <XMarkIcon class="h-3.5 w-3.5" />
          </button>
        </div>
        <p
          v-if="featureRows.length === 0"
          class="text-base-content/50 text-xs"
        >
          {{ $t('subscriptionRenameNoRows') }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxRenameOptions } from '@/api/openbox'
import {
  DEFAULT_FEATURE_DICT,
  DEFAULT_REGION_DICT,
  DEFAULT_RENAME_TEMPLATE,
  DEFAULT_SEQ_PAD,
  DEFAULT_UNKNOWN_LABEL,
} from './rename-defaults'
import { ArrowUturnLeftIcon, Bars3Icon, PlusIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Draggable from 'vuedraggable'

const emit = defineEmits<{
  change: [OpenboxRenameOptions]
}>()

// 编辑已有订阅时用它的已存规则起步。没有这个 prop 的话编辑器总是从默认词典起步,
// 而它挂载时就会 emit 一次(watch immediate),等于一打开编辑弹窗就把用户辛苦调过的
// 重命名规则悄悄改回默认——保存下去才发现节点名全变了。
const props = defineProps<{ initial?: OpenboxRenameOptions | null }>()

const { t } = useI18n()

interface RegionRow {
  id: string
  name: string
  keywordsText: string
}

interface FeatureRow {
  id: string
  label: string
  keywordsText: string
}

const makeId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `row-${Math.random().toString(36).slice(2)}`

const toRegionRows = (dict: { name: string; keywords: string[] }[]): RegionRow[] =>
  dict.map((entry) => ({ id: makeId(), name: entry.name, keywordsText: entry.keywords.join(', ') }))

const toFeatureRows = (dict: { label: string; keywords: string[] }[]): FeatureRow[] =>
  dict.map((entry) => ({ id: makeId(), label: entry.label, keywordsText: entry.keywords.join(', ') }))

// 逐项回退到默认值:已存规则里缺哪一项(老版本存下的记录可能没有 featureDict)就用
// 默认补上,而不是整份 initial 有就全用、没有就全默认。
const init = props.initial
const unknownLabel = ref(init?.unknownLabel || DEFAULT_UNKNOWN_LABEL)
const seqPad = ref(init?.seqPad ?? DEFAULT_SEQ_PAD)
const regionRows = reactive<RegionRow[]>(
  toRegionRows(init?.regionDict?.length ? init.regionDict : DEFAULT_REGION_DICT),
)
const featureRows = reactive<FeatureRow[]>(
  toFeatureRows(init?.featureDict?.length ? init.featureDict : DEFAULT_FEATURE_DICT),
)

const splitKeywords = (text: string) =>
  text
    .split(/[,，]/)
    .map((kw) => kw.trim())
    .filter(Boolean)

// Rows the user left completely blank (never typed a name/label or any keyword) are dropped
// from what gets sent — they're just an empty slot mid-edit, not a real (and invalid) dict entry.
// 记号 → 中文名。界面上只出现人话,拼进模板的仍是 {region} 这类记号。
const TOKEN_LABELS: Record<string, string> = {
  '{region}': 'subscriptionRenameTokenRegion',
  '{feature}': 'subscriptionRenameTokenFeature',
  '{seq}': 'subscriptionRenameTokenSeq',
}
const ALL_TOKENS = ['{region}', '{feature}', '{seq}']

// 从已存模板里读出记号顺序(模板里没出现的记号补在后面),这样打开旧订阅时牌子的
// 顺序和它原本的命名方式一致。
const orderFromTemplate = (tpl: string) => {
  const found = ALL_TOKENS
    .map((tk) => ({ tk, at: tpl.indexOf(tk) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.tk)
  return [...found, ...ALL_TOKENS.filter((tk) => !found.includes(tk))]
}

const tokenOrder = ref<string[]>(orderFromTemplate(init?.template || DEFAULT_RENAME_TEMPLATE))
// 顺序即模板。分隔符固定 "-";无特征时 applyTemplate 会把 {feature} 连同相邻的一个
// 分隔符一起去掉,所以三块牌子常驻不会留下 "美国--01" 这种空档。
const template = computed(() => tokenOrder.value.join('-'))

const options = computed<OpenboxRenameOptions>(() => ({
  template: template.value || DEFAULT_RENAME_TEMPLATE,
  unknownLabel: unknownLabel.value.trim() || DEFAULT_UNKNOWN_LABEL,
  seqPad: Number.isFinite(seqPad.value) && seqPad.value > 0 ? Math.floor(seqPad.value) : DEFAULT_SEQ_PAD,
  regionDict: regionRows
    .filter((row) => row.name.trim() || row.keywordsText.trim())
    .map((row) => ({ code: row.id, name: row.name.trim(), keywords: splitKeywords(row.keywordsText) })),
  featureDict: featureRows
    .filter((row) => row.label.trim() || row.keywordsText.trim())
    .map((row) => ({ label: row.label.trim(), keywords: splitKeywords(row.keywordsText) })),
}))

watch(
  options,
  (value) => {
    emit('change', value)
  },
  { immediate: true, deep: true },
)

const addRegionRow = () => {
  regionRows.push({ id: makeId(), name: '', keywordsText: '' })
}
const removeRegionRow = (id: string) => {
  const index = regionRows.findIndex((row) => row.id === id)
  if (index !== -1) regionRows.splice(index, 1)
}

const addFeatureRow = () => {
  featureRows.push({ id: makeId(), label: '', keywordsText: '' })
}
const removeFeatureRow = (id: string) => {
  const index = featureRows.findIndex((row) => row.id === id)
  if (index !== -1) featureRows.splice(index, 1)
}


// 拿当前模板 + 当前序号位数算一个真实样例,改模板时实时跟着变。序号用 seqPad 补零,
// 和真正改名时的行为一致,免得示例和结果对不上。
const templateExample = computed(() => {
  const pad = Number.isFinite(seqPad.value) && seqPad.value > 0 ? Math.floor(seqPad.value) : DEFAULT_SEQ_PAD
  return (template.value || DEFAULT_RENAME_TEMPLATE)
    .replace(/\{region\}/g, t('subscriptionRenameSampleRegion'))
    .replace(/\{feature\}/g, t('subscriptionRenameSampleFeature'))
    .replace(/\{seq\}/g, String(1).padStart(pad, '0'))
})

const resetToDefaults = () => {
  tokenOrder.value = orderFromTemplate(DEFAULT_RENAME_TEMPLATE)
  unknownLabel.value = DEFAULT_UNKNOWN_LABEL
  seqPad.value = DEFAULT_SEQ_PAD
  regionRows.splice(0, regionRows.length, ...toRegionRows(DEFAULT_REGION_DICT))
  featureRows.splice(0, featureRows.length, ...toFeatureRows(DEFAULT_FEATURE_DICT))
}
</script>
