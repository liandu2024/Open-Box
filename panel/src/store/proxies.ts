import {
  deleteFixedProxyAPI,
  disconnectByIdAPI,
  fetchProxiesAPI,
  fetchProxyGroupLatencyAPI,
  fetchProxyLatencyAPI,
  fetchProxyProviderAPI,
  fetchProxyProviderLatencyAPI,
  isSingBox,
  selectProxyAPI,
} from '@/api'
import {
  GLOBAL,
  IPV6_TEST_URL,
  NOT_CONNECTED,
  PROXY_TAB_TYPE,
  PROXY_TYPE,
  TEST_URL,
} from '@/constant'
import { isProxyGroup } from '@/helper'
import { showNotification } from '@/helper/notification'
import type { History, Proxy, ProxyProvider } from '@/types'
import { useStorage } from '@vueuse/core'
import { last } from 'lodash'
import pLimit from 'p-limit'
import { computed, ref } from 'vue'
import { activeConnections } from './connections'
import {
  automaticDisconnection,
  groupTestUrls,
  iconReflectList,
  independentLatencyTest,
  IPv6test,
  speedtestTimeout,
  speedtestUrl,
} from './settings'
import { initSmartWeights } from './smart'

export const proxiesFilter = ref('')
export const proxiesTabShow = useStorage<PROXY_TAB_TYPE>(
  'cache/proxies-tab-show',
  PROXY_TAB_TYPE.POLICY,
)

export const proxyGroupList = ref<string[]>([])
export const proxyMap = ref<Record<string, Proxy>>({})
export const IPv6Map = useStorage<Record<string, boolean>>('config/ipv6-map', {})
export const hiddenGroupMap = useStorage<Record<string, boolean>>('config/hidden-group-map', {})
export const proxyProviederList = ref<ProxyProvider[]>([])

const AUTO_REFRESHABLE_PROXY_TYPES = new Set([PROXY_TYPE.Fallback, PROXY_TYPE.URLTest])
const MIN_AUTO_REFRESH_INTERVAL_MS = 30 * 1000
const MAX_AUTO_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
const AUTO_REFRESH_INTERVAL_JITTER_RATIO = 0.35

const getMedian = (values: number[]) => {
  const sorted = [...values].sort((prev, next) => prev - next)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2
  }

  return sorted[middle]
}

const getHistoryIntervals = (history: History) => {
  const intervals: number[] = []

  for (let index = 1; index < history.length; index++) {
    const prevTime = Date.parse(history[index - 1].time)
    const currentTime = Date.parse(history[index].time)

    if (!Number.isFinite(prevTime) || !Number.isFinite(currentTime)) {
      continue
    }

    const interval = currentTime - prevTime

    if (interval < MIN_AUTO_REFRESH_INTERVAL_MS || interval > MAX_AUTO_REFRESH_INTERVAL_MS) {
      continue
    }

    intervals.push(interval)
  }

  return intervals.slice(-4)
}

const hasStableIntervals = (intervals: number[]) => {
  if (intervals.length < 2) {
    return false
  }

  const median = getMedian(intervals)

  return intervals.every((interval) => {
    return Math.abs(interval - median) <= median * AUTO_REFRESH_INTERVAL_JITTER_RATIO
  })
}

export const inferProxyAutoRefreshIntervalMs = (proxyName: string) => {
  const proxy = proxyMap.value[proxyName]

  if (!proxy?.history?.length) {
    return null
  }

  const intervals = getHistoryIntervals(proxy.history)

  if (!intervals.length) {
    return null
  }

  const medianInterval = getMedian(intervals)
  const proxyType = proxy.type.toLowerCase() as PROXY_TYPE

  if (AUTO_REFRESHABLE_PROXY_TYPES.has(proxyType)) {
    return medianInterval
  }

  if (hasStableIntervals(intervals)) {
    return medianInterval
  }

  return null
}

export const getProxyAutoRefreshSchedule = (proxyName: string) => {
  const proxy = proxyMap.value[proxyName]
  const intervalMs = inferProxyAutoRefreshIntervalMs(proxyName)
  const latestHistory = last(proxy?.history)

  if (!intervalMs || !latestHistory) {
    return null
  }

  const latestTime = Date.parse(latestHistory.time)

  if (!Number.isFinite(latestTime)) {
    return null
  }

  return {
    intervalMs,
    dueAt: latestTime + intervalMs,
  }
}

const speedtestUrlWithDefault = computed(() => {
  return speedtestUrl.value || TEST_URL
})

