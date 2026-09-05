<template>
  <DialogWrapper
    v-model="open"
    :title="tag || url || ''"
    box-class="w-full max-w-2xl"
  >
    <div class="flex flex-col gap-3">
      <!-- 这个分类是什么:和下拉框里的说明是同一份(helper/geoCatalog.ts) -->
      <p
        v-if="note"
        class="text-base-content/70 text-sm leading-snug"
      >
        {{ note }}
      </p>
      <TextInput
        v-model="keyword"
        :placeholder="$t('geoEntriesSearch')"
        clearable
      />

      <p class="text-base-content/60 text-xs">
        {{ keyword ? $t('geoEntriesCountFiltered', { matched, total }) : $t('geoEntriesCount', { total }) }}
      </p>

      <div class="border-base-300/60 h-80 overflow-y-auto rounded-lg border">
        <div
          v-if="loading && !entries.length"
          class="flex h-full items-center justify-center"
        >
          <span class="loading loading-spinner loading-sm" />
        </div>
        <p
          v-else-if="!entries.length"
          class="text-base-content/50 py-10 text-center text-xs"
        >
          {{ $t('geoEntriesEmpty') }}
        </p>
        <ul v-else>
          <li
            v-for="(entry, index) in entries"
            :key="`${entry.type}:${entry.value}:${index}`"
            class="border-base-300/40 flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
          >
            <span class="badge badge-ghost badge-xs shrink-0">{{ $t(ruleTypeLabelKey(entry.type)) }}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ entry.value }}</span>
          </li>
        </ul>
      </div>

      <div class="flex justify-center">
        <button
          v-if="entries.length < matched"
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="loading"
          @click="loadMore"
        >
          <span
            v-if="loading"
            class="loading loading-spinner loading-xs"
          />
          {{ $t('geoEntriesLoadMore') }}
        </button>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import { showNotification } from '@/helper/notification'
import { fetchRuleListPreview, fetchRulesetEntries } from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import TextInput from '@/components/common/TextInput.vue'
import { ruleTypeLabelKey } from '@/helper/ruleType'
import { geoTagNote } from '@/helper/geoCatalog'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// tag:geosite / geoip 的规则集名;url:「规则集链接」。两者给一个。
const props = defineProps<{ tag?: string; url?: string }>()
const open = defineModel<boolean>({ required: true })
const { locale, t } = useI18n()

// 分类说明按 tag 从目录里找,语言切换时跟着变
const note = ref('')
watch([() => props.tag, locale], async ([tag]) => {
  note.value = tag ? await geoTagNote(tag, locale.value, t) : ''
}, { immediate: true })


const PAGE = 50

const entries = ref<{ type: string; value: string }[]>([])
const total = ref(0)
const matched = ref(0)
const loading = ref(false)
const keyword = ref('')

// 每次请求都带一个序号,慢的那次回来时就知道自己已经过时了——搜索框是边打边搜的,
// 不管顺序的话,先发的请求后到就会把新结果盖回旧的。
let seq = 0

const load = async (offset: number) => {
  const mine = ++seq
  loading.value = true
  try {
    const opts = { q: keyword.value.trim(), offset, limit: PAGE }
    const res = props.url ? await fetchRuleListPreview(props.url, opts) : await fetchRulesetEntries(props.tag || '', opts)
    if (mine !== seq) return
    // 字段缺失时给默认值:响应形状不对(代理配错、被别的服务接管)时,
    // 界面该显示"没有条目",而不是渲染中途抛异常整块白掉
    const page = Array.isArray(res?.entries) ? res.entries : []
    total.value = Number(res?.total) || 0
    matched.value = Number(res?.matched) || 0
    entries.value = offset ? [...entries.value, ...page] : page
  } catch (err) {
    if (mine !== seq) return
    entries.value = []
    total.value = 0
    matched.value = 0
    showNotification({ content: 'geoEntriesLoadFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  } finally {
    if (mine === seq) loading.value = false
  }
}

const loadMore = () => load(entries.value.length)

// 打开时拉第一页;边打边搜也走同一条路(条目在服务端内存里,不值得再加防抖)。
// immediate 是必须的:调用方是 v-if 挂上来的,挂上来时 open 就已经是 true,
// 等"变化"永远等不到——那样弹窗打开就是空的。
watch([open, keyword], ([isOpen], previous) => {
  if (!isOpen) return
  if (!previous?.[0]) entries.value = []
  void load(0)
}, { immediate: true })
</script>
