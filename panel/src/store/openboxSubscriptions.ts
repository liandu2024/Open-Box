import type { OpenboxApplyResult, OpenboxSubscription } from '@/api/openbox'
import { applySubscriptionChanges, fetchSubscriptions, refreshSubscription } from '@/api/openbox'
import { showNotification } from '@/helper/notification'
import { ref } from 'vue'

// 订阅变动后服务端会把节点应用到内核(见 server/api/subscriptions.mjs):成了说一声,
// 失败把原因摆出来——订阅本身已经存好,只是内核那一步没过。内核没在跑时不吭声。
export const notifySubscriptionApplied = (applied?: OpenboxApplyResult) => {
  if (!applied) return
  if (!('ok' in applied)) {
    // 节点没变就不重启内核,说一声免得以为刷新没生效;内核没在跑 / 先记账的情况不吭声
    if (applied.skipped === 'nothing-changed') showNotification({ content: 'subscriptionNodesUnchanged', type: 'alert-info' })
    return
  }
  if (applied.ok) {
    showNotification({ content: 'subscriptionAppliedToCore', type: 'alert-success' })
  } else {
    showNotification({ content: 'subscriptionApplyFailed', type: 'alert-error', params: { message: applied.message || applied.stage || '' } })
  }
}

// 代理页那个「订阅」标签原本读的是 Clash API 的 /providers/proxies —— 也就是 sing-box 的
// proxy provider。但 Open-Box 是把订阅解析成一条条具体的 outbound 写进配置的,从不生成
// provider,所以那个标签在 Open-Box 里结构上恒为「订阅 (0)」,内核跑没跑起来都一样。
//
// 这里给它换上 Open-Box 自己的订阅列表:代理页和订阅设置页共用同一份数据,任一处刷新
// 之后另一处也是最新的。
export const openboxSubscriptions = ref<OpenboxSubscription[]>([])
export const openboxSubscriptionsLoading = ref(false)
export const openboxSubscriptionsError = ref('')

export const loadOpenboxSubscriptions = async () => {
  openboxSubscriptionsLoading.value = true
  openboxSubscriptionsError.value = ''
  try {
    openboxSubscriptions.value = await fetchSubscriptions()
  } catch (error) {
    openboxSubscriptionsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    openboxSubscriptionsLoading.value = false
  }
}

// 「全部刷新」:逐个串行刷,不并发。刷新会让服务端去机场拉取,四五个订阅同时拉既容易
// 撞上机场的频率限制,失败了也分不清是哪一条的问题。任一条失败不影响其余继续。
// 每条都带 apply=false,最后只应用一次:不然几条订阅就重启几次内核。
export const refreshAllOpenboxSubscriptions = async () => {
  for (const sub of [...openboxSubscriptions.value]) {
    try {
      await refreshSubscription(sub.id, undefined, { apply: false })
    } catch {
      // 单条失败不中断整体;具体原因在订阅设置页逐条刷新时会显示出来
    }
  }
  try {
    notifySubscriptionApplied((await applySubscriptionChanges()).applied)
  } catch (error) {
    notifySubscriptionApplied({ ok: false, message: error instanceof Error ? error.message : String(error) })
  }
  await loadOpenboxSubscriptions()
}
