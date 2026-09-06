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

// 这个组(含嵌套的组)下面有没有任何一个节点有结果——有就说明组还有地方可切
const anyResultUnder = (proxies, name, seen = new Set()) => {
  if (seen.has(name)) return false
  seen.add(name)
  const p = proxies[name]
  if (!p || typeof p !== 'object') return false
  if (Array.isArray(p.all) && p.all.length) return p.all.some((m) => anyResultUnder(proxies, m, seen))
  return Array.isArray(p.history) && p.history.length > 0
}

const isSample = (s) => s && typeof s === 'object' && typeof s.time === 'string' && Number.isFinite(Date.parse(s.time)) && typeof s.delay === 'number' && Number.isFinite(s.delay) && s.delay >= 0

// 组的当前选择一路下钻到节点(组可以选组);转圈或超过 16 层就放弃
const leafOf = (proxies, name) => {
  let cur = name
  const seen = new Set()
  for (let i = 0; i < 16; i++) {
    const p = proxies[cur]
    if (!p || typeof p !== 'object') return ''
    if (!(Array.isArray(p.all) && p.all.length)) return cur
    if (typeof p.now !== 'string' || !p.now || seen.has(cur)) return ''
    seen.add(cur)
    cur = p.now
  }
  return ''
}

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
  // 最近一次真正写入的时刻:前端轮询它,变了才拉整份
  let updatedAt = 0
  const flush = () => {
    if (!dirty) return
    store.setRaw(LATENCY_HISTORY_KEY, JSON.stringify(cache))
    dirty = false
    updatedAt = now()
  }

  // 记一笔。和已存的最后一条时间相同就是同一次结果,不重复;乱序到达的按时间插入。
  // 组的样本多一个 node:那一笔是组当时选中的哪个节点测出来的
  const record = (name, sample) => {
    if (!name || typeof name !== 'string' || !isSample(sample)) return false
    const list = cache[name] || []
    const last = list[list.length - 1]
    const node = typeof sample.node === 'string' && sample.node ? sample.node : undefined
    if (last && last.time === sample.time && (last.node || undefined) === node) return false
    if (sample.delay === TIMED_OUT && last && last.delay === TIMED_OUT && (last.node || undefined) === node && Math.abs(Date.parse(sample.time) - Date.parse(last.time)) < TIMEOUT_DEDUPE_MS) return false
    const next = [...list, { time: sample.time, delay: Math.round(sample.delay), ...(node ? { node } : {}) }].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
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

  // 组:每笔记"当时选中的节点 + 它那次的结果"。组切了节点,下一笔就是新节点的,时间线上看得出
  // 变化——以前组的时间线直接取当前所选节点的,切换之后整条线都变成新节点的历史。
  // 时间用节点那次测试的时间;切到一个早就测过的节点(它的结果比组上一笔还旧)就用观察时刻,
  // 时间线才是按发生顺序排的。选中的节点没结果 = 超时(上一笔已经是同一节点的超时就不重复)。
  const recordGroup = (proxies, name, proxy, { kernelStartedAt, at }) => {
    const leaf = leafOf(proxies, name)
    if (!leaf) return false
    const list = cache[name]
    const prev = list && list[list.length - 1]
    const history = proxies[leaf] && proxies[leaf].history
    const last = Array.isArray(history) && history.length ? history[history.length - 1] : null
    if (last) {
      const t = Date.parse(last.time)
      const prevT = prev ? Date.parse(prev.time) : 0
      if (prev && prev.node === leaf && (prev.time === last.time || t <= prevT)) return false
      const time = !prev || t > prevT ? last.time : new Date(at).toISOString()
      return record(name, { time, delay: last.delay, node: leaf })
    }
    if (!prev) return false
    if (prev.node === leaf && prev.delay === TIMED_OUT) return false
    if (kernelStartedAt !== null && kernelStartedAt !== undefined && kernelStartedAt > Date.parse(prev.time)) return false
    // 组的时间线不记超时:选中节点超时会导致组切走,切走时记新节点那笔就够了。只有组里所有成员
    // 都没结果、无处可切,才记一笔超时(sing-box 这时会一直挂在这个没结果的节点上)。
    if (anyResultUnder(proxies, name)) return false
    return record(name, { time: new Date(at).toISOString(), delay: TIMED_OUT, node: leaf })
  }

  // 从整份 /proxies 记(见文件头)。节点按自己的 history 记;组按当时选中的节点记(见 recordGroup)
  const recordFromProxies = (proxies, { kernelStartedAt = null, at = now() } = {}) => {
    let changed = false
    const vanished = []
    let known = 0
    for (const [name, proxy] of Object.entries(proxies || {})) {
      if (!proxy || typeof proxy !== 'object') continue
      if (Array.isArray(proxy.all) && proxy.all.length) {
        if (recordGroup(proxies, name, proxy, { kernelStartedAt, at })) changed = true
        continue
      }
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

  return { record, recordSamples, recordFromProxies, prune, get: () => cache, flush, updatedAt: () => updatedAt }
}
