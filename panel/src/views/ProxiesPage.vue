<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <ProxiesCtrl />
    <div
      ref="proxiesRef"
      class="max-md:scrollbar-hidden min-h-0 flex-1 overflow-x-hidden"
      :class="disableProxiesPageScroll ? 'overflow-y-hidden' : 'overflow-y-scroll'"
      :style="padding"
      @scroll.passive="handleScroll"
    >
      <!-- 这一页的一切都来自内核的 clash_api:内核没在跑,这里就是空的。与其留一片
           空白让人以为"配置没生效",不如直说,并把去启动的路放在这儿。 -->
      <div
        v-if="kernelEmpty && proxiesTabShow !== PROXY_TAB_TYPE.PROVIDER"
        class="flex flex-col items-center gap-3 py-16 text-center"
      >
        <CpuChipIcon class="text-base-content/30 h-10 w-10" />
        <p class="text-base-content/70 text-sm">
          {{ $t(coreRunning === false ? 'proxiesKernelStopped' : 'proxiesKernelNoData') }}
        </p>
        <RouterLink
          :to="{ name: ROUTE_NAME.settings, query: { tab: SETTINGS_TAB.kernel } }"
          class="btn btn-primary btn-sm"
        >
          {{ $t('proxiesGoToKernel') }}
        </RouterLink>
      </div>
      <!-- 分列:设置里选的列数,组按 index % 列数 轮流落到各列(策略 / 节点两个页签) -->
      <template v-else-if="displayColumns > 1 && proxiesTabShow !== PROXY_TAB_TYPE.PROVIDER">
        <div
          class="grid gap-2 p-2"
          :class="displayColumns === 3 ? 'grid-cols-3' : 'grid-cols-2'"
        >
          <div
            v-for="idx in displayColumns"
            :key="idx"
            class="flex flex-1 flex-col gap-2"
          >
            <component
              v-for="name in filterContent(
                proxiesTabShow === PROXY_TAB_TYPE.NODE ? nodeGroups : renderGroups,
                idx - 1,
              )"
              :is="renderComponent"
              :key="name"
              :name="name"
            />
          </div>
        </div>
      </template>
      <!-- 订阅标签渲染 Open-Box 自己的订阅(见 store/openboxSubscriptions.ts 的说明:
           Clash 的 provider 概念在 Open-Box 里不存在)。分列和策略 / 节点页签同一个设置(GitHub #33) -->
      <div
        v-else-if="proxiesTabShow === PROXY_TAB_TYPE.PROVIDER"
        class="grid gap-2 px-2 md:py-2"
        :class="displayColumns === 3 ? 'grid-cols-3' : displayColumns === 2 ? 'grid-cols-2' : 'grid-cols-1'"
      >
        <p
          v-if="!openboxSubscriptions.length"
          class="text-base-content/60 py-10 text-center text-sm"
        >
          {{ $t('subscriptionEmptyHint') }}
          <MarketLink />
          {{ $t('subscriptionEmptyHintSuffix') }}
        </p>
        <div
          v-for="idx in displayColumns"
          :key="idx"
          class="flex flex-1 flex-col gap-2"
        >
          <SubscriptionCard
            v-for="sub in filterContent(openboxSubscriptions, idx - 1)"
            :key="sub.id"
            :subscription="sub"
            :refreshing="refreshingSubId === sub.id"
            @refresh="handleSubscriptionRefresh(sub.id)"
            @edit="requestEdit(sub)"
          />
        </div>
      </div>
      <div
        class="grid grid-cols-1 gap-2 px-2 md:py-2"
        v-else
      >
        <component
          v-for="name in proxiesTabShow === PROXY_TAB_TYPE.NODE ? nodeGroups : renderGroups"
          :is="renderComponent"
          :key="name"
          :name="name"
        />
      </div>
    </div>
    <ProxyGroupRulePenetrationDialog />

    <!-- 订阅卡片上的「修改」就在这一页弹窗改,和订阅设置页用同一个弹窗组件;保存后留在这一页。
         v-if 保证每次打开都是全新实例(弹窗里重命名规则的初始值只在挂载时读一次),
         关掉就把 editing 清掉,下次打开才会重建 -->
    <AddSubscriptionDialog
      v-if="editing"
      v-model="showEditDialog"
      :subscription="editing"
      @saved="handleEdited"
    />
  </div>
</template>

<script setup lang="ts">
import MarketLink from '@/components/common/MarketLink.vue'
import ProxyGroup from '@/components/proxies/ProxyGroup.vue'
import ProxyGroupRulePenetrationDialog from '@/components/proxies/ProxyGroupRulePenetrationDialog.vue'
import ProxyGroupForMobile from '@/components/proxies/ProxyGroupForMobile.vue'
import ProxyProvider from '@/components/proxies/ProxyProvider.vue'
import ProxiesCtrl from '@/components/sidebar/ProxiesCtrl.tsx'
import { fetchServiceStatus, type OpenboxSubscription } from '@/api/openbox'
import { CpuChipIcon } from '@heroicons/vue/24/outline'
import { RouterLink } from 'vue-router'
import { isEmpty } from 'lodash'
import AddSubscriptionDialog from '@/components/subscription/AddSubscriptionDialog.vue'
import SubscriptionCard from '@/components/subscription/SubscriptionCard.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import {
  disableProxiesPageScroll,
  isProxiesPageMounted,
  nodeGroups,
  renderGroups,
} from '@/composables/proxies'
import { refreshSubscription } from '@/api/openbox'
import { loadOpenboxNodeGroups, loadOpenboxSiteSets, nodeProviders } from '@/store/openboxSiteSets'
import { PROXY_TAB_TYPE, ROUTE_NAME, SETTINGS_TAB } from '@/constant'
import {
  loadOpenboxSubscriptions,
  notifySubscriptionSaved,
  openboxSubscriptions,
} from '@/store/openboxSubscriptions'
import { isMiddleScreen } from '@/helper/utils'
import {
  proxyMap,
  fetchProxies,
  getDescendantProxyNames,
  getProxyAutoRefreshSchedule,
  proxiesTabShow,
} from '@/store/proxies'
import { proxyGroupColumns } from '@/store/settings'
import { useDocumentVisibility, useIntervalFn, useSessionStorage } from '@vueuse/core'
import { pollLatencyHistoryVersion } from '@/store/latencyHistory'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})

