<template>
  <section class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-base font-semibold">{{ $t('dfTitle') }}</h2>
          <input
            type="checkbox"
            class="toggle toggle-sm shrink-0"
            :aria-label="$t('dfTitle')"
            :checked="status.settings.enabled"
            :disabled="saving || busy"
            @change="toggle"
          />
          <span
            class="badge badge-sm"
            :class="
              status.pending ? 'badge-warning' : status.applied?.enabled ? 'badge-success' : ''
            "
            >{{
              $t(
                status.pending ? 'dfPending' : status.applied?.enabled ? 'dfEnabled' : 'dfDisabled',
              )
            }}</span
          >
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="busy || saving || !status.settings.lists.some((l) => l.enabled)"
            @click="$emit('update')"
          >
            {{ $t('dfUpdate') }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="busy || saving"
            @click="edit()"
          >
            {{ $t('dfAdd') }}
          </button>
        </div>
      </div>
      <p class="text-base-content/60 text-xs leading-relaxed">{{ $t('dfDescription') }}</p>
      <p
        v-if="!status.settings.lists.length"
        class="text-base-content/50 text-xs"
      >
        {{ $t('dfEmptyLists') }}
      </p>
      <div
        v-else
        class="divide-base-content/10 divide-y"
      >
        <div
          v-for="list in status.settings.lists"
          :key="list.id"
          class="flex items-center gap-2 py-2"
          :class="!list.enabled && 'opacity-50'"
        >
          <input
            type="checkbox"
            class="toggle toggle-sm shrink-0"
            :checked="list.enabled"
            :aria-label="`${$t('dfSwitch')} ${list.name}`"
            :disabled="busy || saving"
            @change="changeList(list, { enabled: !list.enabled })"
          />
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span class="truncate font-medium">{{ list.name }}</span>
            <span
              class="truncate font-mono"
              :title="list.url"
              >{{ list.url }}</span
            >
            <span class="text-base-content/50 tabular-nums">
              {{ $t('dfCount') }} {{ status.lists[list.id]?.count?.toLocaleString() ?? '—' }}
            </span>
            <span class="text-base-content/50">
              {{ $t('dfUpdated') }}
              {{
                status.lists[list.id]?.updatedAt
                  ? new Date(status.lists[list.id].updatedAt).toLocaleString()
                  : $t('dfNotDownloaded')
              }}
            </span>
            <span
              v-if="status.lists[list.id]?.unsupported"
              class="text-warning"
              :title="status.lists[list.id]?.unsupportedExamples?.join('\n')"
            >
              {{ $t('dfSkipped', { n: status.lists[list.id]?.unsupported }) }}
            </span>
            <p
              v-if="status.lists[list.id]?.error"
              class="text-error w-full break-words"
            >
              {{ status.lists[list.id].error }}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-square btn-xs"
            :aria-label="`${$t('dfPreview')} ${list.name}`"
            :title="$t('dfPreview')"
            @click="preview(list)"
          >
            <EyeIcon class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-square btn-xs"
            :aria-label="`${$t('dfEdit')} ${list.name}`"
            :disabled="busy || saving"
            @click="edit(list)"
          >
            <PencilSquareIcon class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-square btn-xs hover:text-error"
            :aria-label="`${$t('dfDelete')} ${list.name}`"
            :disabled="busy || saving"
            @click="askDelete(list)"
          >
            <TrashIcon class="h-4 w-4" />
          </button>
        </div>
      </div>
      <div class="border-base-300/50 border-t pt-3">
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 font-medium"
          :aria-expanded="allowExpanded"
          aria-controls="dns-filter-allow-domains"
          @click="allowExpanded = !allowExpanded"
        >
          <ChevronDownIcon
            class="h-4 w-4 transition-transform"
            :class="allowExpanded && 'rotate-180'"
          />
          {{ $t('dfAllow') }}
          <span class="text-base-content/50">({{ status.settings.allowDomains.length }})</span>
        </button>
        <div
          v-show="allowExpanded"
          id="dns-filter-allow-domains"
        >
          <p class="text-base-content/60 my-2 text-xs">{{ $t('dfAllowHint') }}</p>
          <textarea
            v-model="allowText"
            class="textarea w-full font-mono text-xs"
            rows="3"
            :aria-label="$t('dfAllow')"
            placeholder="example.com&#10;*.example.com"
          />
          <button
            type="button"
            class="btn btn-sm mt-2"
            :disabled="busy || saving"
            @click="saveAllow"
          >
            {{ $t('dfSaveAllow') }}
          </button>
        </div>
      </div>
    </div>
    <DialogWrapper
      :model-value="showEditor && !showPreview"
      @update:model-value="showEditor = !!$event"
      :title="$t('dfEditList')"
      box-class="w-full max-w-lg"
    >
      <form
        v-if="editing"
        class="flex flex-col gap-3"
        @submit.prevent="saveEdit"
      >
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium">{{ $t('dfName') }}</span>
          <input
            v-model="editing.name"
            class="input input-sm w-full"
            maxlength="80"
            required
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium">{{ $t('dfUrl') }}</span>
          <div class="relative">
            <input
              v-model="editing.url"
              class="input input-sm w-full pr-8 font-mono"
              type="url"
              maxlength="2048"
              placeholder="https://example.com/filter.txt"
              required
            />
            <button
              type="button"
              class="btn btn-ghost btn-square btn-xs absolute top-1/2 right-1 -translate-y-1/2"
              :aria-label="$t('dfPreview')"
              :title="$t('dfPreview')"
              :disabled="!editing.url.trim()"
              @click="preview(editing)"
            >
              <EyeIcon class="h-4 w-4" />
            </button>
          </div>
        </label>
        <div class="flex justify-end gap-2">
          <button
            class="btn btn-sm"
            type="button"
            @click="showEditor = false"
          >
            {{ $t('cancel') }}</button
          ><button
            class="btn btn-primary btn-sm"
            type="submit"
            :disabled="saving"
          >
            <span
              v-if="saving"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('save') }}
          </button>
        </div>
      </form>
    </DialogWrapper>
    <DnsFilterPreviewDialog
      v-if="showPreview && previewList"
      v-model="showPreview"
      :list="previewList"
    />
    <DialogWrapper
      v-model="showDelete"
      :title="$t('dfConfirmDelete')"
    >
      <div class="flex flex-col gap-4 p-2">
        <div>
          <p class="text-sm">{{ deleting?.name }}</p>
          <p class="text-base-content/60 font-mono text-xs break-all">{{ deleting?.url }}</p>
        </div>
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
            {{ $t('confirm') }}
          </button>
        </div>
      </div>
    </DialogWrapper>
  </section>
