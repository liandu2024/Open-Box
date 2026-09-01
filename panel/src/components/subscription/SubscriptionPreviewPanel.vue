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
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            class="tabs-box tabs tabs-sm"
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
            <a
              role="tab"
              :class="['tab', listTab === 'disabled' && 'tab-active']"
              @click="listTab = 'disabled'"
            >
              {{ $t('subscriptionPreviewTabDisabled', { count: preview.disabled?.length || 0 }) }}
            </a>
          </div>

          <button
            v-if="listTab === 'kept'"
            type="button"
            class="btn btn-sm"
            :disabled="testingAll || !preview.preview.length || !source"
            :title="$t('subscriptionLatencyHint')"
            @click="testAll"
          >
            <span
              v-if="testingAll"
              class="loading loading-spinner loading-xs"
            />
            <BoltIcon
              v-else
              class="h-4 w-4"
            />
            {{ $t('subscriptionLatencyTestAll') }}
          </button>
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
                  <td class="text-base-content/70 max-w-0 truncate text-sm">{{ entry.originalTag }}</td>
                  <td class="max-w-0">
                    <!-- 过滤页签下这条根本不会导入,没有"新名"可言,也不该能改 -->
                    <span
                      v-if="listTab === 'excluded'"
                      class="text-base-content/40 text-sm"
                    >
                      {{ $t('subscriptionPreviewNotImported') }}
                    </span>
                    <!-- 禁用页签:唯一有意义的操作就是把它放回来 -->
                    <span
                      v-else-if="listTab === 'disabled'"
                      class="flex items-center gap-1"
                    >
                      <span class="text-base-content/40 text-sm">{{ $t('subscriptionPreviewNotImported') }}</span>
                      <!-- ml-auto:让这颗图标落在和"有效"页那两颗图标同一条右边线上,
                           页签之间来回切时按钮不会跳位置。 -->
                      <button
                        type="button"
                        class="btn btn-ghost btn-square btn-sm ml-auto shrink-0 hover:text-success"
                        :aria-label="$t('subscriptionNodeEnable')"
                        :title="$t('subscriptionNodeEnable')"
                        @click="emit('toggleDisabled', { originalTag: entry.originalTag, disabled: false })"
                      >
                        <CheckCircleIcon class="h-4 w-4" />
                      </button>
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
                        class="input input-sm w-full text-sm font-medium"
                        :value="overrides?.[entry.originalTag] ?? entry.newTag"
                        @input="onRename(entry, ($event.target as HTMLInputElement).value)"
                      />
                      <!-- 独立测速:结果就地显示在按钮旁,不另开一列——一列只为几个数字
                           占掉的宽度,比把数字挤在按钮边上更浪费。
                           这一格固定宽度且常驻(没测过就写「未测速」):否则有结果的行会把
                           输入框挤窄,同一列里的文本框宽度参差不齐。 -->
                      <span
                        :class="[
                          'w-16 shrink-0 text-right text-xs whitespace-nowrap',
                          latencyClass(entry.originalTag),
                        ]"
                      >
                        {{ latencyText(entry.originalTag) }}
                      </span>
                      <button
                        type="button"
                        class="btn btn-ghost btn-square btn-sm shrink-0"
                        :disabled="testingAll || testing.has(entry.originalTag)"
                        :aria-label="$t('subscriptionLatencyTestOne')"
                        :title="$t('subscriptionLatencyHint')"
                        @click="testOne(entry.originalTag)"
                      >
                        <span
                          v-if="testing.has(entry.originalTag)"
                          class="loading loading-spinner loading-xs"
                        />
                        <BoltIcon
                          v-else
                          class="h-4 w-4"
                        />
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-square btn-sm shrink-0 hover:text-error"
                        :aria-label="$t('subscriptionNodeDisable')"
                        :title="$t('subscriptionNodeDisable')"
                        @click="emit('toggleDisabled', { originalTag: entry.originalTag, disabled: true })"
                      >
                        <NoSymbolIcon class="h-4 w-4" />
                      </button>
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
import type { OpenboxLatencyResult, OpenboxRenameOptions, OpenboxSubscriptionPreview } from '@/api/openbox'
import { testNodeLatency } from '@/api/openbox'
import {
  ArrowRightIcon,
  BoltIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  NoSymbolIcon,
} from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  hasSource: boolean
  loading: boolean
  error: string
  preview: OpenboxSubscriptionPreview | null
  overrides?: Record<string, string>
  // 测速要重新解析订阅,所以要把来源和当前规则一并带上
  source?: { url?: string; content?: string; name?: string } | null
  renameOptions?: OpenboxRenameOptions
}>()

