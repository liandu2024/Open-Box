<template>
  <DialogWrapper
    v-model="open"
    :title="$t('dfPreviewTitle')"
    box-class="w-full max-w-2xl"
  >
    <div class="flex flex-col gap-3">
      <div class="min-w-0">
        <p class="text-sm font-medium">{{ list.name }}</p>
        <p
          class="text-base-content/60 truncate font-mono text-xs"
          :title="list.url"
        >
          {{ list.url }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <select
          v-model="action"
          class="select select-sm w-32 shrink-0"
          :aria-label="$t('dfResult')"
        >
          <option value="all">{{ $t('all') }}</option>
          <option value="allow">{{ $t('dfPreviewFilterAllow') }}</option>
          <option value="block">{{ $t('dfPreviewFilterBlock') }}</option>
        </select>
        <TextInput
          v-model="keyword"
          class="min-w-0 flex-1"
          :placeholder="$t('dfSearch')"
          clearable
        />
      </div>
      <p
        v-if="data"
        class="text-base-content/60 flex flex-wrap gap-x-3 gap-y-1 text-xs"
      >
        <span>{{ $t(data.source === 'downloaded' ? 'dfPreviewDownloaded' : 'dfPreviewUrl') }}</span>
        <span>{{
          keyword.trim() || action !== 'all'
            ? $t('geoEntriesCountFiltered', { matched: data.total, total: data.count })
            : $t('geoEntriesCount', { total: data.count })
        }}</span>
        <span
          v-if="data.unsupported"
          class="text-warning"
          :title="data.unsupportedExamples.join('\n')"
          >{{ $t('dfSkipped', { n: data.unsupported }) }}</span
        >
      </p>
      <div
        ref="entriesContainer"
        class="border-base-300/60 h-80 overflow-y-auto rounded-lg border"
        :aria-busy="loading"
      >
        <div
          v-if="loading"
          class="flex h-full items-center justify-center"
        >
          <span class="loading loading-spinner loading-sm" />
        </div>
        <p
          v-else-if="!data?.rows.length"
          class="text-base-content/50 py-10 text-center text-xs"
        >
          {{ $t('geoEntriesEmpty') }}
        </p>
        <ul v-else>
          <li
            v-for="(entry, index) in data.rows"
            :key="index"
            class="border-base-300/40 flex items-start gap-2 border-b px-3 py-1.5 last:border-b-0"
          >
            <span class="badge badge-ghost badge-xs shrink-0">{{
              $t(ruleTypeLabelKey(entry.type))
            }}</span>
            <div class="min-w-0 flex-1 font-mono text-xs">
              <p
                class="break-all"
                :title="entry.rule"
              >
                {{ entry.value }}
              </p>
              <p
                v-if="entry.conditional"
                class="text-base-content/60 mt-0.5 break-all"
              >
                {{ entry.rule }}
              </p>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1">
              <span
                class="badge badge-ghost badge-xs"
                :class="entry.action === 'allow' && 'text-success'"
                >{{ $t(entry.action === 'allow' ? 'dfPreviewAllow' : 'dfPreviewBlock') }}</span
              >
              <span
                v-if="entry.important"
                class="text-base-content/60 text-xs"
                >important</span
              >
            </div>
          </li>
        </ul>
      </div>
      <AppPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="data?.total || 0"
        :disabled="loading"
        @change="load"
      />
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import {
  fetchDnsFilterPreview,
  type DnsFilterList,
  type DnsFilterPreview,
  type DnsFilterPreviewAction,
} from '@/api/openbox'
import AppPagination from '@/components/common/AppPagination.vue'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import TextInput from '@/components/common/TextInput.vue'
import { showNotification } from '@/helper/notification'
import { ruleTypeLabelKey } from '@/helper/ruleType'
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ list: Pick<DnsFilterList, 'name' | 'url'> }>()
const open = defineModel<boolean>({ required: true })
const data = ref<DnsFilterPreview | null>(null)
const loading = ref(false)
const keyword = ref('')
const action = ref<DnsFilterPreviewAction>('all')
const page = ref(1)
const pageSize = ref(20)
const entriesContainer = ref<HTMLElement>()
let seq = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

const load = async () => {
  const mine = ++seq
  loading.value = true
  entriesContainer.value?.scrollTo({ top: 0 })
  try {
    const result = await fetchDnsFilterPreview(
      props.list.url,
      keyword.value.trim(),
      page.value,
      pageSize.value,
      action.value,
    )
    if (mine !== seq) return
    data.value = result
    page.value = result.page
    pageSize.value = result.pageSize
  } catch (error) {
    if (mine !== seq) return
    data.value = null
    showNotification({
      content: 'geoEntriesLoadFailed',
      params: { message: error instanceof Error ? error.message : String(error) },
      type: 'alert-error',
    })
  } finally {
    if (mine === seq) loading.value = false
  }
}
watch([keyword, action], () => {
  ++seq
  clearTimeout(searchTimer)
  loading.value = true
  page.value = 1
  searchTimer = setTimeout(() => void load(), 250)
})
watch(
  open,
  (value) => {
    if (value) void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++seq
  clearTimeout(searchTimer)
})
</script>
