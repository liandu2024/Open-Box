import type { Proxy } from '@/types'
import { ref } from 'vue'

// 延迟标签悬停要看最近 10 次结果,但 sing-box 的 clash API 每个节点只保留最新一次
// (history 里永远只有一条)。所以面板自己攒:每次拿到节点数据或自己测完延迟,发现最新
// 那条的时间变了就记一笔,每个节点留 10 条。放 localStorage(不在 config/ 前缀下,不会同步到
// 服务端——这是每台浏览器自己看的时间线,几百个节点乘 10 条也就几十 KB)。
export type LatencySample = { time: string; delay: number }
export const MAX_LATENCY_HISTORY = 10
const STORAGE_KEY = 'openbox-latency-history'

// 和 constant 里的 NOT_CONNECTED 同一个值;这里不引它,让这个模块不依赖浏览器之外的东西,能在 Node 里直接跑
const TIMED_OUT = 0

const load = (): Record<string, LatencySample[]> => {
  try {
    if (typeof localStorage === 'undefined') return {}
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
export const latencyHistory = ref<Record<string, LatencySample[]>>(load())

let saveTimer: ReturnType<typeof setTimeout> | undefined
const save = () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(latencyHistory.value))
    } catch {
      // 存不下(隐私模式、配额)就只留在内存里
    }
  }, 500)
}

// 内核这次启动的时刻(由服务状态的运行时长换算,侧边栏定期刷新它)。内核重启会把所有节点的
// 延迟历史清空,那不是超时;判断"历史没了 = 超时"之前先看内核是不是在上次记录之后重启过。
let kernelStartedAt: number | null = null
export const noteKernelUptime = (uptimeSeconds: number | null | undefined) => {
  kernelStartedAt = typeof uptimeSeconds === 'number' && Number.isFinite(uptimeSeconds) ? Date.now() - uptimeSeconds * 1000 : null
}

// 记一笔:和已存的最后一条时间相同就是同一次结果,不重复记
export const recordLatencySample = (name: string, sample: LatencySample | undefined) => {
  if (!name || !sample || typeof sample.time !== 'string' || typeof sample.delay !== 'number') return
  const list = latencyHistory.value[name] || []
  const last = list[list.length - 1]
  if (last && last.time === sample.time) return
  const next = [...list, { time: sample.time, delay: sample.delay }]
  while (next.length > MAX_LATENCY_HISTORY) next.shift()
  latencyHistory.value = { ...latencyHistory.value, [name]: next }
  save()
}

// 每次拿到整份节点数据时过一遍:
//   · 内核 history 的最新一条有变化的节点各记一笔;
//   · 内核自动测速超时时 sing-box 不是记 0,而是把那个节点的 history 整个删掉——面板只能看到
//     "上次有结果、这次空了"。这种从有到无的变化记一笔超时(时间只能取发现的时刻)。
//     内核重启同样会清空所有历史,那不算:内核在上次记录之后启动过就不记;拿不到运行时长
//     时退一步,一次刷新里大面积同时清空(超过一半有记录的节点)也当成重启不记。
//     已经是超时状态的节点再连续超时,内核那边看不出来,只有中间成功过一次才会再记。
export const recordLatencyHistory = (map: Record<string, Proxy>, { now = Date.now(), startedAt = kernelStartedAt }: { now?: number; startedAt?: number | null } = {}) => {
  const vanished: string[] = []
  let known = 0
  for (const [name, proxy] of Object.entries(map)) {
    // 组的 history 是它当前所选节点的,记在节点名下(取历史时也按节点名取)
    if (proxy?.all?.length) continue
    const history = proxy?.history
    if (Array.isArray(history) && history.length) {
      recordLatencySample(name, history[history.length - 1] as LatencySample)
      continue
    }
    const list = latencyHistory.value[name]
    const last = list?.[list.length - 1]
    if (!last) continue
    known += 1
    if (last.delay === TIMED_OUT) continue
    if (startedAt !== null && startedAt !== undefined && startedAt > Date.parse(last.time)) continue
    vanished.push(name)
  }
  if (!vanished.length) return
  if ((startedAt === null || startedAt === undefined) && vanished.length >= 3 && vanished.length * 2 > known) return
  const time = new Date(now).toISOString()
  for (const name of vanished) recordLatencySample(name, { time, delay: TIMED_OUT })
}

// 最近 N 次,新的在前
export const getRecentLatencyHistory = (name: string) => [...(latencyHistory.value[name] || [])].reverse()
