import { fetchRuleProvidersAPI, fetchRulesAPI } from '@/api'
import { RULE_TAB_TYPE } from '@/constant'
import { isProxyRuleEnabled, isRuleSetProxyRule } from '@/helper/proxyDomainGroups'
import { fetchServerApi } from '@/store/auth'
import type { Rule, RuleProvider } from '@/types'
import { useStorage } from '@vueuse/core'
import { computed, ref } from 'vue'

export type RuleRefreshPhase = 'idle' | 'provider' | 'cache'

export type RuleRefreshState = {
  runId: number
  isRefreshing: boolean
  scope: 'all' | 'provider'
  providerName: string
  phase: RuleRefreshPhase
  totalProviders: number
  updatedProviders: number
  totalRules: number
  errors: number
  cancelled: boolean
  completed: boolean
  lastError: string
  completedAt: number
  updatedAt: number
}

const createDefaultRuleRefreshState = (): RuleRefreshState => ({
  runId: 0,
  isRefreshing: false,
  scope: 'all',
  providerName: '',
  phase: 'idle',
  totalProviders: 0,
  updatedProviders: 0,
  totalRules: 0,
  errors: 0,
  cancelled: false,
  completed: false,
  lastError: '',
  completedAt: 0,
  updatedAt: 0,
})

export const rulesFilter = ref('')
export const rulesTabShow = useStorage<RULE_TAB_TYPE>('cache/rules-tab-show', RULE_TAB_TYPE.RULES)

export const rules = ref<Rule[]>([])
export const ruleProviderList = ref<RuleProvider[]>([])
export const ruleCacheTotalRules = ref(0)
export const ruleProviderLocalCountMap = ref<Record<string, number>>({})
export const ruleProviderSourceUrlMap = ref<Record<string, string>>({})
export const ruleProviderOrderList = ref<string[]>([])
export const ruleCacheRefreshCount = ref(0)
export const isRuleCacheUpdating = ref(false)
export const ruleRefreshState = ref<RuleRefreshState>(createDefaultRuleRefreshState())
export const isRuleLookupLoading = ref(false)
export const ruleLookupError = ref('')
export const ruleLookupResults = ref<
  {
    providerName: string
    behavior: string
    format: string
    url: string
    totalRules: number
    matches: {
      line: number
      value: string
      mode: string
      raw: string
    }[]
    linkedRules: Rule[]
  }[]
>([])
export const ruleLookupDirectRules = ref<Rule[]>([])
export const ruleLookupUnsupported = ref<
  {
    name: string
    kind: string
    behavior: string
    format: string
    url: string
    status: string
  }[]
>([])
export const ruleLookupLiveErrors = ref<
  {
    name: string
    url: string
    message: string
  }[]
>([])
let latestRuleLookupRequestId = 0
export const isRuleLookupQuery = computed(() => {
  const value = rulesFilter.value.trim()

  return value !== '' && !value.includes(' ') && !value.includes('|')
})

export const renderRules = computed(() => {
  const rulesFilterValue = rulesFilter.value.split(' ').map((f) => f.toLowerCase().trim())

  if (rulesFilter.value === '') {
    return rules.value
  }

  return rules.value.filter((rule) => {
    return rulesFilterValue.every((f) =>
      [rule.type.toLowerCase(), rule.payload.toLowerCase(), rule.proxy.toLowerCase()].some((i) =>
        i.includes(f),
      ),
    )
  })
})

export const renderRulesProvider = computed(() => {
  const rulesFilterValue = rulesFilter.value.split(' ').map((f) => f.toLowerCase().trim())

  if (rulesFilter.value === '') {
    return visibleRuleProviderList.value
  }

  return visibleRuleProviderList.value.filter((ruleProvider) => {
    return rulesFilterValue.every((f) =>
      [
        ruleProvider.name.toLowerCase(),
        ruleProvider.behavior.toLowerCase(),
        ruleProvider.vehicleType.toLowerCase(),
      ].some((i) => i.includes(f)),
    )
  })
})

