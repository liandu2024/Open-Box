import type { Proxy } from '@/types'
import { ref } from 'vue'

// 延迟标签悬停要看最近 10 次结果,但 sing-box 的 clash API 每个节点只保留最新一次
// (history 里永远只有一条)。所以面板自己攒:每次拿到节点数据或自己测完延迟,发现最新
// 那条的时间变了就记一笔,每个节点留 10 条。放 localStorage(不在 config/ 前缀下,不会同步到
// 服务端——这是每台浏览器自己看的时间线,几百个节点乘 10 条也就几十 KB)。
export type LatencySample = { time: string; delay: number }
export const MAX_LATENCY_HISTORY = 10
const STORAGE_KEY = 'openbox-latency-history'

const load = (): Record<string, LatencySample[]> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
export const latencyHistory = ref<Record<string, LatencySample[]>>(load())

let saveTimer = 0
const save = () => {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(latencyHistory.value))
    } catch {
      // 存不下(隐私模式、配额)就只留在内存里
    }
  }, 500)
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

// 每次拿到整份节点数据时过一遍:内核 history 的最新一条有变化的节点各记一笔
export const recordLatencyHistory = (map: Record<string, Proxy>) => {
  for (const [name, proxy] of Object.entries(map)) {
    const history = proxy?.history
    if (!Array.isArray(history) || !history.length) continue
    // 组的 history 是它当前所选节点的,记在节点名下(取历史时也按节点名取)
    if (proxy.all?.length) continue
    recordLatencySample(name, history[history.length - 1] as LatencySample)
  }
}

// 最近 N 次,新的在前
export const getRecentLatencyHistory = (name: string) => [...(latencyHistory.value[name] || [])].reverse()