export const getTestUrl = (groupName?: string) => {
  if (!groupName || !independentLatencyTest.value) {
    return speedtestUrlWithDefault.value
  }

  const groupTestUrl = groupTestUrls.value.find((item) => item.name === groupName)

  if (groupTestUrl) {
    return groupTestUrl.url
  }

  const proxyNode =
    proxyMap.value[groupName] || proxyProviederList.value.find((p) => p.name === groupName)

  return proxyNode?.testUrl || speedtestUrlWithDefault.value
}

export const getLatencyByName = (proxyName: string, groupName?: string) => {
  const history = getHistoryByName(proxyName, groupName)

  return getLatencyFromHistory(history)
}

export const getProxyProviderName = (proxyName: string) => {
  const proxyNode = proxyMap.value[proxyName]

  return (
    proxyNode?.['provider-name'] ||
    proxyProviederList.value.find((group) => group.proxies.some((node) => node.name === proxyName))
      ?.name ||
    ''
  )
}

export const getHistoryByName = (proxyName: string, groupName?: string) => {
  if (independentLatencyTest.value && !isSingBox.value) {
    const proxyNode = proxyMap.value[proxyName]
    const url = getTestUrl(groupName)

    if (!proxyNode) {
      return []
    }

    if (!proxyNode?.extra) {
      proxyNode.extra = {}
    }

    if (!proxyNode.extra?.[url]) {
      proxyNode.extra[url] = {
        history: [],
        alive: true,
      }
    }

    return proxyNode?.extra?.[url]?.history
  }

  const nowNode = proxyMap.value[getNowProxyNodeName(proxyName)]

  return nowNode?.history
}

export const getIPv6ByName = (proxyName: string) => {
  return IPv6Map.value[getNowProxyNodeName(proxyName)]
}

let fetchTime = 0

export const fetchProxies = async () => {
  const nowTime = Date.now()

  fetchTime = nowTime

  const [proxyRes, providerRes] = await Promise.all([fetchProxiesAPI(), fetchProxyProviderAPI()])
  const proxyData = proxyRes.data
  const providerData = providerRes.data

  if (fetchTime !== nowTime) {
    return
  }

  const sortIndex = proxyData.proxies[GLOBAL].all ?? []
  const allProviderProxies: Record<string, Proxy> = {}
  const providers = Object.values(providerData.providers).filter(
    (provider) => provider.name !== 'default' && provider.vehicleType !== 'Compatible',
  )

  for (const provider of providers) {
    for (const proxy of provider.proxies) {
      proxy['provider-name'] ||= provider.name
      allProviderProxies[proxy.name] = proxy
    }
  }

  proxyMap.value = Object.fromEntries(
    Object.entries({
      ...allProviderProxies,
      ...proxyData.proxies,
    }).map(([name, proxy]) => {
      return [
        name,
        {
          ...(allProviderProxies[name] ?? {}),
          ...proxy,
        },
      ]
    }),
  )
  proxyGroupList.value = Object.values(proxyData.proxies)
    .filter((proxy) => proxy.all?.length && proxy.name !== GLOBAL)
    .sort((prev, next) => {
      const prevIndex = sortIndex.indexOf(prev.name)
      const nextIndex = sortIndex.indexOf(next.name)

      if (prevIndex === -1 && nextIndex === -1) {
        return 0
      }
      if (prevIndex === -1) {
        return 1
      }
      if (nextIndex === -1) {
        return -1
      }
      // 都在 sortIndex 中，按索引排序
      return prevIndex - nextIndex
    })
    .map((proxy) => proxy.name)

  proxyProviederList.value = providers

  const smartGroups: string[] = []

  Object.entries(proxyMap.value).forEach(([name, proxy]) => {
    const iconReflect = iconReflectList.value.find((icon) => icon.name === name)

    if (iconReflect) {
      proxyMap.value[name].icon = iconReflect.icon
    }
    if (IPv6test.value && getIPv6FromExtra(proxy)) {
      IPv6Map.value[name] = true
    }

    if (proxy.type.toLowerCase() === PROXY_TYPE.Smart) {
      smartGroups.push(name)
    }
  })

  if (smartGroups.length > 0) {
    initSmartWeights(smartGroups)
  }
}

export const handlerProxySelect = async (proxyGroupName: string, proxyName: string) => {
  const proxyGroup = proxyMap.value[proxyGroupName]

  if (proxyGroup.type.toLowerCase() === PROXY_TYPE.LoadBalance) return
  if (proxyGroup.now === proxyName) {
    await fetchProxies()
    if (proxyGroup.now === proxyName) return
  }

  await selectProxyAPI(proxyGroupName, proxyName)
  proxyMap.value[proxyGroupName].now = proxyName

  if (automaticDisconnection.value) {
    activeConnections.value
      .filter((c) => c.chains.includes(proxyGroupName))
      .forEach((c) => disconnectByIdAPI(c.id))
  }
  fetchProxies()
}

