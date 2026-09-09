import type { OpenboxFailoverGroupStatus, OpenboxFailoverStatus } from '@/api/openbox'
import { fetchFailoverStatus } from '@/api/openbox'
import { i18n } from '@/i18n'
import { managedOutbounds } from '@/store/openboxSiteSets'
import { computed, ref } from 'vue'

// 故障转移组的内部出站(页签子组 / 兜底拒绝)都带这个前缀,和服务端 engine/user-groups.mjs 一致。
// 它们要进内核、要能出现在链路里,但不是用户组:代理页不给它们单独开卡片,显示时换成页签的角色名
export const FAILOVER_INTERNAL_PREFIX = '__fo:'
export const isFailoverInternalTag = (name: string) => name.startsWith(FAILOVER_INTERNAL_PREFIX)

// 运行状态(服务端 system/failover-manager.mjs 维护;浏览器关了它照样在切,这里只是看)
export const failoverStatus = ref<OpenboxFailoverStatus | null>(null)
export const failoverGroupByTag = computed(() => {
  const map = new Map<string, OpenboxFailoverGroupStatus>()
  for (const g of failoverStatus.value?.groups ?? []) map.set(g.tag, g)
  return map
})

export const loadFailoverStatus = async () => {
  try {
    failoverStatus.value = await fetchFailoverStatus()
  } catch {
    /* 面板服务端没起来 / 旧版本没有这个接口:保持上一份 */
  }
}

// 有卡片在看就每 10 秒拉一次;没人看就停,不白跑
let watchers = 0
let timer: ReturnType<typeof setInterval> | null = null
export const watchFailoverStatus = () => {
  watchers += 1
  if (watchers === 1) {
    void loadFailoverStatus()
    timer = setInterval(() => void loadFailoverStatus(), 10_000)
  }
  let released = false
  return () => {
    if (released) return
    released = true
    watchers -= 1
    if (watchers <= 0 && timer) {
      clearInterval(timer)
      timer = null
      watchers = 0
    }
  }
}

// 页签的角色名:第一个主用,后面依次备用 1、2……
export const failoverRoleLabel = (index: number) =>
  index === 0 ? i18n.global.t('failoverPrimary') : i18n.global.t('failoverBackupN', { n: index })

// 内部子组 tag 在代理页 / 策略穿透里显示成什么:用户给页签起了名就显示名字,没起就显示角色(主用 / 备用 N);
// 不是内部 tag 就原样返回。__fo:g-xxx:lane-yyy 这种技术 tag 不是产品名称,任何地方都不该露出来
export const failoverDisplayName = (name: string) => {
  if (!isFailoverInternalTag(name)) return name
  const hit = failoverLaneOfTag(name)
  if (!hit) return i18n.global.t('failoverLaneFallback')
  return hit.lane.name || failoverRoleLabel(hit.index)
}

// 故障转移父组成员表里的兜底拒绝(内置「拒绝」或内部 __fo:reject):它是内核配置里的兜底,不是用户能选的候选,
// 代理页 / 策略穿透列成员时不显示它
export const isFailoverRejectMember = (groupName: string, member: string) => {
  const group = managedOutbounds.value.find((g) => g.name === groupName)
  if (!group || group.type !== 'failover') return false
  if (member === `${FAILOVER_INTERNAL_PREFIX}reject`) return true
  const block = managedOutbounds.value.find((g) => g.kind === 'block')
  return Boolean(block && member === block.name)
}
export const failoverMembersOf = (groupName: string, all: string[]) =>
  all.filter((member) => !isFailoverRejectMember(groupName, member))

// 页签的图标:自己挑了就用自己的,没挑继承父组的(短码,给 iconUrlFor 转成地址)
export const failoverLaneIconCode = (groupName: string, laneId: string) => {
  const group = managedOutbounds.value.find((g) => g.name === groupName)
  if (!group || group.type !== 'failover') return ''
  const lane = group.lanes?.find((l) => l.id === laneId)
  return lane?.icon || group.icon || ''
}

export const isFailoverGroup = (groupName: string) =>
  managedOutbounds.value.some((g) => g.name === groupName && g.type === 'failover')