const emit = defineEmits<{
  override: [{ originalTag: string; newTag: string }]
  toggleDisabled: [{ originalTag: string; disabled: boolean }]
}>()

const { t } = useI18n()

const listTab = ref<'kept' | 'excluded' | 'disabled'>('kept')

// 两个页签共用同一张表:过滤那边没有"新名",originalTag 复用同一列即可。
const rows = computed(() => {
  if (listTab.value === 'excluded') {
    return (props.preview?.excluded || []).map((item) => ({ originalTag: item.name, newTag: '' }))
  }
  if (listTab.value === 'disabled') {
    return (props.preview?.disabled || []).map((item) => ({ originalTag: item.name, newTag: '' }))
  }
  return props.preview?.preview || []
})

// 节点延迟。按原名(originalTag)存,和改名覆盖用同一个键——预览行、节点摘要、
// 覆盖表三者都靠它对齐。
const latency = ref<Record<string, OpenboxLatencyResult>>({})
const testing = ref(new Set<string>())
const testingAll = ref(false)

// 测速由服务端按节点完整配置真的拨号(sing-box tools fetch),所以这里只需要把
// 来源和要测的原名传过去——节点里含密码,没有理由为了测速让它们过一趟浏览器。

const latencyText = (originalTag: string) => {
  const r = latency.value[originalTag]
  if (!r) return t('subscriptionLatencyUntested')
  return r.ok ? `${r.ms}ms` : t('subscriptionLatencyFailed')
}
const latencyClass = (originalTag: string) => {
  const r = latency.value[originalTag]
  // 没测过是"暂无信息",不是坏消息,用最淡的颜色,别和失败抢注意力
  if (!r) return 'text-base-content/30'
  if (!r.ok) return 'text-error'
  const ms = r.ms ?? 0
  return ms < 200 ? 'text-success' : ms < 500 ? 'text-warning' : 'text-error'
}

const testOne = async (originalTag: string) => {
  if (!props.source || testing.value.has(originalTag)) return
  testing.value = new Set(testing.value).add(originalTag)
  try {
    const [result] = await testNodeLatency({ ...props.source, renameOptions: props.renameOptions, tags: [originalTag] })
    latency.value = { ...latency.value, [originalTag]: result }
  } catch {
    latency.value = { ...latency.value, [originalTag]: { ok: false, error: 'request failed' } }
  } finally {
    const next = new Set(testing.value)
    next.delete(originalTag)
    testing.value = next
  }
}

// 一键测速:一次请求把全部目标交给服务端,由它按固定并发跑完。逐个发请求会让路由器
// 同时扛住几十条 HTTP 连接,得不偿失。
const testAll = async () => {
  if (testingAll.value || !props.source) return
  const tags = (props.preview?.preview || []).map((row) => row.originalTag)
  if (!tags.length) return

  testingAll.value = true
  try {
    const results = await testNodeLatency({ ...props.source, renameOptions: props.renameOptions, tags })
    const next = { ...latency.value }
    tags.forEach((tag, i) => { next[tag] = results[i] })
    latency.value = next
  } catch {
    // 整批失败(比如面板本身不可达)不逐条标红:那会让人以为是节点全挂了
  } finally {
    testingAll.value = false
  }
}

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
