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
import { failoverDisplayName, failoverMembersOf, isFailoverGroup, isFailoverInternalTag } from '@/store/openboxFailover'
import { iconUrlFor } from '@/helper/iconUrl'
import {
  loadOpenboxNodeGroups,
  loadOpenboxSiteSets,
  managedOutbounds,
  nodeProviders,
  siteSetIcons,
  siteSetIconScales,
} from '@/store/openboxSiteSets'
import {
  GLOBAL,
  IPV6_TEST_URL,
  NOT_CONNECTED,
  PROXY_TAB_TYPE,
  PROXY_TYPE,
  DIRECT_TEST_URL,
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
  directTestUrl,
} from './settings'
import { initSmartWeights } from './smart'
import { loadLatencyHistory, reportLatencyTimeouts, syncLatencyHistory } from '@/store/latencyHistory'

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

let openboxMetaPromise: Promise<unknown> | null = null
const ensureOpenboxMeta = () => {
  if (siteSetIcons.value.size && managedOutbounds.value.length) return Promise.resolve()
  if (!openboxMetaPromise) {
    openboxMetaPromise = Promise.allSettled([loadOpenboxSiteSets(), loadOpenboxNodeGroups()]).finally(() => {
      openboxMetaPromise = null
    })
  }
  return openboxMetaPromise
}

export const fetchProxies = async () => {
  const nowTime = Date.now()

  fetchTime = nowTime

  // 站点集图标 / 节点管理图标 / 节点归属这几份 Open-Box 自己的数据要先到,下面注入图标
  // 才有东西可注入。代理页、订阅页会自己刷新它们;规则页、连接页这类只调 fetchProxies 的
  // 页面靠这里兜底加载一次,否则那些页面上的站点集/组就没有图标。
  await ensureOpenboxMeta()
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
  // 延迟时间线由服务端攒(见 store/latencyHistory.ts),拉节点数据时顺带拉一份
  void loadLatencyHistory()
  // 故障转移的内部子组(__fo:…)是内核出站但不是用户组:不开卡片、不进组列表
  proxyGroupList.value = Object.values(proxyData.proxies)
    .filter((proxy) => proxy.all?.length && proxy.name !== GLOBAL && !isFailoverInternalTag(proxy.name))
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

  // 「节点管理」里的条目(节点组 + 内置的直连/拒绝)带上自己的图标——用户在那边挑的
  // 那个。用户在面板设置里另配过图标(iconReflect)的优先,不覆盖。
  // 内核的 clash_api 未必把 direct/block 出站列出来;没列的话补一条,站点集/组的成员
  // 列表里它才显示得出来(否则只剩一个光秃秃的名字)。
  // 站点集在「分流与策略」里挑的图标:策略卡片标题左边那个大图标就是它
  // 站点集图标覆盖 zashboard 残留的 iconReflect 映射:「自定义图标」那套设置已从面板去掉,
  // 浏览器里留着的旧映射不该再把站点集自己挑的图标顶掉。解析不出来的码退回彩色地球。
  for (const [name, code] of siteSetIcons.value) {
    const entry = proxyMap.value[name]
    if (!entry) continue
    const url = iconUrlFor(code) || iconUrlFor('globe:earth-meridians')
    if (url) entry.icon = url
    entry.iconScale = siteSetIconScales.value.get(name) || 0
  }

  for (const item of managedOutbounds.value) {
    if (item.enabled === false) continue
    if (!proxyMap.value[item.name]) {
      if (!item.kind) continue
      proxyMap.value[item.name] = {
        name: item.name,
        type: item.kind === 'direct' ? 'Direct' : 'Block',
        udp: true,
        history: [],
      } as unknown as Proxy
    }
    if (item.icon) {
      const url = iconUrlFor(item.icon)
      if (url) proxyMap.value[item.name].icon = url
    }
    proxyMap.value[item.name].iconScale = item.iconScale || 0
    // 故障转移的内部子组(__fo:组id:页签id)带页签自己的图标,没挑就继承父组的:链路和穿透里显示的是页签
    if (item.type === 'failover') {
      for (const lane of item.lanes ?? []) {
        const head = `__fo:${item.id}:${lane.id}`
        const code = lane.icon || item.icon
        for (const key of Object.keys(proxyMap.value)) {
          if (key !== head && !(key.startsWith(head) && /^~+$/.test(key.slice(head.length)))) continue
          const url = code ? iconUrlFor(code) : ''
          if (url) proxyMap.value[key].icon = url
          proxyMap.value[key].iconScale = item.iconScale || 0
        }
      }
    }
  }

  // 节点标上来自哪条订阅:「节点根据提供商分组」按 provider-name 分段,内核不给,这里补
  for (const [tag, provider] of nodeProviders.value) {
    const entry = proxyMap.value[tag]
    if (entry && !entry['provider-name']) entry['provider-name'] = provider
  }

  if (smartGroups.length > 0) {
    initSmartWeights(smartGroups)
  }

  repairStaleUrlTestGroups()
}

