<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <ProxiesCtrl />
    <div
      ref="proxiesRef"
      class="max-md:scrollbar-hidden min-h-0 flex-1 overflow-x-hidden"
      :class="
        proxiesTabShow === PROXY_TAB_TYPE.DOMAIN || disableProxiesPageScroll
          ? 'overflow-y-hidden'
          : 'overflow-y-scroll'
      "
      :style="padding"
      @scroll.passive="handleScroll"
    >
      <template v-if="displayTwoColumns">
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
      <div
        v-else-if="proxiesTabShow === PROXY_TAB_TYPE.DOMAIN"
        class="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-2"
      >
        <ProxyDomainGroupView class="min-h-0 flex-1" />
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
    <ProxyGroupRulePenetrationDialog />
  </div>
</template>

<script setup lang="ts">
import ProxyDomainGroupView from '@/components/proxies/ProxyDomainGroupView.vue'
import ProxyGroup from '@/components/proxies/ProxyGroup.vue'
import ProxyGroupForMobile from '@/components/proxies/ProxyGroupForMobile.vue'
import ProxyGroupRulePenetrationDialog from '@/components/proxies/ProxyGroupRulePenetrationDialog.vue'
import ProxyGroupUnit from '@/components/proxies/ProxyGroupUnit.vue'
import ProxyProvider from '@/components/proxies/ProxyProvider.vue'
import ProxiesCtrl from '@/components/sidebar/ProxiesCtrl.tsx'
import { usePaddingForViews } from '@/composables/paddingViews'
import {
  disableProxiesPageScroll,
  fetchCustomDomainGroupsStatus,
  isProxiesPageMounted,
  nodeGroupBlocks,
  renderGroups,
} from '@/composables/proxies'
import { PROXY_TAB_TYPE } from '@/constant'
import { isMiddleScreen } from '@/helper/utils'
import {
  fetchProxies,
  getDescendantProxyNames,
  getProxyAutoRefreshSchedule,
  proxiesTabShow,
  proxyProviederList,
} from '@/store/proxies'
import { fetchRules, rules } from '@/store/rules'
import { twoColumnProxyGroup } from '@/store/settings'
import { useDocumentVisibility, useSessionStorage } from '@vueuse/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})
const proxiesRef = ref()
const documentVisible = useDocumentVisibility()
const autoRefreshTimer = ref<number>()
const scrollStatus = useSessionStorage('cache/proxies-scroll-status', {
  [PROXY_TAB_TYPE.POLICY]: 0,
  [PROXY_TAB_TYPE.DOMAIN]: 0,
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
    if (proxiesTabShow.value === PROXY_TAB_TYPE.DOMAIN && rules.value.length === 0) {
      fetchRules()
    }
    if (proxiesTabShow.value === PROXY_TAB_TYPE.DOMAIN) {
      fetchCustomDomainGroupsStatus()
    }
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
      Promise.allSettled([
        fetchProxies(),
        rules.value.length === 0 ? fetchRules() : Promise.resolve(),
        fetchCustomDomainGroupsStatus(),
      ])
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
  if (proxiesTabShow.value === PROXY_TAB_TYPE.DOMAIN) {
    return ProxyDomainGroupView
  }

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
