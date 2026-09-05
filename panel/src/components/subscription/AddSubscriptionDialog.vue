<template>
  <DialogWrapper
    v-model="isOpen"
    :title="$t(subscription ? 'subscriptionEditTitle' : 'subscriptionAddTitle')"
    box-class="w-full max-w-2xl"
  >
    <!-- 三个页签共存于 DOM,用 v-show 而不是 v-if 切换。这一点是必须的:
         RenameRulesEditor 把地区/特征词典存在自己内部的 reactive 数组里,并且挂载时
         会 emit 一次初始值。用 v-if 的话每次切走再切回都会重建组件,用户刚编辑的规则
         直接丢失、还会把 renameOptions 悄悄改回初始值——和之前编辑弹窗踩过的是同一类坑。 -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <!-- 左:来源模式。订阅=填链接由服务端去抓;节点=直接粘贴一堆节点链接。
           它取代了原来那个「没有链接?粘贴内容试试」的文字开关——那个写法既不显眼,
           也没表达出"这是两条并列的录入方式"。
           修改已有订阅时锁死:一条订阅到底是"有地址、可回源刷新"还是"粘贴保存的",
           是它的固有属性。允许中途切换只会得到一个两边都不完整的记录——切到节点模式
           时链接被清空、再也刷不了,切到订阅模式时已存的节点内容被丢掉。要换来源就
           新建一条。 -->
      <div
        role="tablist"
        class="tabs-box tabs tabs-sm"
        :class="isEditing && 'pointer-events-none opacity-60'"
        :aria-disabled="isEditing || undefined"
        :title="isEditing ? $t('subscriptionSourceLocked') : undefined"
      >
        <a
          v-for="item in sourceModes"
          :key="item.key"
          role="tab"
          :class="['tab', sourceMode === item.key && 'tab-active']"
          @click="!isEditing && (sourceMode = item.key)"
        >
          {{ $t(item.label) }}
        </a>
      </div>

      <!-- 右:内容分区 -->
      <div
        role="tablist"
        class="tabs-box tabs tabs-sm"
      >
        <a
          v-for="item in tabs"
          :key="item.key"
          role="tab"
          :class="['tab', activeTab === item.key && 'tab-active']"
          @click="activeTab = item.key"
        >
          {{ $t(item.label) }}<template v-if="item.key === 'nodes' && preview">
            ({{ preview.nodes.length }})</template>
        </a>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <div
        v-show="activeTab === 'source'"
        class="flex flex-col gap-4"
      >
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('subscriptionNameLabel') }}</label>
          <input
            v-model="name"
            type="text"
            class="input input-sm w-full"
            :placeholder="$t('subscriptionNamePlaceholder')"
          />
        </div>

        <div
          v-if="sourceMode === 'url'"
          class="flex flex-col gap-2"
        >
          <div class="flex items-center justify-between gap-2">
            <label class="text-xs font-medium">{{ $t('subscriptionUrlLabel') }}</label>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              @click="urls.push('')"
            >
              <PlusIcon class="h-3.5 w-3.5" />
              {{ $t('subscriptionUrlAdd') }}
            </button>
          </div>
          <!-- 一行一个地址:镜像、备用、几个机场合成一条都行,节点合在一起。行内的删除按钮
               和目标分流的规则行是同一套写法。只剩一行时不能删——至少要留一个输入框。 -->
          <div
            v-for="index in urls.keys()"
            :key="index"
            class="flex items-center gap-2"
          >
            <input
              v-model="urls[index]"
              type="text"
              class="input input-sm min-w-0 flex-1"
              placeholder="https://"
              autocomplete="off"
            />
            <button
              type="button"
              class="btn btn-ghost btn-square btn-sm"
              :class="urls.length === 1 ? 'text-base-content/30 cursor-not-allowed' : 'hover:text-error'"
              :disabled="urls.length === 1"
              v-tip="$t('delete')"
              :aria-label="$t('delete')"
              @click="urls.splice(index, 1)"
            >
              <TrashIcon class="h-4 w-4" />
            </button>
          </div>
          <p class="text-base-content/50 text-xs">{{ $t('subscriptionUrlHint') }}</p>

          <!-- 定期更新:每隔几天、几点自动重新拉取。控件和后端设置里 Geo / 自身升级的计划一样 -->
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
            <span class="text-xs font-medium">{{ $t('subscriptionAutoUpdate') }}</span>
            <input
              v-model="autoUpdate.enabled"
              type="checkbox"
              class="toggle toggle-sm"
            />
            <template v-if="autoUpdate.enabled">
              <span class="text-base-content/70 text-sm">{{ $t('geoUpdateEvery') }}</span>
              <select
                v-model.number="autoUpdate.days"
                class="select select-sm w-24"
              >
                <option
                  v-for="d in [1, 2, 3, 7, 14, 30]"
                  :key="d"
                  :value="d"
                >{{ $t('geoUpdateDays', { days: d }) }}</option>
              </select>
              <select
                v-model.number="autoUpdate.hour"
                class="select select-sm w-24"
              >
                <option
                  v-for="h in 24"
                  :key="h - 1"
                  :value="h - 1"
                >{{ String(h - 1).padStart(2, '0') }}:00</option>
              </select>
            </template>
          </div>
          <p
            v-if="autoUpdate.enabled"
            class="text-base-content/50 text-xs"
          >{{ $t('subscriptionAutoUpdateHint') }}</p>
        </div>

        <div
          v-else
          class="flex flex-col gap-1"
        >
          <label class="text-xs font-medium">{{ $t('subscriptionContentLabel') }}</label>
          <textarea
            v-model="content"
            rows="8"
            class="textarea textarea-sm w-full font-mono"
            :placeholder="$t('subscriptionContentPlaceholder')"
          />
          <p class="text-base-content/50 text-xs">{{ $t('subscriptionContentHint') }}</p>
        </div>

      </div>

      <!-- key 绑到订阅 id:切换编辑对象时强制重建编辑器,否则它内部的 reactive 行
           不会随 initial 变化重新初始化,会把上一个订阅的规则带过来 -->
      <div v-show="activeTab === 'rules'">
        <RenameRulesEditor
          :key="subscription?.id || 'new'"
          :initial="subscription?.renameOptions"
          @change="handleRenameOptionsChange"
        />
      </div>

      <div
        v-show="activeTab === 'nodes'"
        class="flex min-h-0 flex-col gap-3"
      >
        <SubscriptionPreviewPanel
          :has-source="hasSource"
          :loading="previewing"
          :error="previewErrorMessage"
          :preview="preview"
          :overrides="overrides"
          :source="effectiveSource"
          :rename-options="effectiveRenameOptions"
          @override="handleOverride"
          @reset-overrides="overrides = {}"
          @toggle-disabled="handleToggleDisabled"
        />
      </div>
    </div>

    <div class="mt-5 flex flex-col gap-2">
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="btn btn-sm"
          @click="isOpen = false"
        >
          {{ $t('cancel') }}
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="!canSave || saving"
          @click="handleSave"
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
</template>