// 自动择优组"当前选中的线路已经失效":内核在经这个组拨号失败时,只把该节点的延迟记录删掉,
// 并不重新择优(sing-box protocol/group/urltest.go 的 DialContext),要等这个组自己的定时
// 检查(默认 3 分钟)才切走;而组闲置久了连定时检查都会停。所以"选中的节点没有延迟记录"
// 就是这条线路已经不通、而且没人来修的信号。
export const isUrlTestGroupStale = (groupName: string) => {
  const group = proxyMap.value[groupName]

  if (!group || group.type?.toLowerCase() !== PROXY_TYPE.URLTest || !group.now) {
    return false
  }

  return getLatencyByName(group.now) === NOT_CONNECTED
}

// 看到这种组就替它强制重测一次(/group/<name>/delay):内核测完会立刻重新择优,
// 用户不用自己去点闪电。超时是即时故障信号,不应等完整的 url-test interval;
// 短暂冷却只用于避免整组都不可用时每次刷新都重复发起整组测速。
const staleRepairAt = new Map<string, number>()
const STALE_REPAIR_INTERVAL = 15 * 1000

const repairStaleUrlTestGroups = () => {
  const now = Date.now()

  for (const groupName of proxyGroupList.value) {
    if (!isUrlTestGroupStale(groupName)) {
      // 新节点已经有结果,允许下一次真正失效时立即触发补测。
      staleRepairAt.delete(groupName)
      continue
    }
    // 同一批全失败时最多每 15 秒重试一次;一旦切到新节点并恢复,上面的分支会清掉时间戳。
    if (now - (staleRepairAt.get(groupName) ?? 0) < STALE_REPAIR_INTERVAL) {
      continue
    }
    staleRepairAt.set(groupName, now)
    // sing-box 把超时节点的 history 删除,服务端看不到正文;先让服务端按内核启动时间
    // 判定这次是否真的是超时(重启造成的整批清空不会误记),再让内核重测并择优。后续
    // syncLatencyHistory + fetchProxies 会读到新节点的延迟,悬浮框顶部自然变成「新节点
    // + 新延迟」,紧接着旧节点「超时」。
    void syncLatencyHistory()
      .then(() => fetchProxyGroupLatencyAPI(
        groupName,
        getTestUrl(groupName),
        Math.max(5000, speedtestTimeout.value),
      ))
      .then(() => syncLatencyHistory())
      .then(() => fetchProxies())
      .catch(() => {})
  }
}

// 这个组的节点卡片 / 圆点能不能点了切换:只有 selector(而且不是故障转移组)由用户手动选;自动择优组由内核按
// 测速定、故障转移组(含它的内部页签子组)由面板按检测结果切,卡片和圆点不响应点击,也就没有「不能手动指定」的提示
export const isManualSelectable = (groupName?: string) => {
  if (!groupName) return false
  const g = proxyMap.value[groupName]
  if (!g || String(g.type || '').toLowerCase() !== 'selector') return false
  if (isFailoverInternalTag(groupName)) return false
  return !managedOutbounds.value.some((m) => m.name === groupName && m.type === 'failover')
}

