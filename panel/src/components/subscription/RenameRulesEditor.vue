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

        <!-- 序号位数收成一行、推到最右:它是给序号补零的位数(不补零时 美国-10 会
             排在 美国-2 前面,因为节点名到处都按文本排序)。原先它和「无法识别地区
             时的标签」并排各占半格,一个只填 1 位数字的框占那么大一块并不划算。 -->
        <label class="ml-auto flex items-center gap-1.5 text-xs">
          <span class="text-base-content/50">{{ $t('subscriptionRenameSeqPadLabel') }}:</span>
          <input
            v-model.number="seqPad"
            type="number"
            min="1"
            max="4"
            class="input input-xs w-14"
            :title="$t('subscriptionRenameSeqPadHint')"
          />
        </label>
      </div>
      <p class="text-base-content/60 text-xs">
        {{ $t('subscriptionRenameTemplateExample', { example: templateExample }) }}
      </p>
      <!-- 前缀存的是开关而不是文本:存文本的话,用户改了订阅名,前缀还留着旧名字。
           手工改过名的节点不加前缀——那是用户指定的完整名字。 -->
      <label class="flex cursor-pointer items-center gap-2 text-xs">
        <input
          v-model="usePrefix"
          type="checkbox"
          class="checkbox checkbox-xs"
        />
        {{ $t('subscriptionRenamePrefixLabel', { sep: '|' }) }}
      </label>
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
      <!-- 顺序即优先级:matchRegion 返回第一个命中的地区,所以排在前面的先生效。
           比如「香港」排在「中国」前面,节点名「中国香港 01」才会被认成香港。
           handle 限定成那个图标:不限定的话按住输入框拖会变成拖行,连字都选不了。 -->
      <Draggable
        v-model="regionRows"
        :animation="150"
        :force-fallback="true"
        handle=".drag-handle"
        ghost-class="opacity-40"
        item-key="id"
        class="flex flex-col gap-1.5"
      >
        <template #item="{ element: row }">
          <div class="flex items-center gap-1.5">
            <Bars3Icon class="drag-handle text-base-content/40 h-4 w-4 shrink-0 cursor-move" />
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
        </template>
      </Draggable>
      <div>
        <p
          v-if="regionRows.length === 0"
          class="text-base-content/50 text-xs"
        >
          {{ $t('subscriptionRenameNoRows') }}
        </p>
      </div>
    </div>

    <!-- 「无法识别地区时的标签」紧跟在地区关键词后面:它就是这张表全都没命中时的
         兜底值,挨着它要兜底的那份清单最好懂。原来它在最上面和序号位数并排,离得远。 -->
    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium">{{ $t('subscriptionRenameUnknownLabel') }}</label>
      <input
        v-model="unknownLabel"
        type="text"
        class="input input-sm w-full"
      />
    </div>

    <!-- 特征不再是「标签 + 同义词」两层结构:命中哪个关键词就把那个词本身(转大写)
         写进节点名。所以这里只需要一行关键词,不再有标签列,也不再有多行增删。
         例:关键词填 iplc,ipv6,节点名 "美国 IPLC IPv6 01" → 美国-IPLC-IPV6-01。 -->
    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium">{{ $t('subscriptionRenameFeatureDictLabel') }}</label>
      <p class="text-base-content/50 text-xs">{{ $t('subscriptionRenameFeatureDictHint') }}</p>
      <input
        v-model="featureKeywordsText"
        type="text"
        class="input input-sm w-full"
        :placeholder="$t('subscriptionRenameKeywordsPlaceholder')"
      />
    </div>

    <!-- 过滤:命中就整条不导入。机场订阅里常混着「官网｜https://xxx」「请提工单开通」
         这类公告条目,它们不是节点,却会被当成节点参与分组、出现在策略组里。 -->
    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium">{{ $t('subscriptionRenameExcludeLabel') }}</label>
      <p class="text-base-content/50 text-xs">{{ $t('subscriptionRenameExcludeHint') }}</p>
      <input
        v-model="excludeKeywordsText"
        type="text"
        class="input input-sm w-full"
        :placeholder="$t('subscriptionRenameKeywordsPlaceholder')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxRenameOptions } from '@/api/openbox'
