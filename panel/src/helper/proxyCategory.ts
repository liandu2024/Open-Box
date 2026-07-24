import { NOT_CONNECTED } from '@/constant'
import { getLatencyByName } from '@/store/proxies'

export type ProxyCategoryGroup = {
  name: string
  proxies: string[]
  availableCount: number
  totalCount: number
}

export const getProxyCategoryCollapseKey = (providerName: string, categoryName: string) => {
  return `${providerName}::${categoryName}`
}

export const getProxyCategoryOrderKey = (providerName: string, wildcard: string) => {
  return `${providerName}::${wildcard.trim()}`
}

export const getProxyCategoryName = (
  proxyName: string,
  wildcard: string,
  fallbackName: string,
) => {
  const normalizedWildcard = wildcard.trim()

  if (!normalizedWildcard) {
    return fallbackName
  }

  const wildcardIndex = proxyName.indexOf(normalizedWildcard)

  if (wildcardIndex <= 0) {
    return fallbackName
  }

  const categoryName = proxyName.slice(0, wildcardIndex).trim()

  return categoryName || fallbackName
}

export const hasProxyCategoryMatch = (proxies: string[], wildcard: string) => {
  const normalizedWildcard = wildcard.trim()

  if (!normalizedWildcard) {
    return false
  }

  return proxies.some((proxyName) => proxyName.indexOf(normalizedWildcard) > 0)
}

export const isProxyCategoryEnabled = (
  proxies: string[],
  wildcard: string,
  enabled: boolean,
) => {
  return enabled && hasProxyCategoryMatch(proxies, wildcard)
}

export const buildProxyCategoryGroups = (
  proxies: string[],
  wildcard: string,
  fallbackName: string,
  allProxies: string[] = proxies,
): ProxyCategoryGroup[] => {
  const groupedProxies = new Map<string, string[]>()
  const groupedAllProxies = new Map<string, string[]>()
  const groupedAvailableCounts = new Map<string, number>()

  allProxies.forEach((proxyName) => {
    const categoryName = getProxyCategoryName(proxyName, wildcard, fallbackName)
    const categoryProxies = groupedAllProxies.get(categoryName)
    const isAvailable = getLatencyByName(proxyName) !== NOT_CONNECTED

    if (categoryProxies) {
      categoryProxies.push(proxyName)
      if (isAvailable) {
        groupedAvailableCounts.set(categoryName, (groupedAvailableCounts.get(categoryName) ?? 0) + 1)
      }
      return
    }

    groupedAllProxies.set(categoryName, [proxyName])
    groupedAvailableCounts.set(categoryName, isAvailable ? 1 : 0)
  })

  proxies.forEach((proxyName) => {
    const categoryName = getProxyCategoryName(proxyName, wildcard, fallbackName)
    const categoryProxies = groupedProxies.get(categoryName)

    if (categoryProxies) {
      categoryProxies.push(proxyName)
      return
    }

    groupedProxies.set(categoryName, [proxyName])
  })

  return Array.from(groupedProxies.entries()).map(([name, categoryProxies]) => ({
    name,
    proxies: categoryProxies,
    availableCount: groupedAvailableCounts.get(name) ?? 0,
    totalCount: groupedAllProxies.get(name)?.length ?? categoryProxies.length,
  }))
}

export const sortProxyCategoryGroups = (
  groups: ProxyCategoryGroup[],
  orderedCategoryNames: string[] = [],
) => {
  if (!orderedCategoryNames.length) {
    return groups
  }

  const orderMap = new Map(orderedCategoryNames.map((name, index) => [name, index]))

  return [...groups].sort((a, b) => {
    const indexA = orderMap.get(a.name)
    const indexB = orderMap.get(b.name)

    if (indexA === undefined && indexB === undefined) {
      return 0
    }
    if (indexA === undefined) {
      return 1
    }
    if (indexB === undefined) {
      return -1
    }

    return indexA - indexB
  })
}
