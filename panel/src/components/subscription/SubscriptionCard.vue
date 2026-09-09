<template>
  <!-- 代理页「订阅」页签的卡片,样子对齐 zashboard 的 provider 卡片:点卡片展开这条订阅的
       节点列表,折叠时是一排圆点;右上角测延迟 / 刷新订阅 / 去编辑。编辑和删除有后果,
       留在订阅设置页做,这里只把人带过去。 -->
  <CollapseCard
    :name="subscription.name"
    :content-scrollable="false"
  >
    <template v-slot:title>
      <div class="flex items-start justify-between gap-2">
        <!-- 订阅管理页可拖拽排序:把手放在标题最左;点它不要把卡片展开 -->
        <Bars3Icon
          v-if="sortable"
          class="drag-handle text-base-content/40 mt-1 h-4 w-4 shrink-0 cursor-move"
          @click.stop
        />
        <div class="min-w-0 flex-1">
          <!-- 字号和「节点」页签里节点组卡片的标题一致:名字 text-base,附注 text-xs -->
          <div class="flex min-w-0 items-center gap-1">
            <span
              class="shrink-0 text-base"
              :class="subscription.enabled === false && 'text-base-content/50'"
            >{{ subscription.name }}</span>
            <span class="text-base-content/60 truncate text-xs">({{ countText }})</span>
            <span
              v-if="subscription.enabled === false"
              class="badge badge-outline badge-sm shrink-0"
            >{{ $t('subscriptionDisabledBadge') }}</span>
          </div>
          <div class="text-base-content/60 mt-1 text-left text-sm">
            {{ $t('updated') }} {{ updatedAtText }}
          </div>
        </div>
        <!-- 右边:一排按钮,下面一行是定期更新的计划(有的话) -->
        <div class="flex shrink-0 flex-col items-end gap-1">
        <div class="flex items-center gap-2">
          <!-- 启用 / 停用:停用的订阅节点不进内核(重启内核生效),订阅记录和节点池都留着 -->
          <input
            v-if="toggleable"
            type="checkbox"
            class="toggle toggle-sm z-30"
            v-tip="$t('subscriptionEnabledToggle')"
            :checked="subscription.enabled !== false"
            @click.stop
            @change="$emit('toggle', ($event.target as HTMLInputElement).checked)"
          />
          <button
            type="button"
            class="btn btn-circle btn-sm z-30"
            v-tip="$t('proxiesSubscriptionLatencyTest')"
            :aria-label="$t('proxiesSubscriptionLatencyTest')"
            :disabled="!allProxies.length"
            @click.stop="handleLatencyTest"
          >
            <span
              v-if="isLatencyTesting"
              class="loading loading-spinner loading-xs"
            ></span>
            <BoltIcon
              v-else
              class="h-4 w-4"
            />
          </button>
          <button
            type="button"
            class="btn btn-circle btn-sm z-30"
            v-tip="$t('refresh')"
            :aria-label="$t('refresh')"
            :disabled="refreshing"
            @click.stop="$emit('refresh')"
          >
            <ArrowPathIcon :class="['h-4 w-4', refreshing && 'animate-spin']" />
          </button>
          <button
            type="button"
            class="btn btn-circle btn-sm z-30"
            v-tip="$t('subscriptionEditTitle')"
            :aria-label="$t('subscriptionEditTitle')"
            @click.stop="$emit('edit')"
          >
            <PencilSquareIcon class="h-4 w-4" />
          </button>
          <!-- 删除只在订阅管理页给;代理页的卡片是只读入口 -->
          <button
            v-if="deletable"
            type="button"
            class="btn btn-circle btn-sm z-30 hover:text-error"
            v-tip="$t('delete')"
            :aria-label="$t('delete')"
            @click.stop="$emit('delete')"
          >
            <TrashIcon class="h-4 w-4" />
          </button>
        </div>
        <div
          v-if="scheduleText"
          class="text-base-content/60 text-xs"
        >
          {{ scheduleText }}
        </div>
        </div>
      </div>
    </template>
    <template v-slot:preview>
      <ProxyPreview
        v-if="renderProxies.length"
        :nodes="renderProxies"
        :relaxed-dots-spacing="true"
      />
      <div
        v-else-if="kernelLoaded"
        class="text-base-content/50 mt-2 text-sm"
      >
        {{ $t(allProxies.length ? 'proxiesSubscriptionNoMatch' : 'proxiesSubscriptionNoNodes') }}
      </div>
    </template>
    <template v-slot:content>
      <ProxyNodeGrid v-if="renderProxies.length">
        <ProxyNodeCard
          v-for="node in renderProxies"
          :key="node"
          :name="node"
          :group-name="subscription.name"
        />
      </ProxyNodeGrid>
      <div
        v-else-if="kernelLoaded"
        class="text-base-content/50 text-sm"
      >
        {{ $t(allProxies.length ? 'proxiesSubscriptionNoMatch' : 'proxiesSubscriptionNoNodes') }}
      </div>
    </template>
  </CollapseCard>