const getProviderNameByProxy = (proxyName: string) => {
  const hinted = proxyMap.value[proxyName]?.['provider-name']

  if (hinted) {
    return proxyProviederList.value.some((provider) => provider.name === hinted) ? hinted : ''
  }

  return (
    proxyProviederList.value.find((provider) =>
      provider.proxies.some((proxy) => proxy.name === proxyName),
    )?.name ?? ''
  )
}

const fetchNodeLatency = (proxyName: string, url: string, timeout: number) => {
  if (!isSingBox.value) {
    const providerName = getProviderNameByProxy(proxyName)

    if (providerName) {
      return fetchProxyProviderLatencyAPI(providerName, proxyName, url, timeout)
    }
  }

  return fetchProxyLatencyAPI(proxyName, url, timeout)
}

const latencyTestForSingle = async (proxyName: string, url: string, timeout: number) => {
  const now = getNowProxyNodeName(proxyName)

  if (IPv6test.value) {
    try {
      const { data: ipv6LatencyResult } = await fetchNodeLatency(now, IPV6_TEST_URL, 2000)

      IPv6Map.value[now] = ipv6LatencyResult.delay > NOT_CONNECTED
    } catch {
      IPv6Map.value[now] = false
    }
  }

  return await fetchNodeLatency(independentLatencyTest.value ? proxyName : now, url, timeout)
}

const getNameForNotification = (name: string, url: string) => {
  if (independentLatencyTest.value) {
    return `${name}\n@${url}`
  }

  return name
}

export const proxyLatencyTest = async (
  proxyName: string,
  url = speedtestUrlWithDefault.value,
  timeout = speedtestTimeout.value,
) => {
  const res = await latencyTestForSingle(proxyName, url, timeout)
  await fetchProxies()

  if (res.status !== 200) {
    showNotification({
      content: 'testFailedTip',
      params: {
        name: getNameForNotification(proxyName, url),
      },
      type: 'alert-error',
    })
  }
}

const setHistory = (proxyName: string, delay: number) => {
  const history = getHistoryByName(proxyName)
  const now = new Date()

  history.push({
    time: now.toISOString(),
    delay,
  })
}

const TIP_KEY = 'testLatencyOneByOneWithTip'
const limiter = pLimit(5)
const testLatencyOneByOneWithTip = async (
  proxyGroupName: string,
  nodes: string[],
  url = speedtestUrlWithDefault.value,
  displayName = proxyGroupName,
  keyName = proxyGroupName,
) => {
  const total = nodes.length
  let testDone = 0
  let testFailed = 0

  await Promise.allSettled(
    nodes.map((name) =>
      limiter(async () => {
        const res = await latencyTestForSingle(name, url, Math.min(1500, speedtestTimeout.value))

        if (res.status !== 200) {
          testFailed++
          setHistory(name, NOT_CONNECTED)
        } else {
          setHistory(name, res.data.delay)
        }
        testDone++
        showNotification({
          content: 'testFinishedTip',
          key: TIP_KEY + keyName,
          params: {
            name: getNameForNotification(displayName, url),
            total: total.toString(),
            number: testDone.toString(),
          },
          type: 'alert-info',
          timeout: 0,
        })
      }),
    ),
  )
  showNotification({
    content: 'testFinishedResultTip',
    key: TIP_KEY + keyName,
    params: {
      name: getNameForNotification(displayName, url),
      total: total.toString(),
      success: `${total - testFailed}`,
      failed: `${testFailed}`,
    },
    type: testFailed ? 'alert-warning' : 'alert-success',
    timeout: 3000,
  })
  await fetchProxies()
}

export const proxyNodesLatencyTest = async (
  scopeName: string,
  nodes: string[],
  options?: {
    displayName?: string
    keyName?: string
    url?: string
  },
) => {
  if (!nodes.length) return

  const {
    displayName = scopeName,
    keyName = scopeName,
    url = getTestUrl(scopeName),
  } = options ?? {}

  return testLatencyOneByOneWithTip(scopeName, nodes, url, displayName, keyName)
}

