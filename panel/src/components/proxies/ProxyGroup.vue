<template>
  <CollapseCard
    :name="proxyGroup.name"
    :content-scrollable="false"
    @contextmenu.prevent.stop="handlerLatencyTest"
  >
    <template v-slot:title>
      <div
        v-if="useLargeProxyGroupIcon"
        class="relative flex items-start gap-3"
      >
        <div
          v-if="proxyGroup.icon"
          class="flex h-13 w-13 shrink-0 items-start justify-center overflow-visible pt-0.5"
        >
          <ProxyIcon
            :icon="proxyGroup.icon"
            :size="titleIconSize"
            :scale="proxyGroup.iconScale"
            :margin="0"
          />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex min-w-0 items-center gap-1">
            <div class="flex min-w-0 flex-1 items-center gap-1">
              <span class="shrink-0 text-base">
                {{ name }}
              </span>
              <button
                v-if="isSiteSet"
                type="button"
                :class="[
                  'btn btn-sm bg-base-200 border-base-200 text-base-content/80 hover:text-base-content h-6 min-h-6 shrink-0 cursor-pointer px-2 text-xs font-medium shadow-none',
                  domainPenetrationHoverClass,
                ]"
                @click.stop="openPenetrationDialog(name)"
              >
                {{ $t('domainPenetration') }}
              </button>
              <span class="text-base-content/60 min-w-0 truncate text-xs">
                {{ typeText }}
              </span>
              <span
                v-tip="$t(isFailover ? 'failoverLaneCountHint' : 'groupNodeCountHint')"
                class="text-base-content/60 shrink-0 text-xs tabular-nums"
              >({{ shownStats.valid }}/{{ shownStats.total }})</span>
            </div>
            <button
              v-if="manageHiddenGroup"
              class="btn btn-circle btn-xs z-10"
              @click.stop="handlerGroupToggle"
            >
              <EyeIcon
                v-if="!hiddenGroup"
                class="h-3 w-3"
              />
              <EyeSlashIcon
                v-else
                class="h-3 w-3"
              />
            </button>
            <LatencyTag
              :class="twMerge('bg-base-200/50 hover:bg-base-200 z-10 ml-1')"
              :loading="isLatencyTesting"
              :name="proxyGroup.now"
              :group-name="proxyGroup.name"
              :timeline-name="proxyGroup.name"
              @click.stop="handlerLatencyTest"
            />
          </div>
          <div class="text-base-content/80 @container flex w-full items-center gap-2 pt-0.5 pb-1">
            <div class="min-w-0 flex-1 text-sm">
              <ProxyGroupNow
                :name="name"
              />
            </div>
            <!-- 自动择优组:检测间隔 / 容差,和左边当前选中的节点同一行、垂直居中;
                 这一行不到 22rem 宽(两列布局、窄屏)就不显示,节点名不让 -->
            <span
              v-if="testMeta"
              class="text-base-content/60 hidden shrink-0 text-xs whitespace-nowrap tabular-nums @min-[22rem]:inline"
            >{{ testMeta }}</span>
          </div>
        </div>
      </div>
      <div
        v-else
        class="relative flex items-center gap-2"
      >
        <div class="flex flex-1 items-center gap-1">
          <div class="flex shrink-0 items-center">
            <ProxyIcon
              v-if="proxyGroup.icon"
              :icon="proxyGroup.icon"
              :size="proxyGroupIconSize"
              :scale="proxyGroup.iconScale"
              :margin="proxyGroupIconMargin"
            />
            <span class="">
              {{ name }}
            </span>
          </div>
          <button
            v-if="isSiteSet"
            type="button"
            :class="[
              'btn btn-sm bg-base-200 border-base-200 text-base-content/80 hover:text-base-content h-6 min-h-6 shrink-0 cursor-pointer px-2 text-xs font-medium shadow-none',
              domainPenetrationHoverClass,
            ]"
            @click.stop="openPenetrationDialog(name)"
          >
            {{ $t('domainPenetration') }}
          </button>
          <span class="text-base-content/60 text-xs">
            {{ typeText }}
          </span>
          <span
            v-tip="$t(isFailover ? 'failoverLaneCountHint' : 'groupNodeCountHint')"
            class="text-base-content/60 shrink-0 text-xs tabular-nums"
          >({{ shownStats.valid }}/{{ shownStats.total }})</span>
          <button
            v-if="manageHiddenGroup"
            class="btn btn-circle btn-xs z-10 ml-1"
            @click.stop="handlerGroupToggle"
          >
            <EyeIcon
              v-if="!hiddenGroup"
              class="h-3 w-3"
            />
            <EyeSlashIcon
              v-else
              class="h-3 w-3"
            />
          </button>
        </div>
        <LatencyTag
          :class="twMerge('bg-base-200/50 hover:bg-base-200 z-10')"
          :loading="isLatencyTesting"
          :name="proxyGroup.now"
          :group-name="proxyGroup.name"
          :timeline-name="proxyGroup.name"
          @click.stop="handlerLatencyTest"
        />
      </div>
      <div
        v-if="!useLargeProxyGroupIcon"
        class="text-base-content/80 @container mt-1.5 mb-1 flex items-center gap-2"
      >
        <div class="min-w-0 flex-1 text-sm">
          <ProxyGroupNow
            :name="name"
          />
        </div>
        <!-- 自动择优组:检测间隔 / 容差,和左边当前选中的节点同一行、垂直居中;
             这一行不到 22rem 宽(两列布局、窄屏)就不显示,节点名不让 -->
        <span
          v-if="testMeta"
          class="text-base-content/60 hidden shrink-0 text-xs whitespace-nowrap tabular-nums @min-[22rem]:inline"
        >{{ testMeta }}</span>
      </div>
    </template>
    <template v-slot:preview>
      <div
        v-if="isWindowResizing"
        class="bg-base-content/10 mt-2 h-4 rounded-full"
      />
      <!-- 故障转移组折叠态:当前在哪个页签、实际节点、状态,而不是内部子组的圆点 -->
      <FailoverLanes
        v-else-if="isFailover"
        :name="name"
        compact
      />
      <!-- 折叠态永远是一排圆点,不按订阅分段:分段是展开后看节点卡片用的,圆点摊成几行反而占地方 -->
      <ProxyPreview
        v-else
        :nodes="renderProxies"
        :now="proxyGroup.now"
        :group-name="proxyGroup.name"
        :relaxed-dots-spacing="true"
        @nodeclick="handlerProxySelect(name, $event)"
      />
    </template>
    <template v-slot:content>
      <div class="flex flex-col gap-0">
        <!-- 故障转移组展开:按主备顺序列页签(角色 / 健康 / 派生模式 / 成员探测结果),不是可点选的节点网格——
             主备由服务端按检测结果切,手动点选下一轮会被纠回去 -->
        <FailoverLanes
          v-if="isFailover"
          :name="name"
        />
        <Component
          v-else
          :is="groupProxiesByProvider ? ProxiesByProvider : ProxiesContent"
          :name="name"
          :now="proxyGroup.now"
          :render-proxies="renderProxies"
          :render-all="true"
        />
        <ProxyPenetrationSection :group-name="name" />
      </div>
    </template>
  </CollapseCard>
