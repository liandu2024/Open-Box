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

        <!-- 被过滤掉的条目。必须列出来:过滤会让节点凭空消失,只给个"解析出 N 个"
             的话,用户既看不出过滤有没有生效,也无从发现自己写的关键词误伤了真节点。 -->
        <div
          v-if="preview.excluded?.length"
          class="border-base-content/15 flex flex-col gap-1 rounded-lg border px-3 py-2"
        >
          <p class="text-base-content/70 text-xs font-medium">
            {{ $t('subscriptionExcludedSummary', { count: preview.excluded.length }) }}
          </p>
          <ul class="text-base-content/60 flex max-h-24 flex-col gap-0.5 overflow-y-auto text-xs">
            <li
              v-for="(item, index) in preview.excluded"
              :key="`${item.name}-${index}`"
              class="truncate"
            >
              {{ item.name }}
            </li>
          </ul>
        </div>

        <!-- The hero: original -> renamed mapping table -->
        <div class="border-base-content/10 min-h-0 flex-1 overflow-hidden rounded-lg border">
          <div
            v-if="preview.preview.length === 0"
            class="text-base-content/50 p-4 text-center text-sm"
          >
            {{ $t('subscriptionPreviewNoNodes') }}
          </div>
          <div
            v-else
            class="max-h-80 overflow-y-auto"
          >
            <table class="table table-xs table-pin-rows">
              <thead>
                <tr>
                  <th class="w-1/2">{{ $t('subscriptionRenameOriginalColumn') }}</th>
                  <th class="w-1/2">{{ $t('subscriptionRenameNewColumn') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(entry, index) in preview.preview"
                  :key="`${entry.originalTag}-${index}`"
                >
                  <td class="text-base-content/60 max-w-0 truncate">{{ entry.originalTag }}</td>
                  <td class="max-w-0 truncate font-medium">
                    <span class="inline-flex items-center gap-1">
                      <ArrowRightIcon class="text-base-content/30 h-3 w-3 shrink-0" />
                      {{ entry.newTag }}
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
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  hasSource: boolean
  loading: boolean
  error: string
  preview: OpenboxSubscriptionPreview | null
}>()

const { t } = useI18n()

const statusText = computed(() => {
  if (props.loading && !props.preview) return t('subscriptionPreviewLoading')
  if (!props.preview) return ''
  return t('subscriptionPreviewSummary', { count: props.preview.nodes.length })
})
</script>