export const proxyGroupLatencyTest = async (proxyGroupName: string) => {
  const proxyNode = proxyMap.value[proxyGroupName]
  const all = proxyNode.all ?? []
  const url = getTestUrl(proxyGroupName)

  if (
    [PROXY_TYPE.Selector, PROXY_TYPE.LoadBalance, PROXY_TYPE.Smart].includes(
      proxyNode.type.toLowerCase() as PROXY_TYPE,
    )
  ) {
    if (proxyNode.fixed) {
      deleteFixedProxyAPI(proxyGroupName)
    }
    return testLatencyOneByOneWithTip(proxyGroupName, all, url)
  }

  const timeout = Math.max(5000, speedtestTimeout.value)

  if (IPv6test.value) {
    try {
      const { data: ipv6LatencyResult } = await fetchProxyGroupLatencyAPI(
        proxyGroupName,
        IPV6_TEST_URL,
        timeout,
      )

      all?.forEach((name) => {
        IPv6Map.value[getNowProxyNodeName(name)] = ipv6LatencyResult[name] > NOT_CONNECTED
      })
    } catch {
      all?.forEach((name) => {
        IPv6Map.value[getNowProxyNodeName(name)] = false
      })
    }
  }
  await fetchProxyGroupLatencyAPI(proxyGroupName, url, timeout)
  await fetchProxies()

  const total = all.length
  const testFailed = all.filter(
    (name) => getLatencyByName(name, proxyGroupName) === NOT_CONNECTED,
  ).length

  showNotification({
    content: 'testFinishedResultTip',
    key: TIP_KEY + proxyGroupName,
    params: {
      name: getNameForNotification(proxyGroupName, url),
      total: total.toString(),
      success: `${total - testFailed}`,
      failed: `${testFailed}`,
    },
    type: testFailed ? 'alert-warning' : 'alert-success',
    timeout: 3000,
  })
}

export const allProxiesLatencyTest = async () => {
  if (independentLatencyTest.value) {
    const limit = pLimit(3)

    return await Promise.all(
      proxyGroupList.value.map((proxyGroupName) =>
        limit(async () => {
          await proxyGroupLatencyTest(proxyGroupName)
        }),
      ),
    )
  }

  const proxyNode = Object.keys(proxyMap.value).filter((proxy) => !isProxyGroup(proxy))

  return testLatencyOneByOneWithTip('all', proxyNode)
}

const getLatencyFromHistory = (history: Proxy['history']) => {
  return last(history)?.delay ?? NOT_CONNECTED
}

const getIPv6FromExtra = (proxy: Proxy) => {
  const ipv6History = proxy.extra?.[IPV6_TEST_URL]?.history

  return (last(ipv6History)?.delay ?? NOT_CONNECTED) > NOT_CONNECTED
}

export const getNowProxyNodeName = (name: string) => {
  let node = proxyMap.value[name]

  if (!name || !node) {
    return name
  }

  while (node.now && node.now !== node.name) {
    const nextNode = proxyMap.value[node.now]

    if (!nextNode) {
      return node.name
    }

    node = nextNode
  }

  return node.name
}

export const getProxyRouteChain = (name: string) => {
  const routeChain: string[] = []
  let node = proxyMap.value[name]

  if (!name || !node) {
    return routeChain
  }

  const visited = new Set<string>([name])

  while (node.now && node.now !== node.name) {
    const nextName = node.now

    if (visited.has(nextName)) {
      break
    }

    routeChain.push(nextName)
    visited.add(nextName)

    const nextNode = proxyMap.value[nextName]

    if (!nextNode) {
      break
    }

    node = nextNode
  }

  return routeChain
}

export const getProxyGroupChains = (name: string) => {
  return [
    name,
    ...getProxyRouteChain(name).filter((routeName) => proxyGroupList.value.includes(routeName)),
  ]
}

export const getProxyFullChains = (name: string) => {
  if (!name) {
    return []
  }

  return [name, ...getProxyRouteChain(name)]
}

export const getDirectChildProxyGroups = (groupName: string) => {
  return (proxyMap.value[groupName]?.all ?? []).filter((name) => {
    return Boolean(proxyMap.value[name]?.all?.length)
  })
}

export const getDescendantProxyGroups = (groupName: string) => {
  const descendants: string[] = []
  const visited = new Set<string>([groupName])

  const walk = (name: string) => {
    getDirectChildProxyGroups(name).forEach((childGroupName) => {
      if (visited.has(childGroupName)) {
        return
      }

      visited.add(childGroupName)
      descendants.push(childGroupName)
      walk(childGroupName)
    })
  }

  walk(groupName)

  return descendants
}

export const getDescendantProxyNames = (groupName: string) => {
  const descendants: string[] = []
  const visited = new Set<string>([groupName])

  const walk = (name: string) => {
    ;(proxyMap.value[name]?.all ?? []).forEach((memberName) => {
      if (visited.has(memberName)) {
        return
      }

      visited.add(memberName)
      descendants.push(memberName)

      if (proxyMap.value[memberName]?.all?.length) {
        walk(memberName)
      }
    })
  }

  walk(groupName)

  return descendants
}

export const hasSmartGroup = computed(() => {
  return Object.values(proxyMap.value).some(
    (proxy) => proxy.type.toLowerCase() === PROXY_TYPE.Smart,
  )
})
