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
      <template v-if="displayTwoColumns && proxiesTabShow !== PROXY_TAB_TYPE.PROVIDER">
        <div class="grid grid-cols-2 gap-2 p-2">
          <div
            v-for="idx in [0, 1]"
            :key="idx"
            class="flex flex-1 flex-col gap-2"
          >
            <template v-if="proxiesTabShow === PROXY_TAB_TYPE.NODE">
              <ProxyGroupUnit
                v-for="names in filterContent(nodeGroupBlocks, idx)"
                :key="names.join('::')"
                :names="names"
              />
            </template>
            <component
              v-else
              v-for="name in filterContent(renderGroups, idx)"
              :is="renderComponent"
              :key="name"
              :name="name"
            />
          </div>
        </div>
      </template>
      <!-- 订阅标签渲染 Open-Box 自己的订阅(见 store/openboxSubscriptions.ts 的说明:
           Clash 的 provider 概念在 Open-Box 里不存在)。不走两列布局:订阅通常只有一两条,
           摊成两列反而稀疏。 -->
      <div
        class="grid grid-cols-1 gap-2 p-2"
        v-else-if="proxiesTabShow === PROXY_TAB_TYPE.PROVIDER"
      >
        <p
          v-if="!openboxSubscriptions.length"
          class="text-base-content/60 py-10 text-center text-sm"
        >
          {{ $t('subscriptionEmptyHint') }}
        </p>
        <SubscriptionCard
          v-for="sub in openboxSubscriptions"
          :key="sub.id"
          :subscription="sub"
          :refreshing="refreshingSubId === sub.id"
          @refresh="handleSubscriptionRefresh(sub.id)"
          @edit="goToSubscriptionSettings"
          @delete="goToSubscriptionSettings"
        />
      </div>
      <div
        class="grid grid-cols-1 gap-2 p-2"
        v-else
      >
        <template v-if="proxiesTabShow === PROXY_TAB_TYPE.NODE">
          <ProxyGroupUnit
            v-for="names in nodeGroupBlocks"
            :key="names.join('::')"
            :names="names"
          />
        </template>
        <component
          v-else
          v-for="name in renderGroups"
          :is="renderComponent"
          :key="name"
          :name="name"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ProxyGroup from '@/components/proxies/ProxyGroup.vue'
import ProxyGroupForMobile from '@/components/proxies/ProxyGroupForMobile.vue'
import ProxyGroupUnit from '@/components/proxies/ProxyGroupUnit.vue'
import ProxyProvider from '@/components/proxies/ProxyProvider.vue'
import ProxiesCtrl from '@/components/sidebar/ProxiesCtrl.tsx'
import SubscriptionCard from '@/components/subscription/SubscriptionCard.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import {
  disableProxiesPageScroll,
  isProxiesPageMounted,
  nodeGroupBlocks,
  renderGroups,
} from '@/composables/proxies'
import { refreshSubscription } from '@/api/openbox'
import { PROXY_TAB_TYPE, ROUTE_NAME, SETTINGS_TAB } from '@/constant'
import {
  loadOpenboxSubscriptions,
  openboxSubscriptions,
} from '@/store/openboxSubscriptions'
import { routingPendingDeploy } from '@/store/routing'
import { useRouter } from 'vue-router'
import { isMiddleScreen } from '@/helper/utils'
import {
  fetchProxies,
  getDescendantProxyNames,
  getProxyAutoRefreshSchedule,
  proxiesTabShow,
  proxyProviederList,
} from '@/store/proxies'
import { twoColumnProxyGroup } from '@/store/settings'
import { useDocumentVisibility, useSessionStorage } from '@vueuse/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})
const router = useRouter()

// 订阅标签用的是 Open-Box 自己的订阅列表(不是 Clash provider),进页面就拉一次。
onMounted(loadOpenboxSubscriptions)

const refreshingSubId = ref<string | null>(null)
const handleSubscriptionRefresh = async (id: string) => {
  if (refreshingSubId.value) return
  refreshingSubId.value = id
  try {
    await refreshSubscription(id)
    // 刷新会换掉这条订阅的节点,和在订阅设置页刷新是同一件事,同样要提示需要重新部署
    routingPendingDeploy.value = true
    await loadOpenboxSubscriptions()
  } catch {
    // 失败原因在订阅设置页会逐条显示;这里是只读入口,不重复铺错误文案
  } finally {
    refreshingSubId.value = null
  }
}

// 编辑/删除都是有后果的操作,留在订阅设置页统一做——这里只把人带过去,
// 避免同一个操作在两处各有一套确认流程。
const goToSubscriptionSettings = () => {
  router.push({ name: ROUTE_NAME.settings, query: { tab: SETTINGS_TAB.subscriptions } })
}

const proxiesRef = ref()
const documentVisible = useDocumentVisibility()
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
    renderGroups.value.forEach((providerName) => {
      const provider = proxyProviederList.value.find((item) => item.name === providerName)

      provider?.proxies.forEach((proxy) => {
        candidateNames.add(proxy.name)
      })
    })
  } else {
    const rootNames =
      proxiesTabShow.value === PROXY_TAB_TYPE.NODE
        ? nodeGroupBlocks.value.flat()
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

  if (isMiddleScreen.value && displayTwoColumns.value) {
    return ProxyGroupForMobile
  }

  return ProxyGroup
})

const displayTwoColumns = computed(() => {
  if (proxiesTabShow.value !== PROXY_TAB_TYPE.POLICY) {
    return false
  }

  return twoColumnProxyGroup.value && renderGroups.value.length > 1
})

const filterContent: <T>(all: T[], target: number) => T[] = (all, target) => {
  return all.filter((_, index: number) => index % 2 === target)
}
</script>
