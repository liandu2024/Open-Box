import { kernelTestUrl } from '@/helper/testUrl'
import { serviceStatus } from '@/composables/kernelService'
import { showNotification } from '@/helper/notification'
import { ACCESS_PASSWORD_REQUIRED_CODE, markServerAuthenticationRequired } from '@/store/auth'
import { autoUpgradeCore, checkUpgradeCore } from '@/store/settings'
import type { Config, DNSQuery, NodeRank, Proxy, ProxyProvider, Rule, RuleProvider } from '@/types'
import axios, { AxiosError } from 'axios'
import { debounce } from 'lodash'
import ReconnectingWebSocket from 'reconnectingwebsocket'
import { computed, ref } from 'vue'

axios.interceptors.request.use((config) => {
  config.baseURL = '/api/controller'
  return config
})

const ignoreNotificationUrls = ['/delay', '/healthcheck', '/weights']

const decodeRequestUrl = (url?: string) => {
  if (!url) return ''

  try {
    return decodeURIComponent(url)
  } catch {
    // 单独的 % 之类的畸形转义会让 decodeURIComponent 抛错,那就原样显示
    return url
  }
}

axios.interceptors.response.use(
  null,
  (
    error: AxiosError<{
      code?: string
      message: string
    }>,
  ) => {
    const responseStatus = error.response?.status ?? error.status
    const responseCode = error.response?.data?.code

    if (responseStatus === 401 && responseCode === ACCESS_PASSWORD_REQUIRED_CODE) {
      markServerAuthenticationRequired()
      return Promise.reject(error)
    }

    // 内核停着的时候,所有 clash API 请求都会失败,一条条弹出来只是噪音。两个信号任一命中就不弹:
    // 1. 面板转发 clash API 连不上内核时回 502(server/index.mjs 的 proxyControllerRequest)——
    //    页面一加载就发的那批请求,这时服务状态还没拉回来,靠这个判断;
    // 2. 共享的服务状态已经说内核停了。
    if (responseStatus === 502 || (serviceStatus.value && !serviceStatus.value.core.running)) {
      return Promise.reject(error)
    }

    if (!ignoreNotificationUrls.some((url) => error.config?.url?.endsWith(url))) {
      const errorMessage = error.response?.data?.message || error.message
      // 请求路径里的组名 / 节点名是 encodeURIComponent 过的,原样弹出来就是一串
      // %E6%96%B0%E5%8A%A0…。解码后再显示,用户才认得出是哪个组出的错。
      const requestUrl = decodeRequestUrl(error.config?.url)

      showNotification({
        key: errorMessage,
        content: `${requestUrl} \n${errorMessage}`,
        type: 'alert-error',
      })
      return Promise.reject(error)
    }

    return error
  },
)

export const version = ref()
export const isCoreUpdateAvailable = ref(false)
export const fetchVersionAPI = () => {
  return axios.get<{ version: string }>('/version')
}
export const isSingBox = computed(() => version.value?.includes('sing-box'))
export const zashboardVersion = ref(__APP_VERSION__)
const UI_RELEASES_API = 'https://api.github.com/repos/liandu2024/AnGe-ClashBoard/releases/latest'

export const fetchBackendVersion = async () => {
  const { data } = await fetchVersionAPI()

  version.value = data?.version || ''

  if (isSingBox.value || !checkUpgradeCore.value) return

  isCoreUpdateAvailable.value = await fetchBackendUpdateAvailableAPI()

  if (isCoreUpdateAvailable.value && autoUpgradeCore.value) {
    upgradeCoreAPI('auto')
  }
}

export const fetchProxiesAPI = () => {
  return axios.get<{ proxies: Record<string, Proxy> }>('/proxies')
}

export const selectProxyAPI = (proxyGroup: string, name: string) => {
  return axios.put(`/proxies/${encodeURIComponent(proxyGroup)}`, { name })
}

export const deleteFixedProxyAPI = (proxyGroup: string) => {
  return axios.delete(`/proxies/${encodeURIComponent(proxyGroup)}`)
}

// 三个延迟测试接口的 url 都先过 kernelTestUrl:内核对 http:// 的测速地址不认(会换成 gstatic 去测)
export const fetchProxyLatencyAPI = (proxyName: string, url: string, timeout: number) => {
  return axios.get<{ delay: number }>(`/proxies/${encodeURIComponent(proxyName)}/delay`, {
    params: {
      url: kernelTestUrl(url),
      timeout,
    },
  })
}