</template>

<script setup lang="ts">
import { useBounceOnVisible } from '@/composables/bouncein'
import { useGroupNodeStats } from '@/composables/groupNodeStats'
import { useRenderProxies } from '@/composables/renderProxies'
import { isHiddenGroup } from '@/helper'
import { isWindowResizing } from '@/helper/windowResizeState'
import {
  handlerProxySelect,
  hiddenGroupMap,
  proxyGroupLatencyTest,
  proxyMap,
} from '@/store/proxies'
import {
  groupProxiesByProvider,
  manageHiddenGroup,
  proxyGroupIconMargin,
  proxyGroupIconSize,
  useLargeProxyGroupIcon,
} from '@/store/settings'
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline'
import { managedOutbounds, siteSetNames } from '@/store/openboxSiteSets'
import { failoverGroupByTag } from '@/store/openboxFailover'
import { openPenetrationDialog } from '@/store/proxyGroupRulePenetration'
import { DARK_THEME, theme } from '@/store/settings'
import { twMerge } from 'tailwind-merge'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CollapseCard from '../common/CollapseCard.vue'
import LatencyTag from './LatencyTag.vue'
import ProxiesByProvider from './ProxiesByProvider.vue'
import ProxiesContent from './ProxiesContent.vue'
import FailoverLanes from './FailoverLanes.vue'
import ProxyGroupNow from './ProxyGroupNow.vue'
import ProxyIcon from './ProxyIcon.vue'
import ProxyPenetrationSection from './ProxyPenetrationSection.vue'
import ProxyPreview from './ProxyPreview.vue'

