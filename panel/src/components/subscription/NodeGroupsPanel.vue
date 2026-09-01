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
              <input
                v-model="draft.interval"
                type="text"
                class="input input-sm w-24"
                placeholder="3m"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs font-medium">{{ $t('groupTolerance') }}</label>
              <input
                v-model.number="draft.tolerance"
                type="number"
                min="0"
                class="input input-sm w-24"
              />
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

        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input
            v-model="draft.allNodes"
            type="checkbox"
            class="checkbox checkbox-sm"
          />
          {{ $t('groupAllNodes') }}
        </label>
        <p class="text-base-content/50 -mt-2 text-xs">{{ $t('groupAllNodesHint') }}</p>

        <template v-if="!draft.allNodes">
          <div class="flex items-center justify-between gap-2">
            <label class="text-xs font-medium">
              {{ $t('groupMembersLabel') }} ({{ draft.members.length }})
            </label>
            <input
              v-model="memberFilter"
              type="text"
              class="input input-sm w-48"
              :placeholder="$t('groupMemberFilter')"
            />
          </div>
          <div class="border-base-content/10 max-h-64 overflow-y-auto rounded-lg border">
            <p
              v-if="!filteredCandidates.length"
              class="text-base-content/50 p-3 text-center text-sm"
            >
              {{ $t('groupNoCandidates') }}
            </p>
            <label
              v-for="item in filteredCandidates"
              :key="item.kind + item.name"
              class="hover:bg-base-200/60 flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm"
            >
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                :checked="draft.members.includes(item.name)"
                @change="toggleMember(item.name)"
              />
              <span class="truncate">{{ item.name }}</span>
              <span
                v-if="item.kind === 'group'"
                class="badge badge-ghost badge-xs ml-auto"
              >{{ $t('groupsTab') }}</span>
            </label>
          </div>
        </template>

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
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { routingPendingDeploy } from '@/store/routing'
import { PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const groups = ref<OpenboxUserGroup[]>([])
const availableNodes = ref<string[]>([])
const loading = ref(false)
const error = ref('')

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
  memberFilter.value = ''
  editorError.value = ''
  showEditor.value = true
}

// 候选成员 = 所有节点 + 除自己以外的其它组(组可以套组,但不能套自己)
const candidates = computed(() => {
  const nodeItems = availableNodes.value.map((name) => ({ kind: 'node' as const, name }))
  const groupItems = groups.value
    .filter((g) => g.name !== draft.value?.name)
    .map((g) => ({ kind: 'group' as const, name: g.name }))
  return [...groupItems, ...nodeItems]
})

const filteredCandidates = computed(() => {
  const kw = memberFilter.value.trim().toLowerCase()
  if (!kw) return candidates.value
  return candidates.value.filter((item) => item.name.toLowerCase().includes(kw))
})

const toggleMember = (name: string) => {
  if (!draft.value) return
  const set = new Set(draft.value.members)
  if (set.has(name)) set.delete(name)
  else set.add(name)
  draft.value.members = [...set]
}

const persist = async (next: OpenboxUserGroup[]) => {
  const res = await saveNodeGroups(next)
  groups.value = res.groups
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
  if (!draft.value.allNodes && !draft.value.members.length) {
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