export const fetchProxyProviderLatencyAPI = (
  providerName: string,
  proxyName: string,
  url: string,
  timeout: number,
) => {
  return axios.get<{ delay: number }>(
    `/providers/proxies/${encodeURIComponent(providerName)}/${encodeURIComponent(proxyName)}/healthcheck`,
    {
      params: {
        url: kernelTestUrl(url),
        timeout,
      },
    },
  )
}

export const fetchProxyGroupLatencyAPI = (proxyName: string, url: string, timeout: number) => {
  return axios.get<Record<string, number>>(`/group/${encodeURIComponent(proxyName)}/delay`, {
    params: {
      url: kernelTestUrl(url),
      timeout,
    },
  })
}

export const fetchSmartWeightsAPI = () => {
  return axios.get<{
    message: string
    weights: Record<string, NodeRank[]>
  }>(`/group/weights`)
}

// deprecated
export const fetchSmartGroupWeightsAPI = (proxyName: string) => {
  return axios.get<{
    message: string
    weights: NodeRank[]
  }>(`/group/${encodeURIComponent(proxyName)}/weights`)
}

export const flushSmartGroupWeightsAPI = () => {
  return axios.post(`/cache/smart/flush`)
}

export const fetchProxyProviderAPI = () => {
  return axios.get<{ providers: Record<string, ProxyProvider> }>('/providers/proxies')
}

export const updateProxyProviderAPI = (name: string) => {
  return axios.put(`/providers/proxies/${encodeURIComponent(name)}`)
}

export const proxyProviderHealthCheckAPI = (name: string) => {
  return axios.get<Record<string, number>>(
    `/providers/proxies/${encodeURIComponent(name)}/healthcheck`,
    {
      timeout: 15000,
    },
  )
}

export const fetchRulesAPI = () => {
  return axios.get<{ rules: Rule[] }>('/rules')
}

export const toggleRuleDisabledAPI = (data: Record<number, boolean>) => {
  return axios.patch(`/rules/disable`, data)
}

export const toggleRuleDisabledSingBoxAPI = (uuid: string) => {
  return axios.put(`/rules/${encodeURIComponent(uuid)}`)
}

export const fetchRuleProvidersAPI = () => {
  return axios.get<{ providers: Record<string, RuleProvider> }>('/providers/rules')
}

export const updateRuleProviderAPI = (name: string) => {
  return axios.put(`/providers/rules/${encodeURIComponent(name)}`)
}

export const blockConnectionByIdAPI = (id: string) => {
  return axios.delete(`/connections/smart/${id}`)
}

export const disconnectByIdAPI = (id: string) => {
  return axios.delete(`/connections/${id}`)
}

export const disconnectAllAPI = () => {
  return axios.delete('/connections')
}

export const getConfigsAPI = () => {
  return axios.get<Config>('/configs')
}

export const patchConfigsAPI = (configs: Record<string, string | boolean | object | number>) => {
  return axios.patch('/configs', configs)
}

export const flushFakeIPAPI = () => {
  return axios.post('/cache/fakeip/flush')
}

export const flushDNSCacheAPI = () => {
  return axios.post('/cache/dns/flush')
}

export const reloadConfigsAPI = () => {
  return axios.put('/configs?reload=true', { path: '', payload: '' })
}

export const upgradeUIAPI = () => {
  return axios.post('/upgrade/ui')
}

export const updateGeoDataAPI = () => {
  return axios.post('/configs/geo')
}

export const upgradeCoreAPI = (type: 'release' | 'alpha' | 'auto') => {
  const url = type === 'auto' ? '/upgrade' : `/upgrade?channel=${type}`

  return axios.post(url)
}

export const restartCoreAPI = () => {
  return axios.post('/restart')
}

export const queryDNSAPI = (params: { name: string; type: string }) => {
  return axios.get<DNSQuery>('/dns/query', {
    params,
  })
}

