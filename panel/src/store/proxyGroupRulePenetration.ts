import { fetchRules } from '@/store/rules'
import { fetchServerApi } from '@/store/auth'
import type { Rule } from '@/types'
import { ref } from 'vue'
import { ruleCacheTotalRules, rules } from './rules'

export type ProxyGroupRulePenetrationFamily = 'all' | 'domain' | 'ip' | 'port' | 'other'
export type ProxyGroupRulePenetrationSortKey = 'type' | 'content' | 'params' | 'raw'
export type ProxyGroupRulePenetrationDialogMode = 'proxy-group' | 'rule-provider'

export type ProxyGroupRulePenetrationEntry = {
  type: string
  family: Exclude<ProxyGroupRulePenetrationFamily, 'all'>
  content: string
  params: string
  raw: string
  source: string
  line: number | null
}

const PAGE_SIZE = 100
type ProxyGroupRulePenetrationResponse = {
  cacheKey: string
  totalRules: number
  totalMatched: number
  counts: {
    all: number
    domain: number
    ip: number
    port: number
  }
  items: ProxyGroupRulePenetrationEntry[]
  missingProviders: string[]
  page: number
  pageSize: number
  hasMore: boolean
}

export const proxyGroupRulePenetrationDialogVisible = ref(false)
export const proxyGroupRulePenetrationDialogMode = ref<ProxyGroupRulePenetrationDialogMode>('proxy-group')
export const proxyGroupRulePenetrationDialogGroupName = ref('')
export const proxyGroupRulePenetrationDialogLoading = ref(false)
export const proxyGroupRulePenetrationDialogLoadingMore = ref(false)
export const proxyGroupRulePenetrationDialogError = ref('')
export const proxyGroupRulePenetrationDialogEntries = ref<ProxyGroupRulePenetrationEntry[]>([])
export const proxyGroupRulePenetrationDialogMissingProviders = ref<string[]>([])
export const proxyGroupRulePenetrationDialogSearch = ref('')
export const proxyGroupRulePenetrationDialogTab = ref<Exclude<ProxyGroupRulePenetrationFamily, 'other'>>('all')
export const proxyGroupRulePenetrationDialogSortKey = ref<ProxyGroupRulePenetrationSortKey | null>(null)
export const proxyGroupRulePenetrationDialogSortDirection = ref<'asc' | 'desc'>('asc')
export const proxyGroupRulePenetrationDialogCounts = ref({
  all: 0,
  domain: 0,
  ip: 0,
  port: 0,
})
export const proxyGroupRulePenetrationDialogTotalRules = ref(0)
export const proxyGroupRulePenetrationDialogTotalMatched = ref(0)
export const proxyGroupRulePenetrationDialogPage = ref(1)
export const proxyGroupRulePenetrationDialogHasMore = ref(false)
export const proxyGroupRulePenetrationDialogCacheKey = ref('')

let latestRequestId = 0

const serializeRules = (items: Rule[]) => {
  return items.map((rule) => ({
    type: rule.type,
    payload: rule.payload,
    proxy: rule.proxy,
    index: rule.index,
    disabled: rule.disabled,
    extra: rule.extra
      ? {
          disabled: rule.extra.disabled,
        }
      : undefined,
  }))
}

const resetDialogState = () => {
  proxyGroupRulePenetrationDialogEntries.value = []
  proxyGroupRulePenetrationDialogMissingProviders.value = []
  proxyGroupRulePenetrationDialogError.value = ''
  proxyGroupRulePenetrationDialogCounts.value = {
    all: 0,
    domain: 0,
    ip: 0,
    port: 0,
  }
  proxyGroupRulePenetrationDialogTotalMatched.value = 0
  proxyGroupRulePenetrationDialogTotalRules.value = 0
  proxyGroupRulePenetrationDialogPage.value = 1
  proxyGroupRulePenetrationDialogHasMore.value = false
  proxyGroupRulePenetrationDialogCacheKey.value = ''
}

const buildProxyGroupRequestBody = (groupName: string, page: number) => {
  const body: Record<string, unknown> = {
    groupName,
    page,
    pageSize: PAGE_SIZE,
    tab: proxyGroupRulePenetrationDialogTab.value,
    search: proxyGroupRulePenetrationDialogSearch.value.trim(),
    sortKey: proxyGroupRulePenetrationDialogSortKey.value,
    sortDirection: proxyGroupRulePenetrationDialogSortDirection.value,
  }

  if (proxyGroupRulePenetrationDialogCacheKey.value) {
    body.cacheKey = proxyGroupRulePenetrationDialogCacheKey.value
  } else {
    body.rules = serializeRules(rules.value)
  }

  return body
}

const buildRuleProviderRequestBody = (providerName: string, page: number) => {
  return {
    providerName,
    page,
    pageSize: PAGE_SIZE,
    tab: proxyGroupRulePenetrationDialogTab.value,
    search: proxyGroupRulePenetrationDialogSearch.value.trim(),
    sortKey: proxyGroupRulePenetrationDialogSortKey.value,
    sortDirection: proxyGroupRulePenetrationDialogSortDirection.value,
  }
}