const props = defineProps<{
  name: string
}>()
const proxyGroup = computed(() => proxyMap.value[props.name])
const allProxies = computed(() => proxyGroup.value.all ?? [])
const { renderProxies } = useRenderProxies(allProxies, props.name)
// 标题后的「有效 / 总数」
const nodeStats = useGroupNodeStats(allProxies, props.name)
const isLatencyTesting = ref(false)
const handlerLatencyTest = async () => {
  if (isLatencyTesting.value) return

  isLatencyTesting.value = true
  try {
    await proxyGroupLatencyTest(props.name)
    isLatencyTesting.value = false
  } catch {
    isLatencyTesting.value = false
  }
}
const { t } = useI18n()
// 节点管理里的这个组(有就是 Open-Box 自己生成的组,没有就是内核配置里别的出站)
const managedGroup = computed(() => managedOutbounds.value.find((g) => g.name === props.name))
// 故障转移组:底层是 selector + 内部 urltest 子组,但对用户它是「故障转移」,不显示成手动组
const isFailover = computed(() => managedGroup.value?.type === 'failover')
const typeText = computed(() => (isFailover.value ? t('groupType_failover_short') : proxyGroup.value.type))
// 故障转移组标题后的数字是「通过检测的页签 / 页签数」(运行状态还没拉到时按定义算页签数、0 个通过)
const failoverStats = computed(() => {
  const st = failoverGroupByTag.value.get(props.name)
  const total = st ? st.lanes.length : (managedGroup.value?.lanes?.length ?? 0)
  const valid = st ? st.lanes.filter((l) => l.health === 'up').length : 0
  return { valid, total }
})
const shownStats = computed(() => (isFailover.value ? failoverStats.value : nodeStats.value))
// 自动择优组显示「检测间隔 5 分钟 · 容差 100 毫秒」;故障转移显示「检测间隔 30 秒 · 容差 100 毫秒」;手动组没有这两项
const intervalText = (interval: string) => {
  const m = /^(\d+)(m|s)$/.exec(interval)
  if (!m) return interval
  return `${m[1]} ${t(m[2] === 'm' ? 'groupUnitMinute' : 'groupUnitSecond')}`
}
const testMeta = computed(() => {
  const g = managedGroup.value
  if (!g || (g.type !== 'urltest' && g.type !== 'failover')) return ''
  const interval = g.interval || (g.type === 'failover' ? '30s' : '5m')
  return `${t('groupInterval')} ${intervalText(interval)} · ${t('groupTolerance')} ${g.tolerance ?? 100} ${t('groupUnitMs')}`
})

const hiddenGroup = computed({
  get: () => isHiddenGroup(props.name),
  set: (value: boolean) => {
    hiddenGroupMap.value[props.name] = value
  },
})

const handlerGroupToggle = () => {
  hiddenGroup.value = !hiddenGroup.value
}

const titleIconSize = computed(() => Math.max(proxyGroupIconSize.value, 46))

// 「域名穿透」只给站点集(它们才有自己的匹配规则);节点组的成员是节点,没有域名可穿
const isSiteSet = computed(() => siteSetNames.value.has(props.name))
const domainPenetrationHoverClass = computed(() =>
  theme.value === DARK_THEME
    ? 'hover:!bg-[#4b4428] hover:!border-base-content/[0.16]'
    : 'hover:!bg-[#f1ead6] hover:!border-base-content/[0.16]',
)

useBounceOnVisible()
</script>