// 订阅标签用的是 Open-Box 自己的订阅列表(不是 Clash provider),进页面就拉一次。
onMounted(async () => {
  void loadOpenboxSubscriptions()
  // 节点管理的数据要先到,fetchProxies 才能给条目配上图标;顺序反了图标就等下一次刷新
  await Promise.all([loadOpenboxSiteSets(), loadOpenboxNodeGroups()])
  void fetchProxies()
})

// 内核没在跑时 proxyMap 是空的。空的时候问一次内核状态,把"没在跑"和"在跑但没数据"
// 分开说——前者去启动,后者是配置问题。
const kernelEmpty = computed(() => isEmpty(proxyMap.value))
const coreRunning = ref<boolean | null>(null)
watch(
  kernelEmpty,
  async (empty) => {
    if (!empty) return
    try {
      coreRunning.value = (await fetchServiceStatus()).core.running
    } catch {
      coreRunning.value = null
    }
  },
  { immediate: true },
)

const refreshingSubId = ref<string | null>(null)
const handleSubscriptionRefresh = async (id: string) => {
  if (refreshingSubId.value) return
  refreshingSubId.value = id
  try {
    const res = await refreshSubscription(id)
    await loadOpenboxSubscriptions()
    notifySubscriptionSaved(res.changed, 'refreshed')
  } catch {
    // 失败原因在订阅设置页会逐条显示;这里是只读入口,不重复铺错误文案
  } finally {
    refreshingSubId.value = null
  }
}

// 「修改」就在这一页弹窗改(弹窗自己负责保存和提示),保存后重新拉一遍订阅列表;
// 删除仍留在订阅设置页做
const showEditDialog = ref(false)
const editing = ref<OpenboxSubscription | null>(null)
const requestEdit = (sub: OpenboxSubscription) => {
  editing.value = sub
  showEditDialog.value = true
}
const handleEdited = () => {
  void loadOpenboxSubscriptions()
}
watch(showEditDialog, (open) => {
  if (!open) editing.value = null
})

const proxiesRef = ref()
const documentVisible = useDocumentVisibility()

// 服务端按 interval 定时测速(latency-scheduler),结果什么时候落下来页面不知道:sing-box 每个节点
// 只留最新一次,按历史间隔推算下次刷新那套在 sing-box 上根本推不出来。所以页面可见时每 15 秒问
// 一次服务端历史的版本号(一个很小的 JSON),变了才重新拉节点数据(顺带拉整份历史)。
useIntervalFn(async () => {
  if (documentVisible.value !== 'visible') return
  if (await pollLatencyHistoryVersion()) void fetchProxies()
}, 15_000)
const autoRefreshTimer = ref<number>()
const scrollStatus = useSessionStorage('cache/proxies-scroll-status', {
  [PROXY_TAB_TYPE.POLICY]: 0,
  [PROXY_TAB_TYPE.NODE]: 0,
  [PROXY_TAB_TYPE.PROVIDER]: 0,
})
const AUTO_REFRESH_GRACE_MS = 30 * 1000
type AutoRefreshSchedule = {
  dueAt: number
  intervalMs: number
}