</template>

<script setup lang="ts">
import type { OpenboxSubscription } from '@/api/openbox'
import CollapseCard from '@/components/common/CollapseCard.vue'
import ProxyNodeCard from '@/components/proxies/ProxyNodeCard.vue'
import ProxyNodeGrid from '@/components/proxies/ProxyNodeGrid.vue'
import ProxyPreview from '@/components/proxies/ProxyPreview.vue'
import { useRenderProxies } from '@/composables/renderProxies'
import { nodeProviders } from '@/store/openboxSiteSets'
import { proxyMap, proxyNodesLatencyTest } from '@/store/proxies'
import { ArrowPathIcon, Bars3Icon, BoltIcon, PencilSquareIcon, TrashIcon } from '@heroicons/vue/24/outline'
import dayjs from 'dayjs'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  subscription: OpenboxSubscription
  refreshing?: boolean
  deletable?: boolean
  // 显示拖拽把手(订阅管理页的列表用)
  sortable?: boolean
  // 显示启用 / 停用开关(订阅管理页)
  toggleable?: boolean
}>()

defineEmits<{
  refresh: []
  edit: []
  delete: []
  toggle: [enabled: boolean]
}>()

// 这条订阅的节点 = 内核里正在跑的、归属于它的出站。内核没跑就是空的,卡片上只剩订阅
// 自己记的节点数。
const allProxies = computed(() =>
  [...nodeProviders.value.entries()]
    .filter(([tag, provider]) => provider === props.subscription.name && proxyMap.value[tag])
    .map(([tag]) => tag),
)
const { renderProxies, proxiesCount } = useRenderProxies(allProxies)
// 内核数据还没拉到(proxyMap 为空)时只显示订阅自己记的节点数,不说"内核里没有节点"
const kernelLoaded = computed(() => Object.keys(proxyMap.value).length > 0)
const countText = computed(() =>
  allProxies.value.length
    ? proxiesCount.value
    : kernelLoaded.value
      ? `0/${props.subscription.nodeCount}`
      : String(props.subscription.nodeCount),
)
const updatedAtText = computed(() => dayjs(props.subscription.updatedAt).fromNow())

// 定期更新的计划,写成一句:每天 04:00 自动更新 / 每 3 天 04:00 自动更新
const { t } = useI18n()
const scheduleText = computed(() => {
  const plan = props.subscription.autoUpdate
  if (!plan || !plan.enabled) return ''
  const time = `${String(plan.hour).padStart(2, '0')}:00`
  return plan.days > 1
    ? t('subscriptionAutoUpdateEvery', { days: plan.days, time })
    : t('subscriptionAutoUpdateDaily', { time })
})

const isLatencyTesting = ref(false)
const handleLatencyTest = async () => {
  if (isLatencyTesting.value || !renderProxies.value.length) return
  isLatencyTesting.value = true
  try {
    await proxyNodesLatencyTest(props.subscription.name, renderProxies.value, {
      displayName: props.subscription.name,
      keyName: `subscription:${props.subscription.id}`,
    })
  } finally {
    isLatencyTesting.value = false
  }
}
</script>
