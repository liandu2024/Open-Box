<template>
  <section class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-4 p-4 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <ShieldCheckIcon class="text-primary h-6 w-6" />
          <h2 class="text-base font-semibold">{{ $t('dfTitle') }}</h2>
          <input
            type="checkbox"
            class="toggle toggle-sm toggle-primary"
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
        <div class="flex gap-2">
          <button
            class="btn btn-sm btn-ghost"
            :disabled="busy || saving"
            @click="edit()"
          >
            <PlusIcon class="h-4 w-4" />{{ $t('dfAdd') }}
          </button>
          <button
            class="btn btn-sm btn-soft"
            :disabled="busy || saving || !status.settings.lists.some((l) => l.enabled)"
            @click="$emit('update')"
          >
            <ArrowPathIcon class="h-4 w-4" />{{ $t('dfUpdate') }}
          </button>
        </div>
      </div>
      <p class="text-base-content/60 text-xs leading-relaxed">{{ $t('dfDescription') }}</p>
      <p
        v-if="notice"
        role="status"
        :class="error ? 'text-error' : 'text-success'"
      >
        {{ notice }}
      </p>
      <div class="app-plain-table overflow-x-auto">
        <table class="table-sm table">
          <thead>
            <tr>
              <th>{{ $t('dfSwitch') }}</th>
              <th>{{ $t('dfName') }}</th>
              <th>{{ $t('dfUrl') }}</th>
              <th>{{ $t('dfCount') }}</th>
              <th>{{ $t('dfUpdated') }}</th>
              <th class="text-right">{{ $t('dfActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="list in status.settings.lists"
              :key="list.id"
            >
              <td>
                <input
                  type="checkbox"
                  class="toggle toggle-xs"
                  :checked="list.enabled"
                  :aria-label="`${$t('dfSwitch')} ${list.name}`"
                  :disabled="busy || saving"
                  @change="changeList(list, { enabled: !list.enabled })"
                />
              </td>
              <td class="font-medium">{{ list.name }}</td>
              <td
                class="max-w-64 truncate text-xs"
                :title="list.url"
              >
                {{ list.url }}
              </td>
              <td class="tabular-nums">
                {{ status.lists[list.id]?.count?.toLocaleString() ?? '—' }}
                <div
                  v-if="status.lists[list.id]?.unsupported"
                  class="text-warning text-xs"
                  :title="status.lists[list.id]?.unsupportedExamples?.join('\n')"
                >
                  {{ $t('dfSkipped', { n: status.lists[list.id]?.unsupported }) }}
                </div>
              </td>
              <td class="text-xs">
                {{
                  status.lists[list.id]?.updatedAt
                    ? new Date(status.lists[list.id].updatedAt).toLocaleString()
                    : $t('dfNotDownloaded')
                }}
                <p
                  v-if="status.lists[list.id]?.error"
                  class="text-error max-w-52"
                  :title="status.lists[list.id].error"
                >
                  {{ status.lists[list.id].error }}
                </p>
              </td>
              <td class="text-right whitespace-nowrap">
                <template v-if="deleting === list.id"
                  ><button
                    class="btn btn-error btn-xs"
                    :disabled="saving"
                    @click="remove(list.id)"
                  >
                    {{ $t('dfConfirmDelete') }}</button
                  ><button
                    class="btn btn-ghost btn-xs"
                    @click="deleting = ''"
                  >
                    {{ $t('cancel') }}
                  </button></template
                >
                <template v-else
                  ><button
                    class="btn btn-ghost btn-xs"
                    :aria-label="`${$t('dfEdit')} ${list.name}`"
                    :disabled="busy || saving"
                    @click="edit(list)"
                  >
                    <PencilSquareIcon class="h-4 w-4" /></button
                  ><button
                    class="btn btn-ghost btn-xs text-error"
                    :aria-label="`${$t('dfDelete')} ${list.name}`"
                    :disabled="busy || saving"
                    @click="deleting = list.id"
                  >
                    <TrashIcon class="h-4 w-4" /></button
                ></template>
              </td>
            </tr>
            <tr v-if="!status.settings.lists.length">
              <td
                colspan="6"
                class="text-base-content/50 py-8 text-center"
              >
                {{ $t('dfEmptyLists') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <details class="border-base-300/50 border-t pt-3">
        <summary class="cursor-pointer font-medium">
          {{ $t('dfAllow') }}
          <span class="text-base-content/50">({{ status.settings.allowDomains.length }})</span>
        </summary>
        <p class="text-base-content/60 my-2 text-xs">{{ $t('dfAllowHint') }}</p>
        <textarea
          v-model="allowText"
          class="textarea w-full font-mono text-xs"
          rows="3"
          :aria-label="$t('dfAllow')"
          placeholder="example.com&#10;*.example.com"
        />
        <button
          class="btn btn-sm mt-2"
          :disabled="busy || saving"
          @click="saveAllow"
        >
          {{ $t('dfSaveAllow') }}
        </button>
      </details>
    </div>
    <div
      v-if="editing"
      class="modal modal-open"
      role="dialog"
      aria-modal="true"
      :aria-label="$t('dfEditList')"
      @keydown.esc="editing = null"
    >
      <form
        class="modal-box"
        @submit.prevent="saveEdit"
      >
        <h3 class="mb-4 text-lg font-semibold">{{ $t('dfEditList') }}</h3>
        <label class="fieldset"
          ><span class="fieldset-legend">{{ $t('dfName') }}</span
          ><input
            v-model="editing.name"
            class="input w-full"
            maxlength="80"
            required
        /></label>
        <label class="fieldset"
          ><span class="fieldset-legend">{{ $t('dfUrl') }}</span
          ><input
            v-model="editing.url"
            class="input w-full"
            type="url"
            maxlength="2048"
            placeholder="https://example.com/filter.txt"
            required
        /></label>
        <p
          v-if="error && notice"
          class="text-error mt-3 text-sm"
        >
          {{ notice }}
        </p>
        <div class="modal-action">
          <button
            class="btn btn-ghost"
            type="button"
            @click="editing = null"
          >
            {{ $t('cancel') }}</button
          ><button
            class="btn btn-primary"
            type="submit"
            :disabled="saving"
          >
            {{ $t('save') }}
          </button>
        </div>
      </form>
      <button
        class="modal-backdrop"
        :aria-label="$t('cancel')"
        @click="editing = null"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  saveDnsFilter,
  type DnsFilterList,
  type DnsFilterSettings,
  type DnsFilterStatus,
} from '@/api/openbox'
import {
  ArrowPathIcon,
  PencilSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
} from '@heroicons/vue/24/outline'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
const props = defineProps<{ status: DnsFilterStatus; busy: boolean }>()
const emit = defineEmits<{ saved: []; update: [] }>()
const { t } = useI18n()
const saving = ref(false),
  error = ref(false),
  notice = ref(''),
  deleting = ref(''),
  allowText = ref('')
const editing = ref<DnsFilterList | null>(null)
watch(() => props.status.pending, (pending) => { if (!pending && !error.value) notice.value = '' })
watch(
  () => props.status.settings.allowDomains.join('\n'),
  (v) => {
    allowText.value = v
  },
  { immediate: true },
)
const save = async (settings: DnsFilterSettings) => {
  saving.value = true
  error.value = false
  try {
    await saveDnsFilter(settings)
    notice.value = t('dfSaved')
    emit('saved')
    return true
  } catch (e) {
    notice.value = e instanceof Error ? e.message : String(e)
    error.value = true
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
const remove = async (id: string) => {
  await save({
    ...props.status.settings,
    lists: props.status.settings.lists.filter((l) => l.id !== id),
  })
  deleting.value = ''
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
  notice.value = ''
}
const saveEdit = async () => {
  if (!editing.value) return
  const list = { ...editing.value, name: editing.value.name.trim(), url: editing.value.url.trim() }
  const lists = props.status.settings.lists.some((l) => l.id === list.id)
    ? props.status.settings.lists.map((l) => (l.id === list.id ? list : l))
    : [...props.status.settings.lists, list]
  if (await save({ ...props.status.settings, lists })) editing.value = null
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