const requestProxyGroupRulePenetration = async (groupName: string, page: number) => {
  const requestBody = buildProxyGroupRequestBody(groupName, page)

  let response = await fetchServerApi('/api/proxy-group-rule-penetration', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (response.status === 410 && proxyGroupRulePenetrationDialogCacheKey.value) {
    proxyGroupRulePenetrationDialogCacheKey.value = ''

    response = await fetchServerApi('/api/proxy-group-rule-penetration', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildProxyGroupRequestBody(groupName, page)),
    })
  }

  return response
}

const requestRuleProviderPenetration = async (providerName: string, page: number) => {
  return await fetchServerApi('/api/rule-provider-penetration', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(buildRuleProviderRequestBody(providerName, page)),
  })
}

export const loadProxyGroupRulePenetration = async (
  groupName = proxyGroupRulePenetrationDialogGroupName.value,
  options?: { append?: boolean },
) => {
  if (!groupName) {
    resetDialogState()
    return
  }

  const append = options?.append === true
  const targetPage = append ? proxyGroupRulePenetrationDialogPage.value + 1 : 1
  const requestId = ++latestRequestId

  if (append) {
    if (
      proxyGroupRulePenetrationDialogLoading.value ||
      proxyGroupRulePenetrationDialogLoadingMore.value ||
      !proxyGroupRulePenetrationDialogHasMore.value
    ) {
      return
    }

    proxyGroupRulePenetrationDialogLoadingMore.value = true
  } else {
    proxyGroupRulePenetrationDialogLoading.value = true
    proxyGroupRulePenetrationDialogError.value = ''
  }

  try {
    if (proxyGroupRulePenetrationDialogMode.value === 'proxy-group' && rules.value.length === 0) {
      await fetchRules()
    }

    const response =
      proxyGroupRulePenetrationDialogMode.value === 'proxy-group'
        ? await requestProxyGroupRulePenetration(groupName, targetPage)
        : await requestRuleProviderPenetration(groupName, targetPage)

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { message?: string } | null
      throw new Error(errorBody?.message || `Failed to load rule penetration: ${response.status}`)
    }

    const data = (await response.json()) as ProxyGroupRulePenetrationResponse

    if (requestId !== latestRequestId) {
      return
    }

    proxyGroupRulePenetrationDialogCacheKey.value =
      proxyGroupRulePenetrationDialogMode.value === 'proxy-group'
        ? data.cacheKey || proxyGroupRulePenetrationDialogCacheKey.value
        : ''
    proxyGroupRulePenetrationDialogCounts.value = data.counts
    proxyGroupRulePenetrationDialogTotalRules.value = data.totalRules
    proxyGroupRulePenetrationDialogTotalMatched.value = data.totalMatched
    proxyGroupRulePenetrationDialogMissingProviders.value = data.missingProviders
    proxyGroupRulePenetrationDialogPage.value = data.page
    proxyGroupRulePenetrationDialogHasMore.value = data.hasMore
    proxyGroupRulePenetrationDialogEntries.value = append
      ? [...proxyGroupRulePenetrationDialogEntries.value, ...data.items]
      : data.items
  } catch (error) {
    if (requestId !== latestRequestId) {
      return
    }

    if (!append) {
      proxyGroupRulePenetrationDialogEntries.value = []
      proxyGroupRulePenetrationDialogMissingProviders.value = []
      proxyGroupRulePenetrationDialogCounts.value = {
        all: 0,
        domain: 0,
        ip: 0,
        port: 0,
      }
      proxyGroupRulePenetrationDialogTotalMatched.value = 0
      proxyGroupRulePenetrationDialogTotalRules.value = 0
      proxyGroupRulePenetrationDialogHasMore.value = false
      proxyGroupRulePenetrationDialogPage.value = 1
    }

    proxyGroupRulePenetrationDialogError.value =
      error instanceof Error ? error.message : String(error)
  } finally {
    if (requestId === latestRequestId) {
      proxyGroupRulePenetrationDialogLoading.value = false
      proxyGroupRulePenetrationDialogLoadingMore.value = false
    }
  }
}

export const openProxyGroupRulePenetrationDialog = async (groupName: string) => {
  proxyGroupRulePenetrationDialogMode.value = 'proxy-group'
  proxyGroupRulePenetrationDialogGroupName.value = groupName
  proxyGroupRulePenetrationDialogSearch.value = ''
  proxyGroupRulePenetrationDialogTab.value = 'all'
  proxyGroupRulePenetrationDialogSortKey.value = null
  proxyGroupRulePenetrationDialogSortDirection.value = 'asc'
  resetDialogState()
  proxyGroupRulePenetrationDialogVisible.value = true

  await loadProxyGroupRulePenetration(groupName)
}

export const openRuleProviderPenetrationDialog = async (providerName: string) => {
  proxyGroupRulePenetrationDialogMode.value = 'rule-provider'
  proxyGroupRulePenetrationDialogGroupName.value = providerName
  proxyGroupRulePenetrationDialogSearch.value = ''
  proxyGroupRulePenetrationDialogTab.value = 'all'
  proxyGroupRulePenetrationDialogSortKey.value = null
  proxyGroupRulePenetrationDialogSortDirection.value = 'asc'
  resetDialogState()
  proxyGroupRulePenetrationDialogVisible.value = true

  await loadProxyGroupRulePenetration(providerName)
}

export const isProxyGroupRuleCacheEmpty = () => {
  return ruleCacheTotalRules.value <= 0
}
