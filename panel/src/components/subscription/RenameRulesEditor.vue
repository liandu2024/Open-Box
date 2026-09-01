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
      <label class="text-xs font-medium">{{ $t('subscriptionRenameTemplateLabel') }}</label>
      <input
        v-model="template"
        type="text"
        class="input input-sm w-full font-mono"
        :placeholder="DEFAULT_RENAME_TEMPLATE"
      />
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-base-content/50 text-xs">{{ $t('subscriptionRenameTokensHint') }}</span>
        <button
          v-for="token in ['{region}', '{feature}', '{seq}']"
          :key="token"
          type="button"
          class="badge badge-outline badge-sm font-mono hover:badge-primary"
          @click="insertToken(token)"
        >
          {{ token }}
        </button>
      </div>
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
import { ArrowUturnLeftIcon, PlusIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { computed, reactive, ref, watch } from 'vue'

const emit = defineEmits<{
  change: [OpenboxRenameOptions]
}>()

// 编辑已有订阅时用它的已存规则起步。没有这个 prop 的话编辑器总是从默认词典起步,
// 而它挂载时就会 emit 一次(watch immediate),等于一打开编辑弹窗就把用户辛苦调过的
// 重命名规则悄悄改回默认——保存下去才发现节点名全变了。
const props = defineProps<{ initial?: OpenboxRenameOptions | null }>()

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
const template = ref(init?.template || DEFAULT_RENAME_TEMPLATE)
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
const options = computed<OpenboxRenameOptions>(() => ({
  template: template.value.trim() || DEFAULT_RENAME_TEMPLATE,
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

const insertToken = (token: string) => {
  const current = template.value
  if (current.includes(token)) return
  template.value = current && !/[-_/\s]$/.test(current) ? `${current}-${token}` : `${current}${token}`
}

const resetToDefaults = () => {
  template.value = DEFAULT_RENAME_TEMPLATE
  unknownLabel.value = DEFAULT_UNKNOWN_LABEL
  seqPad.value = DEFAULT_SEQ_PAD
  regionRows.splice(0, regionRows.length, ...toRegionRows(DEFAULT_REGION_DICT))
  featureRows.splice(0, featureRows.length, ...toFeatureRows(DEFAULT_FEATURE_DICT))
}
</script>