import {
  DEFAULT_EXCLUDE_KEYWORDS,
  DEFAULT_FEATURE_KEYWORDS,
  DEFAULT_REGION_DICT,
  DEFAULT_RENAME_TEMPLATE,
  DEFAULT_SEQ_PAD,
  DEFAULT_UNKNOWN_LABEL,
} from './rename-defaults'
import { ArrowUturnLeftIcon, Bars3Icon, PlusIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
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

const makeId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `row-${Math.random().toString(36).slice(2)}`

// 用不带空格的英文逗号拼接:分隔符本身就是逗号,后面那个空格只是显示习惯,
// 而它会让用户以为空格是格式的一部分(splitKeywords 本来就会 trim,加不加都能解析)。
const toRegionRows = (dict: { name: string; keywords: string[] }[]): RegionRow[] =>
  dict.map((entry) => ({ id: makeId(), name: entry.name, keywordsText: entry.keywords.join(',') }))

// 兼容旧档案:老的 featureDict 是 [{label, keywords}],扁平化成一条关键词表。
const toFeatureKeywords = (input: unknown): string[] => {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const item of input) {
    if (typeof item === 'string') {
      if (item.trim()) out.push(item.trim())
    } else if (item && Array.isArray((item as { keywords?: unknown }).keywords)) {
      for (const kw of (item as { keywords: unknown[] }).keywords) {
        if (String(kw).trim()) out.push(String(kw).trim())
      }
    }
  }
  return out
}

// 逐项回退到默认值:已存规则里缺哪一项(老版本存下的记录可能没有 featureDict)就用
// 默认补上,而不是整份 initial 有就全用、没有就全默认。
const init = props.initial
const unknownLabel = ref(init?.unknownLabel || DEFAULT_UNKNOWN_LABEL)
const seqPad = ref(init?.seqPad ?? DEFAULT_SEQ_PAD)
// 必须是 ref 而不是 reactive:vuedraggable 的 v-model 在拖放结束时会**整体赋一个新
// 数组**,reactive 数组没法被重新赋值,拖了不会生效。
const regionRows = ref<RegionRow[]>(
  toRegionRows(init?.regionDict?.length ? init.regionDict : DEFAULT_REGION_DICT),
)
// 特征只有一行:命中哪个关键词就显示哪个词(转大写)。旧档案里的两层 featureDict
// 会被扁平化过来,不至于一升级就把用户配过的词全丢掉。
const initialFeatureKeywords =
  toFeatureKeywords(init?.featureKeywords) .length
    ? toFeatureKeywords(init?.featureKeywords)
    : toFeatureKeywords(init?.featureDict).length
      ? toFeatureKeywords(init?.featureDict)
      : [...DEFAULT_FEATURE_KEYWORDS]
const featureKeywordsText = ref(initialFeatureKeywords.join(','))

// 过滤关键词。显式给了空数组就尊重"不过滤",只有整个字段缺失才回落到默认值——
// 否则用户清空这一栏、保存、再打开,默认词又自己冒回来了。
const excludeKeywordsText = ref(
  (Array.isArray(init?.excludeKeywords) ? init.excludeKeywords : DEFAULT_EXCLUDE_KEYWORDS).join(','),
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

// 用订阅名做前缀(「破晓 | 香港-01」),一眼看出节点来自哪个订阅。
const usePrefix = ref(init?.usePrefix === true)

const options = computed<OpenboxRenameOptions>(() => ({
  template: template.value || DEFAULT_RENAME_TEMPLATE,
  usePrefix: usePrefix.value,
  unknownLabel: unknownLabel.value.trim() || DEFAULT_UNKNOWN_LABEL,
  seqPad: Number.isFinite(seqPad.value) && seqPad.value > 0 ? Math.floor(seqPad.value) : DEFAULT_SEQ_PAD,
  regionDict: regionRows.value
    .filter((row) => row.name.trim() || row.keywordsText.trim())
    .map((row) => ({ code: row.id, name: row.name.trim(), keywords: splitKeywords(row.keywordsText) })),
  featureKeywords: splitKeywords(featureKeywordsText.value),
  excludeKeywords: splitKeywords(excludeKeywordsText.value),
}))

watch(
  options,
  (value) => {
    emit('change', value)
  },
  { immediate: true, deep: true },
)

const addRegionRow = () => {
  regionRows.value.push({ id: makeId(), name: '', keywordsText: '' })
}
const removeRegionRow = (id: string) => {
  const index = regionRows.value.findIndex((row) => row.id === id)
  if (index !== -1) regionRows.value.splice(index, 1)
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
  regionRows.value = toRegionRows(DEFAULT_REGION_DICT)
  usePrefix.value = false
  featureKeywordsText.value = DEFAULT_FEATURE_KEYWORDS.join(',')
  excludeKeywordsText.value = DEFAULT_EXCLUDE_KEYWORDS.join(',')
}
</script>
