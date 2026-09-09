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

// 策略穿透要直接穿到节点:故障转移父组这一层列的不是页签(内部子组),而是各页签的真实节点按页签顺序摊开
// (去重、只留内核里真有的节点);内部子组不再单独成一层。isNode 由调用方给(store/proxies 里的 proxyMap)
export const failoverFlatNodes = (groupName: string, isNode: (name: string) => boolean) => {
  const group = managedOutbounds.value.find((g) => g.name === groupName)
  if (!group || group.type !== 'failover') return null
  const out: string[] = []
  for (const lane of group.lanes ?? []) {
    for (const member of lane.members) {
      if (isNode(member) && !out.includes(member)) out.push(member)
    }
  }
  return out
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