// 策略穿透里故障转移组的页签视图:每个页签在内核里对应哪个出站(单节点 = 节点本身,多节点 = 内部子组,
// 空 = 没有),有哪些有效节点,内核此刻在页签内选中谁。优先用服务端运行状态,没拉到就按定义 + 内核 /proxies 推
export interface FailoverLaneView {
  id: string
  index: number
  label: string
  ref: string | null
  subTag: string | null
  valid: string[]
  invalid: string[]
  kernelNow: string | null
  // 页签图标(短码;已按「自己的 → 继承父组」算好),iconScale 跟父组
  icon: string
  iconScale: number
}
export const failoverLanesOf = (
  groupName: string,
  proxies: Record<string, { all?: string[]; now?: string } | undefined>,
): FailoverLaneView[] | null => {
  const group = managedOutbounds.value.find((g) => g.name === groupName)
  if (!group || group.type !== 'failover') return null
  const status = failoverGroupByTag.value.get(groupName)
  const statusLanes = new Map((status?.lanes ?? []).map((l) => [l.id, l]))
  const isNode = (name: string) => Boolean(proxies[name]) && !proxies[name]?.all?.length
  const parentAll = proxies[groupName]?.all ?? []
  return (group.lanes ?? []).map((lane, index) => {
    const st = statusLanes.get(lane.id)
    const valid = st ? st.valid : lane.members.filter(isNode)
    const invalid = lane.members.filter((m) => !valid.includes(m))
    let subTag = st?.subTag ?? null
    if (!st && valid.length > 1) {
      const head = `${FAILOVER_INTERNAL_PREFIX}${group.id}:${lane.id}`
      subTag = parentAll.find((m) => m === head || (m.startsWith(head) && /^~+$/.test(m.slice(head.length)))) ?? null
    }
    const ref = st ? st.ref : valid.length === 1 ? valid[0]! : subTag
    const kernelNow = subTag ? (proxies[subTag]?.now ?? null) : valid.length === 1 ? valid[0]! : null
    return { id: lane.id, index, label: lane.name || failoverRoleLabel(index), ref, subTag, valid, invalid, kernelNow, icon: lane.icon || group.icon || '', iconScale: group.iconScale || 0 }
  })
}
// 「最近切换:主用 → 备用 1(页签失效)· 14:20:05」这一句(没切换过就是空串)
export const failoverLastSwitchText = (groupName: string, lanes: FailoverLaneView[]) => {
  const status = failoverGroupByTag.value.get(groupName)
  const sw = status?.lastSwitch
  if (!sw) return ''
  const t = i18n.global.t
  const refLabel = (laneId: string | null, ref: string) => {
    const lane = laneId ? lanes.find((l) => l.id === laneId) : null
    if (lane) return lane.label
    if (status && ref === status.rejectTag) return t('failoverReject')
    return ref || '—'
  }
  const reasonKey: Record<string, string> = {
    'lane-failed': 'failoverReasonLaneFailed',
    'restore-primary': 'failoverReasonRestore',
    'all-failed': 'failoverReasonAllFailed',
    'priority-changed': 'failoverReasonPriority',
    recovered: 'failoverReasonRecovered',
    initial: 'failoverReasonInitial',
  }
  return t('failoverLastSwitch', {
    from: refLabel(sw.from.laneId, sw.from.ref),
    to: refLabel(sw.to.laneId, sw.to.ref),
    reason: reasonKey[sw.reason] ? t(reasonKey[sw.reason]) : sw.reason,
    time: new Date(sw.at).toLocaleTimeString(),
  })
}

// 内核此刻在哪个页签:先信服务端记录的当前页签,否则按顺序找第一个引用等于父组 now 的
export const failoverCurrentLaneId = (groupName: string, lanes: FailoverLaneView[], now: string | undefined) => {
  const status = failoverGroupByTag.value.get(groupName)
  if (status?.currentLaneId && lanes.some((l) => l.id === status.currentLaneId)) return status.currentLaneId
  return lanes.find((l) => l.ref && l.ref === now)?.id ?? null
}

// 内部子组 tag → 它是哪个故障转移组的第几个页签。按节点管理里的定义找(不用等运行状态):
// tag 形如 __fo:<组id>:<页签id>,组 id 里也可能有冒号,所以按「前缀 + 组 id + :」匹配
export const failoverLaneOfTag = (tag: string) => {
  if (!isFailoverInternalTag(tag)) return null
  for (const g of managedOutbounds.value) {
    if (g.type !== 'failover' || !g.lanes) continue
    const head = `${FAILOVER_INTERNAL_PREFIX}${g.id}:`
    if (!tag.startsWith(head)) continue
    const laneId = tag.slice(head.length).replace(/~+$/, '')
    const index = g.lanes.findIndex((l) => l.id === laneId)
    if (index === -1) continue
    return { group: g, lane: g.lanes[index], index }
  }
  return null
}
