<template>
  <div class="flex flex-col gap-3">
    <div
      v-if="loading && !groups.length"
      class="flex justify-center py-10"
    >
      <span class="loading loading-spinner loading-md" />
    </div>

    <!-- 顺序有意义:生成配置时按这个顺序出策略组,内核和代理页里的排列跟着它走。
         handle 限定在那个图标上——不限定的话,按住卡片任意处都会开始拖,连"编辑"
         按钮都不好点了。 -->
    <Draggable
      v-else
      v-model="groups"
      :animation="150"
      :force-fallback="true"
      :fallback-on-body="true"
      handle=".drag-handle"
      ghost-class="opacity-40"
      item-key="id"
      class="flex flex-col gap-2"
      @end="persistOrder"
    >
      <template #item="{ element: group }">
      <div
        class="card bg-base-100 border-base-content/10 flex flex-row items-center gap-2 border p-3"
        :class="group.enabled === false && 'opacity-50'"
      >
        <Bars3Icon class="drag-handle text-base-content/40 h-4 w-4 shrink-0 cursor-move" />
        <CountryFlag
          v-if="group.icon"
          :code="group.icon"
          :size="18"
          :scale="group.iconScale"
          :title="group.icon"
        />
        <div class="min-w-0 flex-1">
          <!-- 窄屏上名字和类型标签放不下一行就让标签换到下一行,不要把名字挤成「所有…」、
               标签自己折成两行叠在名字上 -->
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="max-w-full truncate text-base font-medium">{{ group.name }}</span>
            <span
              v-if="group.kind"
              class="badge badge-ghost badge-sm shrink-0 whitespace-nowrap"
            >{{ $t('groupBuiltinBadge') }}</span>
            <span
              v-else
              class="badge badge-outline badge-sm shrink-0 whitespace-nowrap"
            >{{ $t(`groupType_${group.type}`) }}</span>
            <StatusBadge
              v-if="group.enabled === false"
              :on="false"
              on-text=""
              :off-text="$t('groupDisabledBadge')"
            />
          </div>
          <div class="text-base-content/60 mt-0.5 text-xs">
            <template v-if="group.kind">
              {{ $t(group.kind === 'direct' ? 'groupBuiltinDirectSummary' : 'groupBuiltinBlockSummary') }}
            </template>
            <template v-else>
              {{ memberSummary(group) }}
              <template v-if="group.type === 'urltest'">
                · {{ $t('groupInterval') }} {{ group.interval }} · {{ $t('groupTolerance') }} {{ group.tolerance }}ms
              </template>
            </template>
          </div>
        </div>
        <!-- 启用/停用:停用 = 不写进配置、站点集里选不到。放在编辑前面。 -->
        <button
          type="button"
          class="btn btn-ghost btn-square btn-sm"
          :class="group.enabled === false ? 'text-base-content/40' : 'text-success'"
          :aria-label="$t(group.enabled === false ? 'groupEnable' : 'groupDisable')"
          v-tip="$t(group.enabled === false ? 'groupEnable' : 'groupDisable')"
          :disabled="toggling === group.id"
          @click="toggleEnabled(group)"
        >
          <PowerIcon class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-square btn-sm"
          :aria-label="$t('groupEdit')"
          @click="group.kind ? openBuiltinEditor(group) : openEditor(group)"
        >
          <PencilSquareIcon class="h-4 w-4" />
        </button>
        <!-- 内置的直连/拒绝删不掉:内核离不开 direct,拒绝是站点集里「拒绝」的实体。
             按钮照样摆着(置灰、不可点),每一行的按钮列才对得齐。 -->
        <button
          type="button"
          class="btn btn-ghost btn-square btn-sm"
          :class="group.kind ? 'text-base-content/30 cursor-not-allowed' : 'hover:text-error'"
          :aria-disabled="Boolean(group.kind) || undefined"
          :aria-label="$t('delete')"
          v-tip="group.kind ? $t('groupBuiltinNoDelete') : $t('delete')"
          @click="!group.kind && askDelete(group)"
        >
          <TrashIcon class="h-4 w-4" />
        </button>
      </div>
      </template>
    </Draggable>

    <DialogWrapper
      v-model="showBuiltinEditor"
      :title="$t('groupEditTitle')"
      box-class="w-full max-w-2xl"
    >
      <div
        v-if="builtinDraft"
        class="flex flex-col gap-4"
      >
        <div class="flex items-end gap-2">
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupIconLabel') }}</label>
            <div class="w-56">
              <CountrySelect
                v-model="builtinDraft.icon"
                clearable
                globes
                brands
                :placeholder="$t('groupIconNone')"
              />
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('iconScaleLabel') }}</label>
            <IconScaleInput v-model="builtinDraft.iconScale" />
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <label class="text-xs font-medium">{{ $t('groupNameLabel') }}</label>
            <input
              v-model="builtinDraft.name"
              type="text"
              class="input input-sm w-full"
            />
          </div>
        </div>
        <p class="text-base-content/50 text-xs">{{ $t('groupBuiltinEditHint') }}</p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showBuiltinEditor = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="saving"
            @click="saveBuiltin"
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

    <!-- 添加/修改分组的弹窗抽成了独立组件:代理页的节点卡片上也要能就地改一个组 -->
    <NodeGroupEditorDialog
      ref="editorRef"
      @saved="handleEditorSaved"
    />

    <!-- 删掉一个组是不可撤销的(而且组名可能已经被分流规则指着),和删订阅一样
         先确认一次,样式沿用同一个 DialogWrapper。 -->
    <DialogWrapper
      v-model="showDeleteDialog"
      :title="$t('groupDeleteTitle')"
    >
      <div class="flex flex-col gap-4 p-2">
        <p class="text-sm">
          {{ $t('groupDeleteConfirm', { name: pendingDelete?.name || '' }) }}
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showDeleteDialog = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-error btn-sm"
            :disabled="deleting"
            @click="confirmDelete"
          >
            <span
              v-if="deleting"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('confirm') }}
          </button>
        </div>
      </div>
    </DialogWrapper>

    <!-- 自动分组:按国家批量建组。手工建的话,一个国家要点开弹窗、挑规则、写关键词、
         选图标,十个国家就是十遍——而这些信息国家目录里全都有。 -->
    <DialogWrapper
      v-model="showAuto"
      :title="$t('groupAutoTitle')"
      box-class="w-full max-w-xl"
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('groupAutoTypesLabel') }}</label>
          <div class="flex items-center gap-4">
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input
                v-model="autoTypes"
                type="checkbox"
                value="urltest"
                class="checkbox checkbox-sm"
              />
              {{ $t('groupType_urltest') }}
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input
                v-model="autoTypes"
                type="checkbox"
                value="selector"
                class="checkbox checkbox-sm"
              />
              {{ $t('groupType_selector') }}
            </label>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <label class="text-xs font-medium">{{ $t('groupAutoCountriesLabel') }}</label>
            <!-- 用下拉框往里加,而不是把几十个国家铺成一列勾选框:常用的那几个已经
                 默认摆好了,剩下的按需搜索添加。 -->
            <div class="ml-auto w-36">
              <CountrySelect
                model-value=""
                :only="addableCountries"
                :placeholder="$t('groupAutoAddCountry')"
                @update:model-value="addAutoCountry"
              />
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              :disabled="!autoCountries.length"
              @click="autoCountries = []"
            >
              {{ $t('groupSelectNone') }}
            </button>
          </div>
          <div class="border-base-content/10 max-h-64 overflow-y-auto rounded-lg border">
            <p
              v-if="!autoCountries.length"
              class="text-base-content/50 p-4 text-center text-xs"
            >
              {{ $t('groupAutoEmpty') }}
            </p>
            <Draggable
              v-model="autoCountries"
              :animation="150"
              :force-fallback="true"
              :fallback-on-body="true"
              handle=".drag-handle"
              ghost-class="opacity-40"
              item-key="self"
            >
              <template #item="{ element: code }">
              <div
                v-if="autoRow(code)"
                class="flex items-center gap-2 px-3 py-1.5 text-sm"
              >
                <Bars3Icon class="drag-handle text-base-content/40 h-4 w-4 shrink-0 cursor-move" />
                <CountryFlag
                  :code="code"
                  :size="16"
                />
                <span class="truncate">{{ autoRow(code)?.label }}</span>
                <!-- 当前节点数只是参考:0 也照样能建,动态组等的就是以后会有的节点 -->
                <span class="text-base-content/50 ml-auto text-xs whitespace-nowrap">
                  {{ $t('groupAutoNodeCount', { count: autoRow(code)?.count ?? 0 }) }}
                </span>
                <button
                  type="button"
                  class="btn btn-ghost btn-circle btn-xs shrink-0"
                  :aria-label="$t('subscriptionRenameRemoveRow')"
                  @click="autoCountries = autoCountries.filter((x) => x !== code)"
                >
                  <XMarkIcon class="h-3.5 w-3.5" />
                </button>
              </div>
              </template>
            </Draggable>
          </div>
        </div>

        <p class="text-base-content/50 text-xs">{{ $t('groupAutoHint') }}</p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showAuto = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="autoSaving || !autoCountries.length || !autoTypes.length"
            @click="createAutoGroups"
          >
            <span
              v-if="autoSaving"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('groupAutoCreate', { count: autoCountries.length * autoTypes.length }) }}
          </button>
        </div>
      </div>
    </DialogWrapper>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxGroupType, OpenboxUserGroup } from '@/api/openbox'
