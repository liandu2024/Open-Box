import type { OpenboxFailoverGroupStatus, OpenboxFailoverStatus } from '@/api/openbox'
import { fetchFailoverStatus } from '@/api/openbox'
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