<script setup lang="ts">
import type { OpenboxRenameOptions, OpenboxSubscription, OpenboxSubscriptionAutoUpdate, OpenboxSubscriptionPreview } from '@/api/openbox'
import { createSubscription, previewSubscription, updateSubscription } from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { PlusIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { debounce } from 'lodash'
import { showNotification } from '@/helper/notification'
import { notifySubscriptionSaved } from '@/store/openboxSubscriptions'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import RenameRulesEditor from './RenameRulesEditor.vue'
import SubscriptionPreviewPanel from './SubscriptionPreviewPanel.vue'

// 传 subscription 即进入编辑模式:同一个弹窗复用,连带重命名规则编辑与实时预览
// 一起复用——编辑订阅要看的东西和新建时完全一样,没有理由再造一个只能改名字的框。
const props = defineProps<{ subscription?: OpenboxSubscription | null }>()

const isOpen = defineModel<boolean>({ required: true })

const emit = defineEmits<{
  saved: []
}>()

const { t } = useI18n()

type SourceMode = 'url' | 'paste'
type DialogTab = 'source' | 'rules' | 'nodes'

const sourceModes: { key: SourceMode; label: string }[] = [
  { key: 'url', label: 'subscriptionTabSource' },
  { key: 'paste', label: 'subscriptionTabNodes' },
]
// 编辑已有订阅时,按它到底是"有链接"还是"粘贴来的"决定初始模式
const hasUrlSource = (s?: OpenboxSubscription | null) => Boolean(s?.url || s?.urls?.length)
const sourceMode = ref<SourceMode>(props.subscription && !hasUrlSource(props.subscription) ? 'paste' : 'url')
const isEditing = computed(() => Boolean(props.subscription))

const tabs: { key: DialogTab; label: string }[] = [
  { key: 'source', label: 'subscriptionTabSource' },
  { key: 'rules', label: 'subscriptionTabRules' },
  { key: 'nodes', label: 'subscriptionTabNodes' },
]
const activeTab = ref<DialogTab>('source')

// 初始值直接从 props 取,不能只靠 resetForm():编辑弹窗是 v-if 挂载的,挂载时
// isOpen 已经是 true,而 watch(isOpen) 不是 immediate —— 它一次都不会触发,字段
// 会停在空字符串上(实测:打开「修改订阅」名称和链接都是空的)。
const name = ref(props.subscription?.name ?? '')
// 地址可以有多个;老记录只有 url。新建时给一个空输入框
const initialUrls = () => {
  const s = props.subscription
  const list = s?.urls?.length ? s.urls : s?.url ? [s.url] : []
  return list.length ? [...list] : ['']
}
const urls = ref<string[]>(initialUrls())
const content = ref(props.subscription?.content ?? '')
// 定期更新计划;默认关着,打开时默认每天 04:00
const initialAutoUpdate = (): OpenboxSubscriptionAutoUpdate => ({
  enabled: props.subscription?.autoUpdate?.enabled === true,
  days: props.subscription?.autoUpdate?.days || 1,
  hour: props.subscription?.autoUpdate?.hour ?? 4,
})
const autoUpdate = ref<OpenboxSubscriptionAutoUpdate>(initialAutoUpdate())

const renameOptions = ref<OpenboxRenameOptions>({})
const handleRenameOptionsChange = (value: OpenboxRenameOptions) => {
  renameOptions.value = value
}

// 逐条手工改名。单独存在弹窗这一层而不是塞进 RenameRulesEditor:它不是"规则",而是
// 对个别节点的例外,编辑入口也在预览表里。发出去时才与规则合并成一份 renameOptions。
const overrides = ref<Record<string, string>>({ ...(props.subscription?.renameOptions?.overrides || {}) })
const handleOverride = ({ originalTag, newTag }: { originalTag: string; newTag: string }) => {
  const next = { ...overrides.value }
  if (newTag.trim()) next[originalTag] = newTag
  else delete next[originalTag]
  overrides.value = next
}
// 逐条禁用。和改名覆盖一样是"对个别节点的例外",不属于规则,所以也放在弹窗这一层。
const disabledTags = ref<string[]>([...(props.subscription?.renameOptions?.disabled || [])])
const handleToggleDisabled = ({ originalTag, disabled }: { originalTag: string; disabled: boolean }) => {
  const set = new Set(disabledTags.value)
  if (disabled) set.add(originalTag)
  else set.delete(originalTag)
  disabledTags.value = [...set]
}

const effectiveRenameOptions = computed<OpenboxRenameOptions>(() => ({
  ...renameOptions.value,
  overrides: overrides.value,
  disabled: disabledTags.value,
}))

const preview = ref<OpenboxSubscriptionPreview | null>(null)
const previewing = ref(false)
const previewErrorMessage = ref('')
const saving = ref(false)

// content (when the paste-mode textarea is non-empty) wins over url — mirrors
// server/api/subscriptions.mjs's resolveNodes priority, so what's shown in the preview panel is
// always exactly what a save/preview call with these fields would produce.
// 只认当前模式那一路。以前是"有 content 就优先用 content",在模式切换后会出问题:
// 切回「订阅」模式时上一次粘贴的内容还留在 content 里,预览和保存都会继续用它,
// 而界面上根本看不到那段文字。
// 保存时用的名字:留空就回落到默认名。预览要用同一个值,否则「订阅名做前缀」时
// 预览里的前缀和保存后的不一样。
const effectiveName = computed(() => name.value.trim() || t('subscriptionDefaultName'))

const effectiveSource = computed<{ urls?: string[]; content?: string; name?: string } | null>(() => {
  // 只有开了前缀,名字才影响解析结果;否则不带上,免得改个名字就重新拉一次订阅。
  const withName = renameOptions.value.usePrefix ? { name: effectiveName.value } : {}
  if (sourceMode.value === 'paste') {
    const trimmedContent = content.value.trim()
    return trimmedContent ? { content: trimmedContent, ...withName } : null
  }
  // 空行和重复的地址不算;顺序保留,服务端拿第一条当老字段 url
  const list = [...new Set(urls.value.map((u) => u.trim()).filter(Boolean))]
  return list.length ? { urls: list, ...withName } : null
})
const hasSource = computed(() => effectiveSource.value !== null)

const canSave = computed(() => hasSource.value && !previewing.value)

// Monotonic guard against out-of-order responses: a slow preview call for stale input must
// never clobber a newer one that resolved first.
let previewSeq = 0

const runPreviewNow = async () => {
  const src = effectiveSource.value
  if (!src) return

  const seq = ++previewSeq
  previewing.value = true
  previewErrorMessage.value = ''

  try {
    const result = await previewSubscription({ ...src, renameOptions: effectiveRenameOptions.value })
    if (seq !== previewSeq) return
    preview.value = result
  } catch (error) {
    if (seq !== previewSeq) return
    preview.value = null
    previewErrorMessage.value = t('subscriptionPreviewFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    if (seq === previewSeq) previewing.value = false
  }
}

const debouncedPreview = debounce(runPreviewNow, 450)

// overrides 也要在里面:手工改名会挪动序号(改过名的节点不占序号),开了订阅名前缀
// 之后最终名字还会在手工名上再加一层——两件事都只有服务端算得准,少了这个依赖,
// 清空手工改名后表里还留着旧名字。450ms 的防抖已经挡住了逐字输入的抖动。
watch(
  [effectiveSource, renameOptions, disabledTags, overrides],
  () => {
    if (!hasSource.value) {
      debouncedPreview.cancel()
      previewSeq += 1 // invalidate any in-flight response
      preview.value = null
      previewErrorMessage.value = ''
      previewing.value = false
      return
    }
    debouncedPreview()
  },
  { deep: true },
)

const resetForm = () => {
  debouncedPreview.cancel()
  previewSeq += 1
  activeTab.value = 'source'
  // 编辑模式下用现存值预填;新建时清空
  name.value = props.subscription?.name ?? ''
  urls.value = initialUrls()
  autoUpdate.value = initialAutoUpdate()
  content.value = props.subscription?.content ?? ''
  overrides.value = { ...(props.subscription?.renameOptions?.overrides || {}) }
  disabledTags.value = [...(props.subscription?.renameOptions?.disabled || [])]
  sourceMode.value = props.subscription && !hasUrlSource(props.subscription) ? 'paste' : 'url'
  preview.value = null
  previewing.value = false
  previewErrorMessage.value = ''
  saving.value = false
}

watch(isOpen, (open) => {
  if (open) resetForm()
})

onBeforeUnmount(() => {
  debouncedPreview.cancel()
})

const handleSave = async () => {
  if (saving.value || !canSave.value) return

  saving.value = true

  try {
    // 保存哪一路由当前模式决定,和预览用的是同一个来源
    const payload = {
      ...(effectiveSource.value || {}),
      name: effectiveName.value,
      renameOptions: effectiveRenameOptions.value,
      // 粘贴来的订阅没有地址可回源,计划一律关
      autoUpdate: sourceMode.value === 'url' ? autoUpdate.value : { enabled: false, days: 1, hour: 4 },
    }
    const res = props.subscription
      ? await updateSubscription(props.subscription.id, payload)
      : await createSubscription(payload)
    emit('saved')
    isOpen.value = false
    notifySubscriptionSaved(res.changed)
  } catch (error) {
    showNotification({
      content: 'subscriptionSaveFailed',
      type: 'alert-error',
      params: { message: error instanceof Error ? error.message : String(error) },
    })
  } finally {
    saving.value = false
  }
}
</script>