export const referencedRuleProviderNames = computed(() => {
  const seen = new Set<string>()
  const names: string[] = []

  rules.value.forEach((rule) => {
    if (!isProxyRuleEnabled(rule) || !isRuleSetProxyRule(rule)) {
      return
    }

    const providerName = String(rule.payload || '').trim()

    if (!providerName || seen.has(providerName)) {
      return
    }

    seen.add(providerName)
    names.push(providerName)
  })

  return names
})

export const referencedRuleProviderNameSet = computed(() => {
  return new Set(referencedRuleProviderNames.value)
})

export const hasReferencedRuleProviders = computed(() => {
  return referencedRuleProviderNames.value.length > 0
})

export const referencedRuleProviderOrderIndexMap = computed(() => {
  return new Map(referencedRuleProviderNames.value.map((name, index) => [name, index]))
})

export const ruleProviderOrderIndexMap = computed(() => {
  return new Map(ruleProviderOrderList.value.map((name, index) => [name, index]))
})

export const visibleRuleProviderList = computed(() => {
  if (!hasReferencedRuleProviders.value) {
    return []
  }

  return ruleProviderList.value
    .filter((provider) => {
      return referencedRuleProviderNameSet.value.has(provider.name)
    })
    .sort((left, right) => {
      const leftReferencedOrder = referencedRuleProviderOrderIndexMap.value.get(left.name)
      const rightReferencedOrder = referencedRuleProviderOrderIndexMap.value.get(right.name)

      if (leftReferencedOrder !== undefined || rightReferencedOrder !== undefined) {
        return (leftReferencedOrder ?? Number.MAX_SAFE_INTEGER) - (rightReferencedOrder ?? Number.MAX_SAFE_INTEGER)
      }

      const leftOrder = ruleProviderOrderIndexMap.value.get(left.name)
      const rightOrder = ruleProviderOrderIndexMap.value.get(right.name)

      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER)
      }

      return 0
    })
})

const isRuleEnabled = (rule: Rule) => {
  if (rule.extra) {
    return !rule.extra.disabled
  }

  return !rule.disabled
}

export const ruleLookupFallbackRule = computed(() => {
  const enabledRules = rules.value.filter(isRuleEnabled)

  for (let index = enabledRules.length - 1; index >= 0; index--) {
    const rule = enabledRules[index]
    const normalizedType = rule.type.toLowerCase()

    if (normalizedType === 'match' || normalizedType === 'final') {
      return rule
    }
  }

  return null
})

export const isRuleRefreshRunning = computed(() => {
  return ruleRefreshState.value.isRefreshing
})

export const ruleRefreshDisplayText = computed(() => {
  if (ruleRefreshState.value.scope === 'provider' && ruleRefreshState.value.isRefreshing) {
    return ''
  }

  if (ruleRefreshState.value.isRefreshing && ruleRefreshState.value.phase === 'provider') {
    if (!ruleRefreshState.value.totalProviders) {
      return ''
    }

    return `${ruleRefreshState.value.updatedProviders}/${ruleRefreshState.value.totalProviders}`
  }

  if (ruleRefreshState.value.isRefreshing && ruleRefreshState.value.phase === 'cache') {
    return `${ruleCacheRefreshCount.value || 0}`
  }

  if (ruleCacheTotalRules.value > 0) {
    return `${ruleCacheTotalRules.value}`
  }

  return ''
})

export const fetchRules = async () => {
  const { data: ruleData } = await fetchRulesAPI()
  const { data: providerData } = await fetchRuleProvidersAPI()

  rules.value = ruleData.rules.map((rule) => {
    const proxy = rule.proxy
    const proxyName = proxy.startsWith('route(') ? proxy.substring(6, proxy.length - 1) : proxy

    return {
      ...rule,
      proxy: proxyName,
    }
  })
  ruleProviderList.value = Object.values(providerData.providers)
}

