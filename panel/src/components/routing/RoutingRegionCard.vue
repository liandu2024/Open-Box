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
          @click="openEditor(null)"
        >
          <PlusIcon class="h-4 w-4" />
          {{ $t('routingRegionAdd') }}
        </button>
      </div>

      <!-- 单选,选中的那条才生效;列表本身可以增删改、拖拽排序。预置的三条只是数据,
           改名/换规则集/删掉都行,所以这里不写死任何一条。 -->
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
        <template #item="{ element: region }">
          <div
            class="border-base-300/60 flex items-center gap-2 rounded-lg border p-2.5"
            :class="region.id === currentId && 'border-primary bg-primary/5'"
          >
            <Bars3Icon class="drag-handle text-base-content/40 h-4 w-4 shrink-0 cursor-move" />
            <input
              type="radio"
              class="radio radio-sm shrink-0"
              :checked="region.id === currentId"
              :disabled="saving"
              @change="choose(region)"
            />
            <div
              class="min-w-0 flex-1 cursor-pointer"
              @click="choose(region)"
            >
              <div class="truncate text-sm font-medium">{{ region.name }}</div>
              <div class="text-base-content/60 mt-0.5 truncate text-xs">{{ summary(region) }}</div>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-square btn-sm"
              :aria-label="$t('edit')"
              @click="openEditor(region)"
            >
              <PencilSquareIcon class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-square btn-sm hover:text-error"
              :aria-label="$t('delete')"
              @click="askDelete(region)"
            >
              <TrashIcon class="h-4 w-4" />
            </button>
          </div>
        </template>
      </Draggable>

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

    <DialogWrapper
      v-model="showEditor"
      :title="$t(editing ? 'routingRegionEditTitle' : 'routingRegionAddTitle')"
      box-class="w-full max-w-xl"
    >
      <div
        v-if="draft"
        class="flex flex-col gap-4"
      >
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('routingRegionNameLabel') }}</label>
          <input
            v-model="draft.name"
            type="text"
            class="input input-sm w-full"
            :placeholder="$t('routingRegionNamePlaceholder')"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('routingRegionRulesetsLabel') }}</label>
          <input
            v-model="draftRulesets"
            type="text"
            class="input input-sm w-full font-mono text-xs"
            :placeholder="$t('routingRegionRulesetsPlaceholder')"
          />
          <p class="text-base-content/50 text-xs">{{ $t('routingRegionRulesetsHint') }}</p>
        </div>

        <div class="flex gap-3">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('routingRegionTargetLabel') }}</label>
            <select
              v-model="draft.target"
              class="select select-sm w-full"
            >
              <option value="direct">{{ $t('direct') }}</option>
              <option value="proxy">{{ $t('routingRegionViaProxy') }}</option>
            </select>
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('routingRegionFallbackLabel') }}</label>
            <select
              v-model="draft.fallback"
              class="select select-sm w-full"
            >
              <option value="direct">{{ $t('direct') }}</option>
              <option value="proxy">{{ $t('routingRegionViaProxy') }}</option>
            </select>
          </div>
        </div>

        <p class="text-base-content/60 bg-base-200/60 rounded-lg p-2 text-xs">{{ summary(previewRegion) }}</p>

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
import type { OpenboxProfile, OpenboxRegion } from '@/api/openbox'
import { RULESET_TAG_PATTERN } from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { showNotification } from '@/helper/notification'
import { Bars3Icon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Draggable from 'vuedraggable'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const { t } = useI18n()

// 老档案里可能只有 regionMode,服务端也是这么认的(engine/routing-model.mjs),
// 界面上跟着认一遍,免得升级上来的人看到"一条都没选中"。
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

// 一句话说清这条地区到底生成什么规则,不然光看名字分不出三条的区别。
const summary = (region: OpenboxRegion | null) => {
  if (!region) return ''
  const fallback = region.fallback === 'proxy' ? t('routingRegionViaProxy') : t('direct')
  const list = region.rulesets || []
  if (!list.length) return t('routingRegionSummaryAll', { fallback })
  const target = region.target === 'proxy' ? t('routingRegionViaProxy') : t('direct')
  return t('routingRegionSummary', { rulesets: list.join(', '), target, fallback })
}

const saving = ref(false)

type RegionPatch = { region?: string; routing?: Record<string, unknown> }

const persist = async (next: OpenboxRegion[], extra: RegionPatch = {}) => {
  await props.patchProfile({ ...extra, routing: { regions: next, ...extra.routing } })
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

const showEditor = ref(false)
const editing = ref<OpenboxRegion | null>(null)
const draft = ref<OpenboxRegion | null>(null)
const draftRulesets = ref('')

const splitList = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean)

const previewRegion = computed<OpenboxRegion | null>(() =>
  draft.value ? { ...draft.value, rulesets: splitList(draftRulesets.value) } : null,
)

const openEditor = (region: OpenboxRegion | null) => {
  editing.value = region
  draft.value = region
    ? JSON.parse(JSON.stringify(region))
    : { id: '', name: '', rulesets: [], target: 'direct', fallback: 'proxy' }
  draftRulesets.value = (region?.rulesets || []).join(',')
  showEditor.value = true
}

const saveDraft = async () => {
  if (!draft.value || saving.value) return
  const name = draft.value.name.trim()
  if (!name) {
    showNotification({ content: 'routingRegionNameRequired', type: 'alert-error' })
    return
  }
  const rulesets = splitList(draftRulesets.value)
  // 规则集 tag 会被拼进 .srs 路径,和服务端同一道校验(路径穿越防线,不是排版讲究)
  if (rulesets.some((tag) => !RULESET_TAG_PATTERN.test(tag))) {
    showNotification({ content: 'routingRulesetInvalidChars', type: 'alert-error' })
    return
  }

  const item: OpenboxRegion = {
    ...draft.value,
    id: draft.value.id || `region-${Date.now()}`,
    name,
    rulesets,
  }

  saving.value = true
  try {
    const next = editing.value
      ? rows.value.map((r) => (r.id === editing.value?.id ? item : r))
      : [...rows.value, item]
    // 新建的那条顺手选中:新增一个地区就是为了切过去,不然还要再点一次
    await persist(next, editing.value ? {} : { region: name, routing: { regionId: item.id } })
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