const handleScroll = () => {
  scrollStatus.value[proxiesTabShow.value] = proxiesRef.value.scrollTop
}

const waitTickUntilReady = (startTime = performance.now()) => {
  if (
    performance.now() - startTime > 300 ||
    proxiesRef.value.scrollHeight > scrollStatus.value[proxiesTabShow.value]
  ) {
    proxiesRef.value.scrollTo({
      top: scrollStatus.value[proxiesTabShow.value],
      behavior: 'smooth',
    })
  } else {
    requestAnimationFrame(() => {
      waitTickUntilReady(startTime)
    })
  }
}

watch(proxiesTabShow, () =>
  nextTick(() => {
    waitTickUntilReady()
    fetchProxies()
  }),
)

const nextAutoRefreshSchedule = computed<AutoRefreshSchedule | null>(() => {
  const candidateNames = new Set<string>()

  if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER) {
    const subscriptionNames = new Set(renderGroups.value)

    nodeProviders.value.forEach((provider, tag) => {
      if (subscriptionNames.has(provider)) {
        candidateNames.add(tag)
      }
    })
  } else {
    const rootNames =
      proxiesTabShow.value === PROXY_TAB_TYPE.NODE
        ? nodeGroups.value
        : renderGroups.value

    rootNames.forEach((name) => {
      candidateNames.add(name)
      getDescendantProxyNames(name).forEach((descendantName) => {
        candidateNames.add(descendantName)
      })
    })
  }

  let nextSchedule: AutoRefreshSchedule | null = null

  candidateNames.forEach((name) => {
    const schedule = getProxyAutoRefreshSchedule(name)

    if (!schedule) {
      return
    }

    if (!nextSchedule || schedule.dueAt < nextSchedule.dueAt) {
      nextSchedule = schedule
    }
  })

  return nextSchedule
})

const clearAutoRefreshTimer = () => {
  if (autoRefreshTimer.value) {
    window.clearTimeout(autoRefreshTimer.value)
    autoRefreshTimer.value = undefined
  }
}

const scheduleAutoRefresh = () => {
  clearAutoRefreshTimer()

  if (documentVisible.value !== 'visible') {
    return
  }

  const schedule = nextAutoRefreshSchedule.value

  if (!schedule) {
    return
  }

  const now = Date.now()
  let nextRefreshAt = schedule.dueAt + AUTO_REFRESH_GRACE_MS

  if (nextRefreshAt <= now) {
    const cyclesBehind = Math.floor((now - nextRefreshAt) / schedule.intervalMs) + 1

    nextRefreshAt += cyclesBehind * schedule.intervalMs
  }

  const delay = Math.max(1000, nextRefreshAt - now)

  autoRefreshTimer.value = window.setTimeout(async () => {
    if (documentVisible.value !== 'visible') {
      scheduleAutoRefresh()
      return
    }

    try {
      await fetchProxies()
    } finally {
      scheduleAutoRefresh()
    }
  }, delay)
}

isProxiesPageMounted.value = false

onMounted(() => {
  setTimeout(() => {
    isProxiesPageMounted.value = true
    nextTick(() => {
      waitTickUntilReady()
      fetchProxies()
    })
  })
})

watch([nextAutoRefreshSchedule, documentVisible], () => {
  scheduleAutoRefresh()
})

onUnmounted(() => {
  clearAutoRefreshTimer()
})

const renderComponent = computed(() => {
  if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER) {
    return ProxyProvider
  }

  if (isMiddleScreen.value && displayColumns.value > 1) {
    return ProxyGroupForMobile
  }

  return ProxyGroup
})

// 实际摆几列:设置里的列数,三个页签(策略 / 节点 / 订阅)共用;窄屏最多两列(三列摆不下),
// 条目不够多也不硬拆。以前只有策略页签分列,节点页签选了双列也是单列(GitHub #33)
const columnItemCount = computed(() => {
  if (proxiesTabShow.value === PROXY_TAB_TYPE.NODE) return nodeGroups.value.length
  if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER) return openboxSubscriptions.value.length
  return renderGroups.value.length
})
const displayColumns = computed(() => {
  if (columnItemCount.value < 2) return 1
  const wanted = Math.min(Math.max(Math.trunc(proxyGroupColumns.value) || 1, 1), 3)
  return Math.min(wanted, isMiddleScreen.value ? 2 : 3, columnItemCount.value)
})

const filterContent: <T>(all: T[], target: number) => T[] = (all, target) => {
  return all.filter((_, index: number) => index % displayColumns.value === target)
}
</script>