import { fetchNodeGroups, saveNodeGroups } from '@/api/openbox'
import CountryFlag from '@/components/common/CountryFlag.vue'
import CountrySelect from '@/components/common/CountrySelect.vue'
import IconScaleInput from '@/components/common/IconScaleInput.vue'
import { AUTO_GROUP_DEFAULT_COUNTRIES, COUNTRIES, countryName, findCountry } from '@/constant/countries'
import { keywordMatches, normalizeForMatch } from '@/helper/keywordMatch'
import NodeGroupEditorDialog from '@/components/subscription/NodeGroupEditorDialog.vue'
import { matchedNodeNames, notifyGroupError, reportGroupSaveResult } from '@/components/subscription/nodeGroupsShared'
import { showNotification } from '@/helper/notification'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import {
  Bars3Icon,
  PencilSquareIcon,
  PowerIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import Draggable from 'vuedraggable'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()

const groups = ref<OpenboxUserGroup[]>([])
const availableNodes = ref<Array<{ name: string; subscription: string }>>([])
const loading = ref(false)
const load = async () => {
  loading.value = true
  try {
    const data = await fetchNodeGroups()
    groups.value = data.groups
    availableNodes.value = data.availableNodes
  } catch (err) {
    notifyGroupError(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// 动态组报"按当前节点算出来是几个",静态组报名单里有几个。动态组的数字会随订阅
// 变化,这正是它的意义所在,所以列表里就该显示算出来的那个数,而不是关键词条数。
const matchedNodes = (group: OpenboxUserGroup) =>
  matchedNodeNames(group, availableNodes.value.map((n) => n.name))

const memberSummary = (group: OpenboxUserGroup) =>
  group.mode === 'dynamic'
    ? t('groupDynamicSummary', { count: matchedNodes(group).length })
    : t('groupMembersSummary', { count: group.members.length })

// 添加/修改分组:弹窗在 NodeGroupEditorDialog 里,这里只负责打开它、拿回保存后的新列表
const editorRef = useTemplateRef<InstanceType<typeof NodeGroupEditorDialog>>('editorRef')
const openEditor = (group: OpenboxUserGroup | null) => editorRef.value?.open(group)
const handleEditorSaved = (res: { groups: OpenboxUserGroup[] }) => {
  groups.value = res.groups
}

// ---------- 自动分组 ----------
const showAuto = ref(false)
const autoTypes = ref<OpenboxGroupType[]>(['urltest'])
const autoCountries = ref<string[]>([])
const autoSaving = ref(false)

// 每个已选国家当前命中几个节点(只是参考,0 也能建)。列表顺序由 autoCountries
// 本身决定——它就是拖拽排序的那个数组,所以不能再套一层 computed 去重排。
const autoNodeCount = computed(() => {
  const names = availableNodes.value.map((n) => normalizeForMatch(n.name))
  const out: Record<string, number> = {}
  for (const c of COUNTRIES) {
    out[c.code] = names.filter((n) => c.keywords.some((kw) => keywordMatches(n, kw))).length
  }
  return out
})

const autoRow = (code: string) => {
  const c = findCountry(code)
  if (!c) return null
  return { code: c.code, label: countryName(c, locale.value), count: autoNodeCount.value[c.code] ?? 0 }
}

// 下拉框里只给"当前节点里真有的国家",并且已经加过的不再出现:选了也没用的选项
// 不该摆在那儿。按节点数从多到少排,常用的在最上面。
const addableCountries = computed(() => {
  const counts = autoNodeCount.value
  return COUNTRIES.map((c) => c.code)
    .filter((code) => (counts[code] ?? 0) > 0 && !autoCountries.value.includes(code))
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
})

const addAutoCountry = (code: string) => {
  if (!code || autoCountries.value.includes(code)) return
  autoCountries.value = [...autoCountries.value, code]
}

const openAutoDialog = () => {
  autoTypes.value = ['urltest']
  autoCountries.value = [...AUTO_GROUP_DEFAULT_COUNTRIES]
  showAuto.value = true
}

const AUTO_SUFFIX: Record<OpenboxGroupType, string> = {
  urltest: '自动',
  selector: '手动',
}

// 同一个国家的组要挨在一起,自动排在手动前面。分两次生成(先建一批自动,过几天
// 再补手动)的话,新的会被追加到末尾,同一个国家就被拆到列表的两头了。
// 认国家靠 icon 里的两位国家代码——自动分组生成时一定会写上它。
const TYPE_ORDER: Record<string, number> = { urltest: 0, selector: 1 }
const countryOf = (g: OpenboxUserGroup) =>
  g.icon && /^[A-Za-z]{2}$/.test(g.icon) ? g.icon.toUpperCase() : ''

// 把这次涉及到的国家整理成块:同国家的(已有的 + 新建的)聚到一起,放在该国家
// 第一个已有组的位置上;没有已有组的国家整块追加到末尾。不碰其它国家的顺序——
// 用户可能是自己拖成那样的。
const mergeByCountry = (current: OpenboxUserGroup[], added: OpenboxUserGroup[]) => {
  const codes = [...new Set(added.map(countryOf).filter(Boolean))]
  const byType = (a: OpenboxUserGroup, b: OpenboxUserGroup) =>
    (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)

  let out = [...current]
  for (const code of codes) {
    const mine = [...out.filter((g) => countryOf(g) === code), ...added.filter((g) => countryOf(g) === code)]
    mine.sort(byType)
    const anchor = out.findIndex((g) => countryOf(g) === code)
    out = out.filter((g) => countryOf(g) !== code)
    out.splice(anchor === -1 ? out.length : anchor, 0, ...mine)
  }
  // 认不出国家的(比如图标被改成地球)照旧追加到末尾
  return [...out, ...added.filter((g) => !countryOf(g))]
}

const createAutoGroups = async () => {
  if (autoSaving.value) return
  const existing = new Set(groups.value.map((g) => g.name))
  const next: OpenboxUserGroup[] = []
  let skipped = 0
  for (const code of autoCountries.value) {
    const country = findCountry(code)
    if (!country) continue
    for (const type of autoTypes.value) {
      const name = `${countryName(country, locale.value)}-${AUTO_SUFFIX[type]}`
      // 同名的跳过:组名就是内核里的出站名,重名会生成两个同名出站
      if (existing.has(name)) {
        skipped += 1
        continue
      }
      existing.add(name)
      next.push({
        id: `auto-${code.toLowerCase()}-${type}-${Date.now()}-${next.length}`,
        name,
        type,
        mode: 'dynamic',
        icon: code,
        // 关键词直接用国家目录里的那份,和地区词典是同一套词
        keywords: [...country.keywords],
        members: [],
        ...(type === 'urltest' ? { interval: '5m', tolerance: 100 } : {}),
      })
    }
  }

  if (!next.length) {
    showNotification({ content: 'groupAutoAllExist', type: 'alert-error' })
    return
  }

  autoSaving.value = true
  try {
    await persist(mergeByCountry(groups.value, next))
    showAuto.value = false
    if (skipped) {
      showNotification({
        content: 'groupAutoSkipped',
        params: { count: String(skipped) },
        type: 'alert-info',
      })
    }
  } catch (err) {
    notifyGroupError(err)
  } finally {
    autoSaving.value = false
  }
}

// 两个入口都在父组件的页签行上,弹窗在这里,所以要把它们暴露出去
defineExpose({ openEditor, openAutoDialog })

// 拖完就存:顺序也是配置的一部分(策略组在内核里的排列),不存下来刷新就白拖了
const persistOrder = async () => {
  try {
    await persist([...groups.value])
  } catch (err) {
    notifyGroupError(err)
  }
}

const persist = async (next: OpenboxUserGroup[]) => {
  const res = await saveNodeGroups(next)
  groups.value = res.groups
  reportGroupSaveResult(res)
  return res
}

// ---- 启用/停用 ----
const toggling = ref<string | null>(null)
const toggleEnabled = async (group: OpenboxUserGroup) => {
  if (toggling.value) return
  toggling.value = group.id
  try {
    await persist(groups.value.map((g) => (g.id === group.id ? { ...g, enabled: g.enabled === false } : g)))
  } catch (err) {
    notifyGroupError(err)
  } finally {
    toggling.value = null
  }
}

// ---- 内置出站:只改名字、图标和图标缩放 ----
const saving = ref(false)
const showBuiltinEditor = ref(false)
const builtinDraft = ref<OpenboxUserGroup | null>(null)
const openBuiltinEditor = (group: OpenboxUserGroup) => {
  builtinDraft.value = JSON.parse(JSON.stringify(group))
  showBuiltinEditor.value = true
}
const saveBuiltin = async () => {
  const d = builtinDraft.value
  if (!d || saving.value) return
  const name = d.name.trim()
  if (!name) {
    showNotification({ content: 'groupNameRequired', type: 'alert-error' })
    return
  }
  // 名字就是内核里的出站 tag,和别的组重名同样不行
  if (groups.value.some((g) => g.name === name && g.id !== d.id)) {
    showNotification({ content: 'groupNameDuplicate', type: 'alert-error' })
    return
  }
  saving.value = true
  try {
    await persist(groups.value.map((g) => (g.id === d.id ? { ...g, name, icon: d.icon, iconScale: d.iconScale || 0 } : g)))
    showBuiltinEditor.value = false
  } catch (err) {
    notifyGroupError(err)
  } finally {
    saving.value = false
  }
}

const showDeleteDialog = ref(false)
const pendingDelete = ref<OpenboxUserGroup | null>(null)
const deleting = ref(false)

const askDelete = (group: OpenboxUserGroup) => {
  pendingDelete.value = group
  showDeleteDialog.value = true
}

const confirmDelete = async () => {
  const group = pendingDelete.value
  if (!group || deleting.value) return
  deleting.value = true
  try {
    await persist(groups.value.filter((g) => g.id !== group.id))
    showDeleteDialog.value = false
    pendingDelete.value = null
  } catch (err) {
    notifyGroupError(err)
  } finally {
    deleting.value = false
  }
}
</script>