</template>

<script setup lang="ts">
import {
  saveDnsFilter,
  type DnsFilterList,
  type DnsFilterSettings,
  type DnsFilterStatus,
} from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import DnsFilterPreviewDialog from '@/components/dns/DnsFilterPreviewDialog.vue'
import { showNotification } from '@/helper/notification'
import { ChevronDownIcon, EyeIcon, PencilSquareIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { ref, watch } from 'vue'
const props = defineProps<{ status: DnsFilterStatus; busy: boolean }>()
const emit = defineEmits<{ saved: []; update: [] }>()
const saving = ref(false)
const allowText = ref('')
const allowExpanded = ref(false)
const showEditor = ref(false)
const showPreview = ref(false)
const previewList = ref<DnsFilterList | null>(null)
const preview = (list: DnsFilterList) => {
  previewList.value = { ...list, url: list.url.trim() }
  showPreview.value = true
}
const showDelete = ref(false)
const deleting = ref<DnsFilterList | null>(null)
const editing = ref<DnsFilterList | null>(null)
watch(
  () => props.status.settings.allowDomains.join('\n'),
  (v) => {
    allowText.value = v
  },
  { immediate: true },
)
const save = async (settings: DnsFilterSettings) => {
  saving.value = true
  try {
    await saveDnsFilter(settings)
    showNotification({ content: 'dfSaved', key: 'dns-filter-save', type: 'alert-success' })
    emit('saved')
    return true
  } catch (e) {
    showNotification({
      content: 'routingSaveFailed',
      params: { message: e instanceof Error ? e.message : String(e) },
      key: 'dns-filter-save',
      type: 'alert-error',
    })
    return false
  } finally {
    saving.value = false
  }
}
const toggle = (event: Event) =>
  save({ ...props.status.settings, enabled: (event.target as HTMLInputElement).checked })
const changeList = (list: DnsFilterList, patch: Partial<DnsFilterList>) =>
  save({
    ...props.status.settings,
    lists: props.status.settings.lists.map((l) => (l.id === list.id ? { ...l, ...patch } : l)),
  })
const askDelete = (list: DnsFilterList) => {
  deleting.value = list
  showDelete.value = true
}
const confirmDelete = async () => {
  if (!deleting.value) return
  const id = deleting.value.id
  if (
    await save({
      ...props.status.settings,
      lists: props.status.settings.lists.filter((l) => l.id !== id),
    })
  )
    showDelete.value = false
}
const edit = (list?: DnsFilterList) => {
  editing.value = list
    ? { ...list }
    : {
        id: `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: '',
        url: '',
        enabled: true,
      }
  showEditor.value = true
}
const saveEdit = async () => {
  if (!editing.value) return
  const list = { ...editing.value, name: editing.value.name.trim(), url: editing.value.url.trim() }
  const lists = props.status.settings.lists.some((l) => l.id === list.id)
    ? props.status.settings.lists.map((l) => (l.id === list.id ? list : l))
    : [...props.status.settings.lists, list]
  if (await save({ ...props.status.settings, lists })) showEditor.value = false
}
const saveAllow = () =>
  save({
    ...props.status.settings,
    allowDomains: [
      ...new Set(
        allowText.value
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    ],
  })
</script>