export const fetchRuleProviders = async () => {
  const { data: providerData } = await fetchRuleProvidersAPI()
  ruleProviderList.value = Object.values(providerData.providers)
}

export const updateRuleProviderCache = async () => {
  const response = await fetchServerApi('/api/rule-provider-cache/update', {
    method: 'POST',
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(errorBody?.message || `Failed to update rule cache: ${response.status}`)
  }

  return (await response.json()) as {
    ok: boolean
    totalProviders: number
    updatedCount: number
    unsupportedCount: number
    totalRules: number
    providerCounts: Record<string, number>
    providerUrls: Record<string, string>
    providerOrder: string[]
    progressRules: number
    cancelled: boolean
    errors: { name: string; url: string; message: string }[]
  }
}

export const cancelRuleProviderCacheUpdate = async () => {
  const response = await fetchServerApi('/api/rule-provider-cache/cancel', {
    method: 'POST',
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(errorBody?.message || `Failed to cancel rule cache update: ${response.status}`)
  }

  return (await response.json()) as {
    ok: boolean
  }
}

export const startBackgroundRuleRefresh = async (
  providerName = '',
  providerNames?: string[],
  referencedOnly = false,
) => {
  const response = await fetchServerApi('/api/rule-refresh/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      providerName,
      providerNames,
      referencedOnly,
    }),
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(errorBody?.message || `Failed to start background rule refresh: ${response.status}`)
  }

  return (await response.json()) as {
    ok: boolean
    started: boolean
    providerName: string
    totalRules: number
    providerCounts: Record<string, number>
    providerUrls: Record<string, string>
    providerOrder: string[]
    progress: {
      isUpdating: boolean
      totalProviders: number
      updatedProviders: number
      totalRules: number
      errors: number
      unsupportedCount: number
      cancelled: boolean
      completed: boolean
    }
    refresh: RuleRefreshState
  }
}

export const cancelBackgroundRuleRefresh = async () => {
  const response = await fetchServerApi('/api/rule-refresh/cancel', {
    method: 'POST',
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(errorBody?.message || `Failed to cancel background rule refresh: ${response.status}`)
  }

  return (await response.json()) as {
    ok: boolean
    providerName: string
    totalRules: number
    providerCounts: Record<string, number>
    providerUrls: Record<string, string>
    providerOrder: string[]
    progress: {
      isUpdating: boolean
      totalProviders: number
      updatedProviders: number
      totalRules: number
      errors: number
      unsupportedCount: number
      cancelled: boolean
      completed: boolean
    }
    refresh: RuleRefreshState
  }
}

export const fetchRuleProviderCacheStats = async () => {
  const response = await fetchServerApi('/api/rule-provider-cache/stats')

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(errorBody?.message || `Failed to fetch rule cache stats: ${response.status}`)
  }

  return (await response.json()) as {
    totalRules: number
    providerCounts: Record<string, number>
    providerUrls: Record<string, string>
    providerOrder: string[]
    progress: {
      isUpdating: boolean
      totalProviders: number
      updatedProviders: number
      totalRules: number
      errors: number
      unsupportedCount: number
      cancelled: boolean
      completed: boolean
    }
    refresh: RuleRefreshState
  }
}

export const applyRuleProviderCacheStats = (stats: {
  totalRules: number
  providerCounts?: Record<string, number>
  providerUrls?: Record<string, string>
  providerOrder?: string[]
  progress?: {
    isUpdating: boolean
    totalProviders: number
    updatedProviders: number
    totalRules: number
    errors: number
    unsupportedCount: number
    cancelled: boolean
    completed: boolean
  }
  refresh?: Partial<RuleRefreshState>
}) => {
  ruleCacheTotalRules.value = stats.totalRules
  ruleProviderLocalCountMap.value = stats.providerCounts || {}
  ruleProviderSourceUrlMap.value = stats.providerUrls || {}
  ruleProviderOrderList.value = stats.providerOrder || []
  ruleRefreshState.value = {
    ...createDefaultRuleRefreshState(),
    ...ruleRefreshState.value,
    ...(stats.refresh || {}),
    totalRules:
      stats.refresh?.totalRules !== undefined ? stats.refresh.totalRules : stats.totalRules,
  }

  if (stats.progress?.isUpdating) {
    isRuleCacheUpdating.value = true
    ruleCacheRefreshCount.value = stats.progress.totalRules || 0
    return
  }

  if (isRuleCacheUpdating.value) {
    ruleCacheRefreshCount.value = 0
  }

  isRuleCacheUpdating.value = false
}

