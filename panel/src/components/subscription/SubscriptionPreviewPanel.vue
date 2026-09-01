<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <!-- Nothing to preview yet -->
    <div
      v-if="!hasSource"
      class="border-base-content/15 text-base-content/50 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm"
    >
      <MagnifyingGlassIcon class="h-6 w-6" />
      {{ $t('subscriptionPreviewEmptyHint') }}
    </div>

    <template v-else>
      <div class="flex items-center gap-2">
        <span
          v-if="loading"
          class="loading loading-spinner loading-xs"
        />
        <span class="text-sm font-medium">
          {{ statusText }}
        </span>
        <span
          v-if="preview"
          class="badge badge-outline badge-sm uppercase"
        >
          {{ preview.format }}
        </span>
      </div>

      <p
        v-if="error"
        class="border-error/30 bg-error/10 text-error rounded-lg border px-3 py-2 text-sm"
      >
        {{ error }}
      </p>

      <template v-if="preview && !error">
        <!-- Region/type groups summary -->
        <div
          v-if="preview.groups.length"
          class="flex flex-wrap gap-1.5"
        >
          <span
            v-for="group in preview.groups"
            :key="group.name"
            class="badge badge-soft badge-info badge-sm"
          >
            {{ group.name }} × {{ group.nodeTags.length }}
          </span>
        </div>

        <!-- Skipped entries -->
        <div
          v-if="preview.skipped.length"
          class="border-warning/30 bg-warning/10 flex flex-col gap-1 rounded-lg border px-3 py-2"
        >
          <p class="text-warning text-xs font-medium">
            {{ $t('subscriptionSkippedSummary', { count: preview.skipped.length }) }}
          </p>
          <ul class="text-base-content/70 flex max-h-24 flex-col gap-0.5 overflow-y-auto text-xs">
            <li
              v-for="(item, index) in preview.skipped"
              :key="`${item.name}-${index}`"
              class="truncate"
            >
              {{ $t('subscriptionSkippedReason', { name: item.name, type: item.type }) }}
            </li>
          </ul>
        </div>

        <!-- 有效 / 过滤 合并成同一张表的两个页签:它们是同一份订阅的两种去向,
             分成两个方框看要来回找,而且过滤那块原本挤在表格上面把表压得更矮。 -->
        <div
          role="tablist"
          class="tabs-box tabs tabs-sm self-start"
        >
          <a
            role="tab"
            :class="['tab', listTab === 'kept' && 'tab-active']"
            @click="listTab = 'kept'"
          >
            {{ $t('subscriptionPreviewTabKept', { count: preview.preview.length }) }}
          </a>
          <a
            role="tab"
            :class="['tab', listTab === 'excluded' && 'tab-active']"
            @click="listTab = 'excluded'"
          >
            {{ $t('subscriptionPreviewTabExcluded', { count: preview.excluded?.length || 0 }) }}
          </a>
        </div>

        <!-- The hero: original -> renamed mapping table -->
        <div class="border-base-content/10 min-h-0 flex-1 overflow-hidden rounded-lg border">
          <div
            v-if="rows.length === 0"
            class="text-base-content/50 p-4 text-center text-sm"
          >
            {{ $t('subscriptionPreviewNoNodes') }}
          </div>
          <div
            v-else
            class="max-h-80 overflow-y-auto"
          >
            <!-- table-sm 而不是 table-xs:节点名是这张表的主要内容,xs 太小看不清 -->
            <table class="table table-sm table-pin-rows">
              <thead>
                <tr>
                  <th class="w-1/2">{{ $t('subscriptionRenameOriginalColumn') }}</th>
                  <th class="w-1/2">{{ $t('subscriptionRenameNewColumn') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(entry, index) in rows"
                  :key="`${entry.originalTag}-${index}`"
                >
                  <td class="text-base-content/60 max-w-0 truncate">{{ entry.originalTag }}</td>
                  <td class="max-w-0">
                    <!-- 过滤页签下这条根本不会导入,没有"新名"可言,也不该能改 -->
                    <span
                      v-if="listTab === 'excluded'"
                      class="text-base-content/40"
                    >
                      {{ $t('subscriptionPreviewNotImported') }}
                    </span>
                    <span
                      v-else
                      class="flex items-center gap-1"
                    >
                      <ArrowRightIcon class="text-base-content/30 h-3 w-3 shrink-0" />
                      <!-- 值取本地覆盖优先:直接绑 entry.newTag 的话,每次预览返回都会
                           把正在输入的内容顶掉,光标也会跳。 -->
                      <input
                        type="text"
                        class="input input-sm w-full font-medium"
                        :value="overrides?.[entry.originalTag] ?? entry.newTag"
                        @input="onRename(entry, ($event.target as HTMLInputElement).value)"
                      />
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxSubscriptionPreview } from '@/api/openbox'
import { ArrowRightIcon, MagnifyingGlassIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  hasSource: boolean
  loading: boolean
  error: string
  preview: OpenboxSubscriptionPreview | null
  overrides?: Record<string, string>
}>()

const emit = defineEmits<{
  override: [{ originalTag: string; newTag: string }]
}>()

const { t } = useI18n()

const listTab = ref<'kept' | 'excluded'>('kept')

// 两个页签共用同一张表:过滤那边没有"新名",originalTag 复用同一列即可。
const rows = computed(() => {
  if (listTab.value === 'excluded') {
    return (props.preview?.excluded || []).map((item) => ({ originalTag: item.name, newTag: '' }))
  }
  return props.preview?.preview || []
})

// 改回模板算出来的名字就等于取消覆盖(交由父组件按空值删除),这样用户不必知道
// "怎么撤销"——把名字改回去就行。
const onRename = (entry: { originalTag: string; newTag: string }, value: string) => {
  emit('override', { originalTag: entry.originalTag, newTag: value === entry.newTag ? '' : value })
}

const statusText = computed(() => {
  if (props.loading && !props.preview) return t('subscriptionPreviewLoading')
  if (!props.preview) return ''
  return t('subscriptionPreviewSummary', { count: props.preview.nodes.length })
})
</script>
