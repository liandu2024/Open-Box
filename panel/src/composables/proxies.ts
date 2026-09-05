import { isSingBox } from '@/api'
import { GLOBAL, PROXY_TAB_TYPE } from '@/constant'
import { isHiddenGroup, isProxyGroup } from '@/helper'
import { configs } from '@/store/config'
import { effectiveSiteSetOrder, managedOutbounds, siteSetNames } from '@/store/openboxSiteSets'
import { openboxSubscriptions } from '@/store/openboxSubscriptions'
import { proxiesTabShow, proxyGroupList, proxyMap } from '@/store/proxies'
import { customGlobalNode, displayGlobalByMode, manageHiddenGroup } from '@/store/settings'
import { isEmpty } from 'lodash'
import { computed, ref } from 'vue'

const filterGroups = (all: string[]) => {
  if (manageHiddenGroup.value) {
    return all
  }

  return all.filter((name) => !isHiddenGroup(name))
}

const getRenderGroups = () => {
  // 「订阅」页签:一条订阅一张卡片,卡片名就是订阅名(全局折叠 / 全部测延迟按它找目标)。
  // sing-box 没有 provider,原来读 clash_api 的 provider 列表在这里永远是空的。
  if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER) {
    return openboxSubscriptions.value.map((sub) => sub.name)
  }

  if (isEmpty(proxyMap.value)) {
    return []
  }

  const currentGroups = getCurrentProxyGroups()

  if (proxiesTabShow.value === PROXY_TAB_TYPE.POLICY) {
    return sortByPolicyOrder(currentGroups.filter((name) => isPolicyGroup(name)))
  }

  if (proxiesTabShow.value === PROXY_TAB_TYPE.NODE) {
    return currentGroups.filter((name) => !isPolicyGroup(name))
  }

  return currentGroups
}

const getCurrentProxyGroups = () => {
  if (displayGlobalByMode.value) {
    if (configs.value?.mode.toUpperCase() === GLOBAL) {
      return [
        isSingBox.value && proxyMap.value[customGlobalNode.value] ? customGlobalNode.value : GLOBAL,
      ]
    }

    return filterGroups(proxyGroupList.value)
  }

  return filterGroups([...proxyGroupList.value, GLOBAL])
}

const nodeGroupNames = computed(() => {
  const resolved = new Map<string, boolean>()
  const visiting = new Set<string>()

  const isSemanticNodeGroup = (name: string): boolean => {
    const cached = resolved.get(name)

    if (cached !== undefined) {
      return cached
    }

    const proxy = proxyMap.value[name]

    if (!proxy?.all?.length || visiting.has(name)) {
      resolved.set(name, false)
      return false
    }

    visiting.add(name)

    const result = proxy.all.every((memberName) => {
      const member = proxyMap.value[memberName]

      if (!member) {
        return false
      }

      if (!isProxyGroup(memberName)) {
        return true
      }

      return isSemanticNodeGroup(memberName)
    })

    visiting.delete(name)
    resolved.set(name, result)

    return result
  }

  return new Set(getCurrentProxyGroups().filter((name) => isSemanticNodeGroup(name)))
})

// 策略页签按「策略设置」里拖出来的显示顺序排(没拖过就是「目标分流」里的命中顺序,兜底
// 「其他」最后);名单里没有的(退回猜法时)保持内核给的顺序放在后面。
const sortByPolicyOrder = (names: string[]) => {
  const order = effectiveSiteSetOrder.value
  if (!order.length) return names
  const index = (name: string) => {
    const i = order.indexOf(name)
    return i === -1 ? order.length : i
  }
  return [...names].sort((a, b) => index(a) - index(b))
}

// 站点集 = 策略,其余带成员的组 = 节点组。名单从 Open-Box 自己的档案来(见
// store/openboxSiteSets.ts);没拉到时退回 zashboard 原来按成员形状猜的那套。
const isPolicyGroup = (name: string) => {
  if (siteSetNames.value.size) return siteSetNames.value.has(name)
  return !nodeGroupNames.value.has(name)
}

export const disableProxiesPageScroll = ref(false)
export const isProxiesPageMounted = ref(false)
export const policyGroups = computed(() =>
  sortByPolicyOrder(getCurrentProxyGroups().filter((name) => isPolicyGroup(name))),
)
// 「节点」页签按「节点管理」里的顺序排(用户拖出来的那个);名单里没有的排后面
const sortByManagedOrder = (names: string[]) => {
  const order = managedOutbounds.value.map((g) => g.name)
  if (!order.length) return names
  const index = (name: string) => {
    const i = order.indexOf(name)
    return i === -1 ? order.length : i
  }
  return [...names].sort((a, b) => index(a) - index(b))
}

// 「节点」页签:节点管理里的组,每个组一张独立卡片。内核的 GLOBAL 组不列——它是
// sing-box 自动生成的"所有出站"总表,不是用户建的组,放进来只会多一张几十个成员的大卡片。
export const nodeGroups = computed(() =>
  sortByManagedOrder(
    getCurrentProxyGroups().filter((name) => name !== GLOBAL && !isPolicyGroup(name)),
  ),
)
export const renderGroups = computed(() => {
  const groups = getRenderGroups()

  if (isProxiesPageMounted.value) {
    return groups
  }

  return groups.slice(0, 16)
})
