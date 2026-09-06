import { fetchLatencyHistory, fetchLatencyHistoryVersion, postLatencySamples, syncLatencyHistory as syncLatencyHistoryAPI } from '@/api/openbox'
import { NOT_CONNECTED } from '@/constant'
import { ref } from 'vue'

// 延迟标签悬停要看最近 10 次结果。sing-box 每个节点只保留最新一次,所以由面板服务端攒
// (server/system/latency-history.mjs):自动组按 interval 硬性定时测、结果记进服务端,所有浏览器
// 共享。这里只是服务端那份的镜像:拉节点数据时顺带拉一次;面板自己手动测完,把超时报上去
// (内核那边超时只是删记录,面板自己知道是超时),再让服务端立刻读一次内核把成功的记下来。
export type LatencySample = { time: string; delay: number; node?: string }
export const MAX_LATENCY_HISTORY = 10
export const latencyHistory = ref<Record<string, LatencySample[]>>({})

let loadSeq = 0
// 服务端那份最近一次写入的时刻;轮询版本号时和它比,变了才拉整份
let seenUpdatedAt = 0
export const loadLatencyHistory = async () => {
  const mine = ++loadSeq
  try {
    const { history, updatedAt } = await fetchLatencyHistory()
    if (mine === loadSeq && history && typeof history === 'object') {
      latencyHistory.value = history
      seenUpdatedAt = typeof updatedAt === 'number' ? updatedAt : seenUpdatedAt
    }
  } catch {
    // 服务端拿不到就先用手头这份
  }
}

// 代理页可见时每 15 秒调一次:服务端定时测速有了新结果就返回 true,调用方再去刷新节点数据和整份历史
export const pollLatencyHistoryVersion = async () => {
  try {
    const { updatedAt } = await fetchLatencyHistoryVersion()
    if (typeof updatedAt !== 'number' || updatedAt === seenUpdatedAt) return false
    seenUpdatedAt = updatedAt
    return true
  } catch {
    return false
  }
}

// 手动测完:让服务端立刻读一次内核,把新结果记下来并返回整份
export const syncLatencyHistory = async () => {
  const mine = ++loadSeq
  try {
    const { history } = await syncLatencyHistoryAPI()
    if (mine === loadSeq && history && typeof history === 'object') latencyHistory.value = history
  } catch {
    // 同步失败下次拉节点数据时也会补上
  }
}

// 本地先插一笔(悬停马上能看到),再报给服务端
const insertLocal = (name: string, sample: LatencySample) => {
  const list = latencyHistory.value[name] || []
  if (list.some((s) => s.time === sample.time)) return
  const next = [...list, sample].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  while (next.length > MAX_LATENCY_HISTORY) next.shift()
  latencyHistory.value = { ...latencyHistory.value, [name]: next }
}
export const reportLatencyTimeouts = async (names: string[], time = new Date().toISOString()) => {
  const samples = names.filter(Boolean).map((name) => ({ name, time, delay: NOT_CONNECTED }))
  if (!samples.length) return
  for (const s of samples) insertLocal(s.name, { time: s.time, delay: s.delay })
  try {
    const { history } = await postLatencySamples(samples)
    if (history && typeof history === 'object') latencyHistory.value = history
  } catch {
    // 报不上去也不影响本地这一笔
  }
}

// 最近 N 次,新的在前
export const getRecentLatencyHistory = (name: string) => [...(latencyHistory.value[name] || [])].reverse()
