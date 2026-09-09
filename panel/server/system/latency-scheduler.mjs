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
import { parseDuration } from '../engine/duration.mjs'
import { isInternalTag } from '../engine/user-groups.mjs'
import { kernelTestUrl } from '../engine/test-url.mjs'

export { parseDuration }

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
  // 每个成员上一次被我们发起的测试覆盖到的时刻。有结果的成员按内核记录的时间判"到点",
  // 没结果的(超时的、从没测通的)内核那边没有时间,就按这个表判——否则它们每个 tick 都算到点,
  // 每 30 秒被测一次,一个死节点一次 5 秒,白白占着并发。
  const lastTested = new Map()
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
    // 故障转移的内部子组不在这里调度:它们的检测由 system/failover-manager.mjs 按父组的间隔统一做,两个调度器
    // 不重复发起同一批检查
    return (cfg.outbounds || [])
      .filter((o) => o && o.type === 'urltest' && o.tag && !isInternalTag(o.tag))
      // 组配置里的 url 可能是 http 的(内核自己定时测认),但 /group/:tag/delay 不认 http——会悄悄换成
      // gstatic 去测,用户改的地址等于没改;先升成 https(engine/test-url.mjs)
      .map((o) => ({ tag: o.tag, url: kernelTestUrl(o.url || ''), intervalMs: parseDuration(o.interval) || DEFAULT_INTERVAL_MS, members: Array.isArray(o.outbounds) ? o.outbounds : [] }))
  }

  // 只读一次 /proxies 把看到的变化记下来,不发起测速(面板手动测完后调用,结果马上进历史)
  const sync = async () => {
    let proxies
    try { proxies = await fetchProxies() } catch { return false }
    return history.recordFromProxies(proxies, { kernelStartedAt: await kernelStart(), at: now() })
  }

  // 组测速请求的等待上限:内核最多 10 个并发、每个成员最多 testTimeout,按这轮真要测的成员数算,
  // 再留 15 秒余量。不能设成固定 20 秒——内核用这个请求的 ctx 跑批测,请求一断后面的成员就
  // 不测了(正式路由器「所有-自动」212 个成员,以前每轮只测到一半)。
  const KERNEL_CONCURRENCY = 10
  const MAX_ROUND_WAIT_MS = 5 * 60_000
  const roundWaitMs = (dueCount) => Math.min(MAX_ROUND_WAIT_MS, Math.ceil(dueCount / KERNEL_CONCURRENCY) * testTimeoutMs + 15_000)

  let inFlight = false
  const tick = async () => {
    // 上一轮还没跑完(大组一轮要一两分钟)就不叠着跑
    if (inFlight) return { skipped: 'busy' }
    inFlight = true
    try {
      return await runTick()
    } finally {
      inFlight = false
    }
  }

  const runTick = async () => {
    let proxies
    try { proxies = await fetchProxies() } catch { return { skipped: 'kernel' } }
    const kernelStartedAt = await kernelStart()
    history.recordFromProxies(proxies, { kernelStartedAt, at: now() })
    let groups
    try { groups = await readGroups() } catch { return { skipped: 'config' } }

    const tested = []
    const timeouts = []
    for (const g of groups) {
      if (!g.url || !g.members.length) continue
      // 到点按成员算,不按组算:一个组里各成员上次测的时刻不一样(共用的成员可能刚被别的组测过,
      // 一轮里靠后的成员比靠前的晚一分钟),谁到了 interval 谁就该测。每个组都按此刻最新的
      // /proxies 判,前一个组刚测过的共用成员这里就不算到点。
      // 内核的组测速是 force=false 的,没到 interval 的成员它自己会跳过,所以一次请求只测到点的。
      const at = now()
      const due = g.members.filter((m) => {
        const t = latestTime(proxies[m])
        const since = t || lastTested.get(m) || 0
        return !since || at - since >= g.intervalMs
      })
      if (!due.length) continue
      let ok = false
      try {
        const res = await withTimeout(fetchImpl, `${CLASH_API_BASE}/group/${encodeURIComponent(g.tag)}/delay?url=${encodeURIComponent(g.url)}&timeout=${testTimeoutMs}`, { headers: headers() }, roundWaitMs(due.length))
        ok = Boolean(res && res.ok)
        if (!ok) log(`[latency] 组 ${g.tag} 定时测速返回 HTTP ${res ? res.status : 'none'}`)
      } catch (err) {
        log(`[latency] 组 ${g.tag} 定时测速请求失败:${err instanceof Error ? err.message : err}`)
      }
      tested.push(g.tag)
      // 测完马上读一次:新结果立刻进历史,后面的组也按新数据判要不要测
      try { proxies = await fetchProxies() } catch { break }
      history.recordFromProxies(proxies, { kernelStartedAt, at: now() })
      // 这轮该测却仍没有结果的成员就是超时。请求中途断掉的那轮不判:没测到的成员不是超时
      if (ok) {
        const time = new Date(at).toISOString()
        const samples = []
        for (const m of due) {
          lastTested.set(m, at)
          const p = proxies[m]
          if (!p || typeof p !== 'object') continue
          if (Array.isArray(p.all) && p.all.length) continue
          if (!latestTime(p)) samples.push({ name: m, time, delay: 0 })
        }
        history.recordSamples(samples)
        timeouts.push(...samples.map((x) => x.name))
      }
      log(`[latency] 定时测速 ${g.tag}:测 ${due.length} 个${ok ? '' : '(请求未完成)'}`)
    }
    return { tested, timeouts }
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