export const searchRuleByQuery = async () => {
  const requestId = ++latestRuleLookupRequestId

  if (!isRuleLookupQuery.value) {
    ruleLookupResults.value = []
    ruleLookupDirectRules.value = []
    ruleLookupUnsupported.value = []
    ruleLookupLiveErrors.value = []
    ruleLookupError.value = ''
    isRuleLookupLoading.value = false
    return
  }

  const query = rulesFilter.value.trim()

  if (!query) {
    ruleLookupResults.value = []
    ruleLookupDirectRules.value = []
    ruleLookupUnsupported.value = []
    ruleLookupLiveErrors.value = []
    ruleLookupError.value = ''
    isRuleLookupLoading.value = false
    return
  }

  isRuleLookupLoading.value = true
  ruleLookupError.value = ''

  try {
    const response = await fetchServerApi('/api/rule-provider-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        rules: rules.value.map((rule) => ({
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
        })),
      }),
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { message?: string } | null
      throw new Error(errorBody?.message || `Failed to search rule cache: ${response.status}`)
    }

    const data = (await response.json()) as {
      matches: {
        name: string
        behavior: string
        format: string
        url: string
        totalRules: number
        matches: {
          line: number
          value: string
          mode: string
          raw: string
        }[]
      }[]
      directRuleIndexes: number[]
      unsupported: {
        name: string
        kind: string
        behavior: string
        format: string
        url: string
        status: string
      }[]
      errors: {
        name: string
        url: string
        message: string
      }[]
    }

    if (requestId !== latestRuleLookupRequestId || rulesFilter.value.trim() !== query) {
      return
    }

    ruleLookupResults.value = data.matches
      .map((item) => ({
        providerName: item.name,
        behavior: item.behavior,
        format: item.format,
        url: item.url,
        totalRules: item.totalRules,
        matches: item.matches,
        linkedRules: rules.value.filter(
          (rule) => rule.type === 'RuleSet' && rule.payload === item.name,
        ),
      }))
      .filter((item) => item.linkedRules.length > 0)
      .sort((prev, next) => {
        const prevIndex = Math.min(...prev.linkedRules.map((rule) => rule.index))
        const nextIndex = Math.min(...next.linkedRules.map((rule) => rule.index))

        const safePrevIndex = Number.isFinite(prevIndex) ? prevIndex : Number.MAX_SAFE_INTEGER
        const safeNextIndex = Number.isFinite(nextIndex) ? nextIndex : Number.MAX_SAFE_INTEGER

        if (safePrevIndex !== safeNextIndex) {
          return safePrevIndex - safeNextIndex
        }

        return prev.providerName.localeCompare(next.providerName)
      })
    ruleLookupDirectRules.value = rules.value.filter((rule) =>
      data.directRuleIndexes.includes(rule.index),
    )
    ruleLookupUnsupported.value = data.unsupported
    ruleLookupLiveErrors.value = data.errors
  } catch (error) {
    if (requestId !== latestRuleLookupRequestId || rulesFilter.value.trim() !== query) {
      return
    }

    ruleLookupResults.value = []
    ruleLookupDirectRules.value = []
    ruleLookupUnsupported.value = []
    ruleLookupLiveErrors.value = []
    ruleLookupError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (requestId === latestRuleLookupRequestId) {
      isRuleLookupLoading.value = false
    }
  }
}