const createWebSocket = <T>(url: string, searchParams?: Record<string, string>) => {
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  const resurl = new URL(`/api/controller-ws/${url}`, currentOrigin)

  resurl.protocol = resurl.protocol === 'https:' ? 'wss:' : 'ws:'

  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      resurl.searchParams.append(key, value)
    })
  }

  const data = ref<T>()
  const websocket = new ReconnectingWebSocket(resurl.toString())

  const close = () => {
    websocket.close()
  }

  const messageHandler = ({ data: message }: { data: string }) => {
    data.value = JSON.parse(message)
  }

  websocket.onmessage = url === 'logs' ? messageHandler : debounce(messageHandler, 100)

  return {
    data,
    close,
  }
}

export const fetchConnectionsAPI = <T>() => {
  return createWebSocket<T>('connections')
}

export const fetchLogsAPI = <T>(params: Record<string, string> = {}) => {
  return createWebSocket<T>('logs', params)
}

export const fetchMemoryAPI = <T>() => {
  return createWebSocket<T>('memory')
}

export const fetchTrafficAPI = <T>() => {
  return createWebSocket<T>('traffic')
}

const CACHE_DURATION = 1000 * 60 * 60

interface CacheEntry<T> {
  timestamp: number
  version: string
  data: T
}

const normalizeVersionLabel = (version: string) => {
  return version.trim().replace(/^v/i, '')
}

const parseVersionParts = (version: string) => {
  return normalizeVersionLabel(version)
    .split('.')
    .map((part) => {
      const match = /^(\d+)/.exec(part.trim())

      return match ? Number.parseInt(match[1], 10) : 0
    })
}

const compareDisplayVersions = (currentVersion: string, nextVersion: string) => {
  const current = parseVersionParts(currentVersion)
  const next = parseVersionParts(nextVersion)
  const length = Math.max(current.length, next.length)

  for (let index = 0; index < length; index++) {
    const currentPart = current[index] ?? 0
    const nextPart = next[index] ?? 0

    if (nextPart !== currentPart) {
      return nextPart - currentPart
    }
  }

  return 0
}

export const getDisplayAppVersion = (versionText: string) => {
  return normalizeVersionLabel(versionText)
}

async function fetchWithLocalCache<T>(url: string, version: string): Promise<T> {
  const cacheKey = 'cache/' + url
  const cacheRaw = localStorage.getItem(cacheKey)

  if (cacheRaw) {
    try {
      const cache: CacheEntry<T> = JSON.parse(cacheRaw)
      const now = Date.now()

      if (now - cache.timestamp < CACHE_DURATION && cache.version === version) {
        return cache.data
      } else {
        localStorage.removeItem(cacheKey)
      }
    } catch (e) {
      console.warn('Failed to parse cache for', url, e)
    }
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)
  }

  const data: T = await response.json()
  const newCache: CacheEntry<T> = {
    timestamp: Date.now(),
    version,
    data,
  }

  localStorage.setItem(cacheKey, JSON.stringify(newCache))
  return data
}

export const fetchIsUIUpdateAvailable = async () => {
  try {
    const { tag_name } = await fetchWithLocalCache<{ tag_name: string }>(
      UI_RELEASES_API,
      zashboardVersion.value,
    )

    return Boolean(tag_name && compareDisplayVersions(zashboardVersion.value, tag_name) < 0)
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return false
    }

    throw error
  }
}

const check = async (url: string, versionNumber: string) => {
  const { assets } = await fetchWithLocalCache<{ assets: { name: string }[] }>(url, versionNumber)
  const alreadyLatest = assets.some(({ name }) => name.includes(versionNumber))

  return !alreadyLatest
}

export const fetchBackendUpdateAvailableAPI = async () => {
  const match = /(alpha-smart|alpha|beta|meta)-?(\w+)/.exec(version.value)

  if (!match) {
    const { tag_name } = await fetchWithLocalCache<{ tag_name: string }>(
      'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest',
      version.value,
    )

    return Boolean(tag_name && !tag_name.endsWith(version.value))
  }

  const channel = match[1],
    versionNumber = match[2]

  if (channel === 'meta')
    return await check(
      'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest',
      versionNumber,
    )
  if (channel === 'alpha')
    return await check(
      'https://api.github.com/repos/MetaCubeX/mihomo/releases/tags/Prerelease-Alpha',
      versionNumber,
    )
  if (channel === 'alpha-smart')
    return await check(
      'https://api.github.com/repos/vernesong/mihomo/releases/tags/Prerelease-Alpha',
      versionNumber,
    )

  return false
}
