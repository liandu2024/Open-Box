// 延迟历史:每个节点最近 10 次测速结果,面板服务端记、所有浏览器共享。
//
// sing-box 的 clash API 每个节点只留最新一次结果,超时还会把这条记录直接删掉。所以这里按
// "看到的变化"记:每次拿到整份 /proxies,最新一条时间变了就记一笔;从"有结果"变成"没结果"
// 就是内核把它删了 = 超时,记一笔 0。内核重启同样会清空所有历史,那不算——调用方把内核这次
// 启动的时刻传进来,上次记录之后启动过的就不记;拿不到启动时刻时退一步,一次刷新里超过一半
// 有记录的节点同时清空也当成重启不记。
// 存 app_storage 的 openbox/latency-history(受保护前缀,不回显给浏览器的设置同步)。
export const MAX_SAMPLES = 10
export const TIMED_OUT = 0
export const LATENCY_HISTORY_KEY = 'openbox/latency-history'
// 同一节点两笔超时靠得太近(不同来源在同一事件上各记了一笔)就当一笔
const TIMEOUT_DEDUPE_MS = 60_000

const isSample = (s) => s && typeof s === 'object' && typeof s.time === 'string' && Number.isFinite(Date.parse(s.time)) && typeof s.delay === 'number' && Number.isFinite(s.delay) && s.delay >= 0

export const createLatencyHistory = ({ store, now = () => Date.now() }) => {
  const read = () => {
    try {
      const parsed = JSON.parse(store.getRaw(LATENCY_HISTORY_KEY) || '{}')
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  let cache = read()
  let dirty = false
  const flush = () => {
    if (!dirty) return
    store.setRaw(LATENCY_HISTORY_KEY, JSON.stringify(cache))
    dirty = false
  }

  // 记一笔。和已存的最后一条时间相同就是同一次结果,不重复;乱序到达的按时间插入
  const record = (name, sample) => {
    if (!name || typeof name !== 'string' || !isSample(sample)) return false
    const list = cache[name] || []
    const last = list[list.length - 1]
    if (last && last.time === sample.time) return false
    if (sample.delay === TIMED_OUT && last && last.delay === TIMED_OUT && Math.abs(Date.parse(sample.time) - Date.parse(last.time)) < TIMEOUT_DEDUPE_MS) return false
    const next = [...list, { time: sample.time, delay: Math.round(sample.delay) }].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    while (next.length > MAX_SAMPLES) next.shift()
    cache = { ...cache, [name]: next }
    dirty = true
    return true
  }

  const recordSamples = (samples) => {
    let changed = false
    for (const s of Array.isArray(samples) ? samples : []) if (s && record(s.name, s)) changed = true
    if (changed) flush()
    return changed
  }

  // 从整份 /proxies 记(见文件头)。组不记:组的 history 是它当前所选节点的,按节点名记、按节点名取
  const recordFromProxies = (proxies, { kernelStartedAt = null, at = now() } = {}) => {
    let changed = false
    const vanished = []
    let known = 0
    for (const [name, proxy] of Object.entries(proxies || {})) {
      if (!proxy || typeof proxy !== 'object') continue
      if (Array.isArray(proxy.all) && proxy.all.length) continue
      const history = proxy.history
      if (Array.isArray(history) && history.length) {
        if (record(name, history[history.length - 1])) changed = true
        continue
      }
      const list = cache[name]
      const last = list && list[list.length - 1]
      if (!last) continue
      known += 1
      if (last.delay === TIMED_OUT) continue
      if (kernelStartedAt !== null && kernelStartedAt !== undefined && kernelStartedAt > Date.parse(last.time)) continue
      vanished.push(name)
    }
    const massWipe = (kernelStartedAt === null || kernelStartedAt === undefined) && vanished.length >= 3 && vanished.length * 2 > known
    if (vanished.length && !massWipe) {
      const time = new Date(at).toISOString()
      for (const name of vanished) if (record(name, { time, delay: TIMED_OUT })) changed = true
    }
    if (changed) flush()
    return changed
  }

  // 只留当前还存在的节点,订阅换掉的旧节点不再占地方
  const prune = (keepNames) => {
    const keep = new Set(keepNames)
    const next = {}
    let removed = 0
    for (const [name, list] of Object.entries(cache)) {
      if (keep.has(name)) next[name] = list
      else removed += 1
    }
    if (removed) { cache = next; dirty = true; flush() }
    return removed
  }

  return { record, recordSamples, recordFromProxies, prune, get: () => cache, flush }
}