export const handlerProxySelect = async (proxyGroupName: string, proxyName: string) => {
  const proxyGroup = proxyMap.value[proxyGroupName]

  if (proxyGroup.type.toLowerCase() === PROXY_TYPE.LoadBalance) return
  // 内核只允许对 selector 下发选择,对自动择优组会直接回 "Must be a Selector"。
  // 与其把那句英文连着 encode 过的请求路径弹给用户,不如在这里就说清楚:这个组的节点
  // 是按测速自己选的,想换就点它的闪电重测一次(见 ProxyNodeCard 的闪电)。
  if (proxyGroup.type.toLowerCase() === PROXY_TYPE.URLTest) {
    showNotification({
      content: 'urlTestManualSelectTip',
      // 故障转移的内部子组显示成页签名,不露 __fo: 技术 tag
      params: { name: failoverDisplayName(proxyGroupName) },
      type: 'alert-info',
    })
    return
  }
  // 故障转移组:底层虽然是 selector,但主备由面板服务端按检测结果切,手动点了下一轮也会被纠回去
  if (managedOutbounds.value.some((g) => g.name === proxyGroupName && g.type === 'failover')) {
    showNotification({
      content: 'failoverManualSelectTip',
      params: { name: proxyGroupName },
      type: 'alert-info',
    })
    return
  }
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

  // 内置的直连/拒绝不按普通节点测:
  //   拒绝 —— 永远连不上,测它只会得到一个"失败"的提示,没有信息量,直接给 0
  //   直连 —— 换用直连专用的测速地址(面板设置里可改)。默认地址是 Google 的域名,从国内
  //          直连去测量出来的是"直连到 Google 有多远",不是直连线路本身的快慢
  const managed = managedOutbounds.value.find((g) => g.name === proxyName && g.kind)
  const type = proxyMap.value[proxyName]?.type?.toLowerCase()
  if (managed?.kind === 'block' || type === 'block') {
    return Promise.resolve({ status: 200, data: { delay: 0 } } as Awaited<ReturnType<typeof fetchProxyLatencyAPI>>)
  }
  if (managed?.kind === 'direct' || type === 'direct') {
    return fetchProxyLatencyAPI(proxyName, directTestUrl.value || DIRECT_TEST_URL, timeout)
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

// 提示里的组名:故障转移的内部页签子组显示成页签名,不露 __fo: 技术 tag
const getNameForNotification = (name: string, url: string) => {
  const shown = failoverDisplayName(name)
  if (independentLatencyTest.value) {
    return `${shown}\n@${url}`
  }

  return shown
}

export const proxyLatencyTest = async (
  proxyName: string,
  url = speedtestUrlWithDefault.value,
  timeout = speedtestTimeout.value,
) => {
  const res = await latencyTestForSingle(proxyName, url, timeout)
  await fetchProxies()

  if (res.status !== 200) {
    // 超时也是一次结果:sing-box 超时会把这个节点的 history 直接删掉(不是记 0),服务端读内核
    // 什么都记不到——面板自己知道是超时,报上去(灰点、写「超时」)
    void reportLatencyTimeouts([getNowProxyNodeName(proxyName)])
  } else {
    void syncLatencyHistory()
  }

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
  // 超时要自己报给服务端(内核那边不会有记录);成功的等这一批测完 sync 一次
  if (delay === NOT_CONNECTED) void reportLatencyTimeouts([getNowProxyNodeName(proxyName)], now.toISOString())
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
  // 这一批测完让服务端读一次内核,成功的结果进时间线
  void syncLatencyHistory()
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

// 故障转移组的整组测速:内核里它是 selector,按 selector 逐个成员测只会测到每个页签当前选中的那一个节点,
// 兜底拒绝还会算一次超时。这里按页签来——多节点页签走内核的组测速(全员重测 + 组内重选),单节点页签测那个
// 节点,拒绝不测;最后按各页签里的全部节点报一条统一的「N 成功,M 超时」
const failoverGroupLatencyTest = async (proxyGroupName: string) => {
  const url = getTestUrl(proxyGroupName)
  const timeout = Math.max(5000, speedtestTimeout.value)
  const members = failoverMembersOf(proxyGroupName, proxyMap.value[proxyGroupName]?.all ?? [])
  const nodes = new Set<string>()
  await Promise.allSettled(
    members.map((member) =>
      limiter(async () => {
        const p = proxyMap.value[member]
        if (p?.type?.toLowerCase() === PROXY_TYPE.URLTest) {
          for (const n of p.all ?? []) nodes.add(n)
          await fetchProxyGroupLatencyAPI(member, url, timeout)
          return
        }
        nodes.add(member)
        const res = await latencyTestForSingle(member, url, timeout)
        setHistory(member, res.status === 200 ? res.data.delay : NOT_CONNECTED)
      }),
    ),
  )
  await fetchProxies()
  const all = [...nodes]
  const failedNames = all.filter((name) => getLatencyByName(name) === NOT_CONNECTED)
  void reportLatencyTimeouts(failedNames).then(() => syncLatencyHistory())
  const testFailed = failedNames.length
  showNotification({
    content: 'testFinishedResultTip',
    key: TIP_KEY + proxyGroupName,
    params: {
      name: getNameForNotification(proxyGroupName, url),
      total: all.length.toString(),
      success: `${all.length - testFailed}`,
      failed: `${testFailed}`,
    },
    type: testFailed ? 'alert-warning' : 'alert-success',
    timeout: 3000,
  })
}

export const proxyGroupLatencyTest = async (proxyGroupName: string) => {
  const proxyNode = proxyMap.value[proxyGroupName]
  const all = proxyNode.all ?? []
  const url = getTestUrl(proxyGroupName)

  if (isFailoverGroup(proxyGroupName)) return failoverGroupLatencyTest(proxyGroupName)

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
  const failedNames = all.filter((name) => getLatencyByName(name, proxyGroupName) === NOT_CONNECTED)
  // 整组测完还没有结果的就是这次超时的成员(内核超时会删掉它的 history),报给服务端;成功的让服务端读一次内核
  void reportLatencyTimeouts(failedNames.map((name) => getNowProxyNodeName(name))).then(() => syncLatencyHistory())
  const testFailed = failedNames.length

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
