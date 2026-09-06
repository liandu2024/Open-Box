// 自动组的硬性定时测速。
//
// sing-box 的 URLTest 组是"懒惰"的:interval 只在这个组有流量经过时才起作用——启动时测一遍,
// 之后只有连接真正经过它才启动定时器,超过 idle_timeout 没流量又停掉。闲置的组永远停在启动
// 那一次结果上,用户设的「5 分钟测一次」在没流量时不成立。这里由面板服务端按 interval 严格
// 定时:每 tick 看一眼每个 urltest 组最近一轮是什么时候(自己记的,或者成员里最新的一条——
// 内核启动自测、有流量时内核自己测都算),到点就调内核的组测速接口把这组测一遍。
//
// 内核那个接口是 force=false 的:最近 interval 内测过的成员会被跳过,所以几个组共用的节点
// 每个 interval 只测一次,代价 = 节点数,不是组数 × 节点数。测完再读一次 /proxies:有新结果
// 的记进延迟历史;这轮该测(结果比 interval 老或本来就没有)却仍没有结果的成员就是超时,记 0。
import { CLASH_API_BASE } from '../api/penetration.mjs'
import { processUptime } from './service.mjs'

// sing-box 的时长写法:5m、1h30m、90s、也可能是纯数字(纳秒,不太会出现,当秒处理)
export const parseDuration = (raw) => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw * 1000
  const text = String(raw || '').trim()
  if (!text) return 0
  if (/^\d+$/.test(text)) return Number(text) * 1000
  let total = 0
  let matched = false
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true
    const n = Number(m[1])
    total += m[2] === 'h' ? n * 3600_000 : m[2] === 'm' ? n * 60_000 : m[2] === 's' ? n * 1000 : n
  }
  return matched ? total : 0
}

const DEFAULT_INTERVAL_MS = 3 * 60_000
const latestTime = (proxy) => {
  const history = proxy && Array.isArray(proxy.history) ? proxy.history : []
  const last = history[history.length - 1]
  const t = last ? Date.parse(last.time) : NaN
  return Number.isFinite(t) ? t : 0
}

const withTimeout = async (fetchImpl, url, init, timeoutMs) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export const createLatencyScheduler = ({
  store, ctx, paths, history, fetchImpl = globalThis.fetch, now = () => Date.now(),
  tickMs = 30_000, testTimeoutMs = 5000, log = () => {},
}) => {
  // 每个组上一轮(我们发起的)的时刻
  const lastRound = new Map()
  const headers = () => {
    const secret = store.getClashSecret ? store.getClashSecret() : ''
    return secret ? { Authorization: `Bearer ${secret}` } : {}
  }
  const fetchProxies = async () => {
    const res = await withTimeout(fetchImpl, `${CLASH_API_BASE}/proxies`, { headers: headers() }, 5000)
    if (!res || !res.ok) throw new Error(`proxies HTTP ${res ? res.status : 'none'}`)
    const body = await res.json()
    return (body && body.proxies) || {}
  }
  const kernelStart = async () => {
    const uptime = await processUptime(ctx, 'sing-box')
    return typeof uptime === 'number' ? now() - uptime * 1000 : null
  }
  const readGroups = async () => {
    const cfg = JSON.parse(await ctx.readFile(paths.configPath))
    return (cfg.outbounds || [])
      .filter((o) => o && o.type === 'urltest' && o.tag)
      .map((o) => ({ tag: o.tag, url: o.url || '', intervalMs: parseDuration(o.interval) || DEFAULT_INTERVAL_MS, members: Array.isArray(o.outbounds) ? o.outbounds : [] }))
  }

  // 只读一次 /proxies 把看到的变化记下来,不发起测速(面板手动测完后调用,结果马上进历史)
  const sync = async () => {
    let proxies
    try { proxies = await fetchProxies() } catch { return false }
    return history.recordFromProxies(proxies, { kernelStartedAt: await kernelStart(), at: now() })
  }

  const tick = async () => {
    let proxies
    try { proxies = await fetchProxies() } catch { return { skipped: 'kernel' } }
    const kernelStartedAt = await kernelStart()
    history.recordFromProxies(proxies, { kernelStartedAt, at: now() })
    let groups
    try { groups = await readGroups() } catch { return { skipped: 'config' } }

    const rounds = []
    for (const g of groups) {
      if (!g.url || !g.members.length) continue
      const kernelLatest = Math.max(0, ...g.members.map((m) => latestTime(proxies[m])))
      const last = Math.max(lastRound.get(g.tag) || 0, kernelLatest)
      const at = now()
      if (last && at - last < g.intervalMs) continue
      // 这轮内核真的会测的成员(force=false:最近 interval 内测过的会被跳过)
      const due = g.members.filter((m) => { const t = latestTime(proxies[m]); return !t || at - t >= g.intervalMs })
      lastRound.set(g.tag, at)
      try {
        await withTimeout(fetchImpl, `${CLASH_API_BASE}/group/${encodeURIComponent(g.tag)}/delay?url=${encodeURIComponent(g.url)}&timeout=${testTimeoutMs}`, { headers: headers() }, testTimeoutMs + 15_000)
      } catch (err) {
        log(`[latency] 组 ${g.tag} 定时测速请求失败:${err instanceof Error ? err.message : err}`)
      }
      rounds.push({ tag: g.tag, due, at })
    }
    if (!rounds.length) return { tested: [] }

    let after
    try { after = await fetchProxies() } catch { return { tested: rounds.map((r) => r.tag), recorded: false } }
    // 成功的:新结果被记进去;这轮该测却仍没有结果的:超时
    history.recordFromProxies(after, { kernelStartedAt, at: now() })
    const samples = []
    for (const r of rounds) {
      const time = new Date(r.at).toISOString()
      for (const m of r.due) {
        const p = after[m]
        if (!p || typeof p !== 'object') continue
        if (Array.isArray(p.all) && p.all.length) continue
        if (!latestTime(p)) samples.push({ name: m, time, delay: 0 })
      }
    }
    history.recordSamples(samples)
    log(`[latency] 定时测速:${rounds.map((r) => `${r.tag}(${r.due.length})`).join('、')},超时 ${samples.length}`)
    return { tested: rounds.map((r) => r.tag), timeouts: samples.map((s) => s.name) }
  }

  let timer = null
  const start = () => {
    if (timer) return
    timer = setInterval(() => { tick().catch((err) => log(`[latency] tick 失败:${err instanceof Error ? err.message : err}`)) }, tickMs)
    if (typeof timer.unref === 'function') timer.unref()
  }
  const stop = () => { if (timer) clearInterval(timer); timer = null }
  return { tick, sync, start, stop }
}
