// 故障转移(failover 组)的后台管理器。
//
// 内核里一个故障转移组落成:父 selector(tag = 组名)+ 每个多节点页签一个私有 urltest 子组
// (tag 形如 __fo:<组id>:<页签id>)+ 末位兜底拒绝。内核只会按 selector 的选择走流量,不会自己在
// 页签之间切;主备决策全在这里做,跟随面板服务端的生命周期,浏览器关了照样跑。
//
// 只认已经部署到内核的定义:config.meta.json 里的 failover 运行映射(和配置同一次生成),不看
// 弹窗里保存了还没生效的定义。meta 的 generatedAt 就是配置版本——版本一变,之前那轮探测的结果
// 一律作废,不拿旧轮次去操作新配置。
//
// 一轮检测(每个组按自己的 interval 到点跑):
//   1. GET /proxies 确认内核可达、父组和页签引用都在(部署到一半、内核正在重启时不动手);
//   2. 组内所有有效节点各测一次 GET /proxies/<节点>/delay(内核用这个节点出站真去访问测速地址,
//      端到端;有界并发;同一节点被几个页签共用只测一次,同轮结果复用);
//   3. 多节点页签有节点通过时调 GET /group/<子组>/delay 让内核按刚才的结果重选,再读回 now 确认
//      内核实际选中的是通过检测的节点——确认不了的页签这轮算「未知」,不算恢复也不算失败;
//   4. 页签健康:通过 = 有节点通过;失败 = 所有有效节点都明确失败;其余 = 未知(有节点没测到 /
//      探测服务报错)。空页签(有效节点为 0)永远是不可用。
//   5. 决策:当前页签仍通过就留着(备用延迟更低不是切换理由);当前页签连续 failureThreshold 轮
//      确认失败才按页签顺序转到第一个通过的候选;当前不是主用、主用连续通过满 recoveryHoldMs 且
//      开了「恢复后切回」就切回主用;全部候选都确认失败就切到兜底拒绝(不转直连),之后继续定期
//      检查,有候选恢复再切回去;未知不触发任何切换。
//      用户改了页签顺序(按稳定页签 id 的先后比,改名 / 换图标 / 别的原因重新生成配置都不算)是一次
//      「按新优先级重选」的待办:更靠前的页签这轮确认通过就挪过去,不要求当前页签先失败、也和
//      「恢复后切回」开关无关;目标是主用的仍走主用那套规则(开关 + 等待);目标还没确认或切换失败就
//      保留当前、下一轮再看。待办跟着状态落盘,内核 / 面板重启后接着办,直到落定。
//   6. 切换 = PUT /proxies/<父组> {name},再读回 now 确认;失败保留实际状态并记原因。
//
// 自动选择是运行状态,不回写用户的页签顺序;只把「当前在哪个页签」按稳定页签 id 存进
// openbox/failover-state,重启 / 重新部署后据此恢复关联,但健康一定重新检测过才动手。
import { CLASH_API_BASE } from '../api/penetration.mjs'
import { kernelTestUrl } from '../engine/test-url.mjs'
import { configMetaPath } from './deploy.mjs'
import { processUptime } from './service.mjs'

export const FAILOVER_STATE_KEY = 'openbox/failover-state'

const withTimeout = async (fetchImpl, url, init, timeoutMs) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const errText = (err) => (err instanceof Error ? err.message : String(err))

// 有界并发跑一批任务,结果按顺序返回
const mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export const laneRole = (index) => (index === 0 ? 'primary' : `backup-${index}`)
const sameOrder = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])

export const createFailoverManager = ({
  store, ctx, paths, history = null, fetchImpl = globalThis.fetch, now = () => Date.now(),
  tickMs = 5000, probeConcurrency = 4, log = () => {},
}) => {
  const headers = () => {
    const secret = store.getClashSecret ? store.getClashSecret() : ''
    return secret ? { Authorization: `Bearer ${secret}` } : {}
  }
  const api = (path) => `${CLASH_API_BASE}${path}`

  // ---- 持久化的关联(组 id → 当前页签 id / 最近一次切换)----
  const loadPersisted = () => {
    try {
      const raw = store.getRaw ? store.getRaw(FAILOVER_STATE_KEY) : null
      const parsed = raw ? JSON.parse(raw) : null
      return parsed && typeof parsed === 'object' && parsed.groups && typeof parsed.groups === 'object' ? parsed.groups : {}
    } catch { return {} }
  }
  const persist = () => {
    if (!store.setRaw) return
    const groups = {}
    for (const g of states.values()) {
      groups[g.id] = { laneId: g.currentLaneId, at: g.currentSince, lastSwitch: g.lastSwitch, laneOrder: g.laneOrder, reorder: g.reorder }
    }
    try { store.setRaw(FAILOVER_STATE_KEY, JSON.stringify({ groups })) } catch (err) { log(`[failover] 状态写不进去:${errText(err)}`) }
  }

  // ---- 运行状态 ----
  let version = null // 已加载的配置版本(meta.generatedAt)
  // stop() 之后置 true:进行中的轮次一律作废。没 start 也能手动 tick(测试 / 状态接口的 refresh)
  let stopped = false
  let timer = null
  let inTick = false
  let lastError = ''
  let paused = '' // '' | 'config' | 'kernel'
  const states = new Map() // groupId → state

  const freshLane = (lane) => ({
    id: lane.id, name: lane.name || '', index: lane.index, mode: lane.mode, ref: lane.ref, subTag: lane.subTag,
    members: [...(lane.members || [])], valid: [...(lane.valid || [])],
    health: lane.mode === 'empty' ? 'down' : 'unknown', failStreak: 0, upSince: null, kernelNow: null, confirmed: null,
  })
  const loadMap = (meta) => {
    const persisted = loadPersisted()
    const list = Array.isArray(meta?.failover) ? meta.failover : []
    const keep = new Set()
    for (const def of list) {
      if (!def || typeof def !== 'object' || !def.id || !def.tag) continue
      keep.add(def.id)
      const prev = states.get(def.id)
      const saved = persisted[def.id]
      const lanes = (Array.isArray(def.lanes) ? def.lanes : []).map((l) => {
        const fresh = freshLane(l)
        // 同一页签 id 的节点探测结果不带过版本:配置一变,节点参数可能变了,健康重新测
        return fresh
      })
      const laneIds = new Set(lanes.map((l) => l.id))
      const hintLane = prev?.currentLaneId && laneIds.has(prev.currentLaneId) ? prev.currentLaneId
        : saved?.laneId && laneIds.has(saved.laneId) ? saved.laneId : null
      // 页签顺序(稳定 id 的先后)和上一次已经应用的顺序比:变了就是用户改了主备优先级,记一条待办,
      // 下一轮按新顺序重选(runRound 的决策);上次的待办没办完就带过来。老的落盘记录没有顺序信息
      // (这个功能之前存下的):不知道用户有没有改过,记一次「按当前顺序校正」的待办,只校正到当前
      // 页签就是新顺序里第一个通过的为止,不把停在备用上的强行挪回主用(那是「恢复后切回」开关的事)
      const order = lanes.map((l) => l.id)
      const prevOrder = Array.isArray(prev?.laneOrder) ? prev.laneOrder : Array.isArray(saved?.laneOrder) ? saved.laneOrder : null
      const carried = prev?.reorder ?? saved?.reorder ?? null
      let reorder = carried && typeof carried === 'object' ? { since: carried.since, reason: carried.reason, evaluated: Boolean(carried.evaluated) } : null
      if (prevOrder && !sameOrder(prevOrder, order)) {
        reorder = { since: now(), reason: 'priority-changed', evaluated: false }
        log(`[failover] ${def.tag}:页签顺序从 ${prevOrder.join('/')} 改成 ${order.join('/')},下一轮按新顺序重选`)
      } else if (!prevOrder && saved && !reorder) {
        reorder = { since: now(), reason: 'order-unknown', evaluated: false }
      }
      states.set(def.id, {
        id: def.id, tag: def.tag, rejectTag: def.rejectTag || '', settings: def.settings || {},
        lanes, laneOrder: order, reorder,
        // 关联提示:上个版本 / 上次重启前在哪个页签。只是提示——健康没重新核过之前不据此宣布任何事
        currentLaneId: hintLane, currentSince: prev?.currentSince ?? saved?.at ?? null,
        lastSwitch: prev?.lastSwitch ?? saved?.lastSwitch ?? null,
        status: 'pending', paused: '', lastRoundAt: 0, nextRoundAt: 0, lastRoundId: 0, lastRoundResult: '',
        primaryUpSince: null, nodes: {}, inFlight: false, lastError: '',
      })
    }
    for (const id of [...states.keys()]) if (!keep.has(id)) states.delete(id)
    persist()
  }

  const readMeta = async () => {
    const raw = await ctx.readFile(configMetaPath(paths))
    const meta = JSON.parse(raw)
    return meta && typeof meta === 'object' ? meta : {}
  }

  // 每 tick 看一眼 meta:版本变了就重载映射,之前的轮次作废
  const syncMap = async () => {
    let meta
    try { meta = await readMeta() } catch (err) {
      // 没部署过 / 文件没了:没有组可管;已加载的映射也清掉(配置不在了)
      if (version !== null || states.size) { version = null; states.clear() }
      paused = 'config'
      lastError = errText(err)
      return false
    }
    paused = ''
    const v = String(meta.generatedAt || '')
    if (v !== version) {
      version = v
      loadMap(meta)
      log(`[failover] 载入运行映射 ${v || '(无版本)'}:${states.size} 个故障转移组`)
    }
    return true
  }

  const fetchProxies = async () => {
    const res = await withTimeout(fetchImpl, api('/proxies'), { headers: headers() }, 5000)
    if (!res || !res.ok) throw new Error(`proxies HTTP ${res ? res.status : 'none'}`)
    const body = await res.json()
    return (body && body.proxies) || {}
  }
  const fetchProxy = async (tag) => {
    const res = await withTimeout(fetchImpl, api(`/proxies/${encodeURIComponent(tag)}`), { headers: headers() }, 5000)
    if (!res || !res.ok) throw new Error(`proxy ${tag} HTTP ${res ? res.status : 'none'}`)
    return res.json()
  }
  // 单个节点的端到端探测。内核用这个节点出站访问测速地址:200 = 通过;503 / 504 = 这个节点失败
  // (超时 / 出错);别的情况(接口不可达、404、5xx)是探测基础设施的问题,记未知,不算节点失败。
  // 注意 sing-box 的这个接口对 http:// 的测速地址不认(内核会换成它内置的 https://www.gstatic.com/generate_204
  // 去测),所以传进来之前先过 kernelTestUrl 升成 https(runRound 里做);内部子组自己的定时测速用的才是配置里那个 url
  const probeNode = async (tag, url, timeoutMs) => {
    const at = now()
    try {
      const res = await withTimeout(fetchImpl, api(`/proxies/${encodeURIComponent(tag)}/delay?url=${encodeURIComponent(url)}&timeout=${timeoutMs}`), { headers: headers() }, timeoutMs + 5000)
      if (!res) return { ok: null, at, reason: 'no-response' }
      if (res.ok) {
        let body = null
        try { body = await res.json() } catch { /* 空体也算通过 */ }
        const delay = body && Number.isFinite(Number(body.delay)) ? Number(body.delay) : 0
        return delay > 0 ? { ok: true, delay, at } : { ok: false, delay: 0, at, reason: 'zero-delay' }
      }
      if (res.status === 503 || res.status === 504) return { ok: false, delay: 0, at, reason: res.status === 504 ? 'timeout' : 'failed' }
      return { ok: null, at, reason: `http-${res.status}` }
    } catch (err) {
      return { ok: null, at, reason: err && err.name === 'AbortError' ? 'probe-timeout' : errText(err) }
    }
  }
  // 让内核按最新结果给多节点页签重选(force=false:刚测过的成员它会跳过,所以这一步很便宜)
  const retestSub = async (subTag, url, timeoutMs, memberCount) => {
    try {
      const res = await withTimeout(fetchImpl, api(`/group/${encodeURIComponent(subTag)}/delay?url=${encodeURIComponent(url)}&timeout=${timeoutMs}`), { headers: headers() }, Math.ceil(memberCount / 10) * timeoutMs + 5000)
      return Boolean(res && res.ok)
    } catch { return false }
  }
  const switchTo = async (state, ref) => {
    const res = await withTimeout(fetchImpl, api(`/proxies/${encodeURIComponent(state.tag)}`), {
      method: 'PUT', headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify({ name: ref }),
    }, 5000)
    if (!res || !(res.ok || res.status === 204)) throw new Error(`PUT ${state.tag} → ${ref}:HTTP ${res ? res.status : 'none'}`)
    const back = await fetchProxy(state.tag)
    if (back?.now !== ref) throw new Error(`切到 ${ref} 后读回的是 ${back?.now ?? '(空)'}`)
    return back.now
  }

  const laneById = (state, id) => state.lanes.find((l) => l.id === id) || null
  // 内核此刻的选择对应哪个页签:先信记录的当前页签(它的引用就是 now 时),否则按顺序找第一个引用等于 now 的
  const laneForNow = (state, kernelNow) => {
    if (!kernelNow || kernelNow === state.rejectTag) return null
    const hinted = state.currentLaneId ? laneById(state, state.currentLaneId) : null
    if (hinted && hinted.ref === kernelNow) return hinted
    return state.lanes.find((l) => l.ref === kernelNow) || null
  }

  // 跑一轮:探测 → 页签健康 → 决策 → 切换。返回摘要给日志 / 测试看
  const runRound = async (state, proxies, kernelStartedAt) => {
    const roundVersion = version
    const roundId = ++state.lastRoundId
    const s = state.settings || {}
    const url = kernelTestUrl(s.testUrl || '')
    const timeoutMs = Number(s.timeoutMs) || 5000
    const threshold = Math.max(1, Number(s.failureThreshold) || 1)
    const restorePrimary = s.restorePrimary !== false
    const holdMs = Math.max(0, Number(s.recoveryHoldMs) || 0)
    const startedAt = now()
    // 这轮开始前内核对这个组的看法
    const parent = proxies[state.tag]
    if (!parent || !Array.isArray(parent.all)) return { skipped: 'parent-missing' }
    const expectedRefs = state.lanes.map((l) => l.ref).filter(Boolean)
    if (expectedRefs.some((r) => !parent.all.includes(r) || !proxies[r])) return { skipped: 'kernel-mismatch' }
    if (state.rejectTag && !parent.all.includes(state.rejectTag)) return { skipped: 'kernel-mismatch' }

    // 1. 节点探测(去重、有界并发)
    const tags = [...new Set(state.lanes.flatMap((l) => l.valid))]
    const results = new Map()
    if (url && tags.length) {
      const list = await mapLimit(tags, probeConcurrency, (tag) => probeNode(tag, url, timeoutMs))
      list.forEach((r, i) => results.set(tags[i], r))
    }
    const stale = () => stopped || version !== roundVersion || states.get(state.id) !== state
    if (stale()) return { skipped: 'stale' }
    for (const [tag, r] of results) state.nodes[tag] = { ...r, round: roundId }
    // 探测结果进公共延迟历史(失败的记一笔超时,通过的内核自己已经记了,scheduler 同步时会看到)
    if (history) {
      try {
        const samples = [...results].filter(([, r]) => r.ok === false).map(([name, r]) => ({ name, time: new Date(r.at).toISOString(), delay: 0 }))
        if (samples.length) history.recordSamples(samples)
      } catch { /* 历史记不上不影响决策 */ }
    }

    // 2. 页签健康(先确认内核还在)
    try { await fetchProxies() } catch { return { skipped: 'kernel' } }
    if (stale()) return { skipped: 'stale' }
    for (const lane of state.lanes) {
      lane.kernelNow = null
      lane.confirmed = null
      if (lane.mode === 'empty') { lane.health = 'down'; continue }
      if (!url) { lane.health = 'unknown'; continue }
      const rs = lane.valid.map((t) => results.get(t))
      const okNodes = lane.valid.filter((t, i) => rs[i] && rs[i].ok === true)
      const allFailed = rs.length > 0 && rs.every((r) => r && r.ok === false)
      if (lane.mode === 'single') {
        lane.health = okNodes.length ? 'up' : allFailed ? 'down' : 'unknown'
        continue
      }
      // 多节点页签:有通过的节点就让内核重选,再确认它实际选中的是通过的节点
      if (!okNodes.length) { lane.health = allFailed ? 'down' : 'unknown'; continue }
      await retestSub(lane.subTag, url, timeoutMs, lane.valid.length)
      if (stale()) return { skipped: 'stale' }
      let sub = null
      try { sub = await fetchProxy(lane.subTag) } catch { /* 读不到就按未确认 */ }
      const kernelNow = sub && typeof sub.now === 'string' ? sub.now : ''
      lane.kernelNow = kernelNow || null
      // 内核可能在刚才那次组内重测里自己又测通了一个我们判失败的节点(探测偶发超时很常见):它有这轮开始
      // 之后的新鲜结果也算确认。要重测之后再读这个节点,重测前的 /proxies 快照里没有那条新结果
      const kernelFresh = await (async () => {
        if (!kernelNow || okNodes.includes(kernelNow)) return false
        let p = null
        try { p = await fetchProxy(kernelNow) } catch { return false }
        const h = p && Array.isArray(p.history) ? p.history[p.history.length - 1] : null
        return Boolean(h && Number.isFinite(Date.parse(h.time)) && Date.parse(h.time) >= startedAt - 1000 && Number(h.delay) > 0)
      })()
      lane.confirmed = Boolean(kernelNow && (okNodes.includes(kernelNow) || kernelFresh))
      lane.health = lane.confirmed ? 'up' : 'unknown'
      if (!lane.confirmed) log(`[failover] ${state.tag} 页签 ${laneRole(lane.index)} 有节点通过但内核实际选中的是 ${kernelNow || '(空)'},这轮算未确认`)
    }

    // 3. 决策
    let parentNow = ''
    try { parentNow = String((await fetchProxy(state.tag))?.now || '') } catch { return { skipped: 'kernel' } }
    if (stale()) return { skipped: 'stale' }
    const current = laneForNow(state, parentNow)
    if (current && current.id !== state.currentLaneId) {
      state.currentLaneId = current.id
      state.currentSince = state.currentSince || now()
    }
    if (!current) state.currentLaneId = null
    const at = now()
    for (const lane of state.lanes) {
      // upSince 是「连续通过」的起点:失败和未知都打断它(未知 = 这轮没测出结果,不能算作还在连续通过;
      // 按顺序重选等 recoveryHoldMs 就靠它计时)。未知不算失败:不增加失败轮数、不触发任何切换
      if (lane.health === 'up') lane.upSince = lane.upSince || at
      else lane.upSince = null
      if (lane.health === 'down') lane.failStreak += 1
      else if (lane.health === 'up') lane.failStreak = 0
    }
    const primary = state.lanes[0] || null
    if (primary && primary.health === 'up') state.primaryUpSince = state.primaryUpSince || at
    else state.primaryUpSince = null

    const firstUp = (exceptId) => state.lanes.find((l) => l.health === 'up' && l.id !== exceptId) || null
    const anyUnknown = state.lanes.some((l) => l.health === 'unknown')
    let target = null
    let reason = ''
    // 按新顺序重选的待办(见 loadMap):新顺序里第一个通过的页签就是该用的;它上面还有未知的页签先不动
    // (等那些页签确认了再说)。用户刚改完顺序、第一次能判断时立刻挪,目标是主用也一样——用户把某个页签排到
    // 第一位就是要用它,不受「恢复后切回」开关和等待时间约束;之后(比如目标当时是失败的、后来才恢复)才按
    // 恢复的规则来:目标是主用走「恢复后切回」(开关 + 等待,关着回切这次重排就算落定),目标是备用和主用恢复
    // 一样等它连续通过满 recoveryHoldMs 再挪,免得刚恢复就来回切。
    // 落定:当前页签就是新顺序里第一个通过的,且它上面没有别的页签(或只有空页签);上面还有确认失败的
    // 页签时待办保留——那是用户明确表达的优先级,它恢复了要挪过去(备用之间平时不这么做)。「校正」
    // (order-unknown)不是用户的动作,当前就是第一个通过的就直接落定
    const unknownAbove = (lane) => state.lanes.some((l) => l.health === 'unknown' && l.index < lane.index)
    const settleReorder = (why) => {
      if (!state.reorder) return
      log(`[failover] ${state.tag}:按页签顺序重选已落定(${why})`)
      state.reorder = null
    }
    // 当前页签就是新顺序里第一个通过的:落定(或记为已判断)。决策前和切换后各看一次,切到位就当轮落定
    const settleIfDone = () => {
      if (!state.reorder) return
      const cur = state.currentLaneId ? laneById(state, state.currentLaneId) : null
      if (!cur || cur.health !== 'up') return
      const preferred = state.lanes.find((l) => l.health === 'up') || null
      if (!preferred || preferred.id !== cur.id || unknownAbove(preferred)) return
      const nothingAbove = state.lanes.every((l) => l.index >= cur.index || l.mode === 'empty')
      if (nothingAbove || state.reorder.reason !== 'priority-changed') settleReorder(`当前已是顺序里第一个通过的页签 ${laneRole(cur.index)}`)
      else state.reorder.evaluated = true
    }
    let reorderMove = false
    if (current && state.reorder) {
      const preferred = state.lanes.find((l) => l.health === 'up') || null
      if (preferred && !unknownAbove(preferred)) {
        if (preferred.id === current.id) {
          settleIfDone()
        } else if (!state.reorder.evaluated && state.reorder.reason === 'priority-changed') {
          target = preferred; reason = 'priority-changed'; reorderMove = true
        } else if (preferred.index === 0) {
          if (!restorePrimary) settleReorder('目标是主用而「恢复后切回」关着')
          else state.reorder.evaluated = true
        } else if (!state.reorder.evaluated || (preferred.upSince !== null && at - preferred.upSince >= holdMs)) {
          target = preferred; reason = 'priority-changed'; reorderMove = true
        } else {
          state.reorder.evaluated = true
        }
      }
    }
    if (target) {
      /* 按新顺序重选已经定了目标 */
    } else if (current) {
      if (current.health === 'up') {
        if (restorePrimary && primary && current.id !== primary.id && primary.health === 'up' && state.primaryUpSince !== null && at - state.primaryUpSince >= holdMs) {
          target = primary; reason = 'restore-primary'
        }
      } else if (current.health === 'down' && current.failStreak >= threshold) {
        const next = firstUp(current.id)
        if (next) { target = next; reason = 'lane-failed' } else if (!anyUnknown && state.rejectTag) { target = { id: null, ref: state.rejectTag }; reason = 'all-failed' }
      }
    } else {
      const next = firstUp(null)
      if (next) { target = next; reason = parentNow === state.rejectTag ? 'recovered' : 'initial' } else if (!anyUnknown && state.rejectTag && parentNow !== state.rejectTag) { target = { id: null, ref: state.rejectTag }; reason = 'all-failed' }
    }

    let switched = null
    if (target && target.ref && target.ref !== parentNow) {
      try {
        const nowRef = await switchTo(state, target.ref)
        if (stale()) return { skipped: 'stale' }
        const from = current ? { laneId: current.id, ref: parentNow } : { laneId: null, ref: parentNow }
        state.currentLaneId = target.id
        state.currentSince = at
        state.lastSwitch = { at, from, to: { laneId: target.id, ref: nowRef }, reason }
        state.lastError = ''
        switched = { from: from.ref, to: nowRef, reason }
        if (reorderMove && state.reorder) state.reorder.evaluated = true
        log(`[failover] ${state.tag}:${from.ref || '(空)'} → ${nowRef}(${reason})`)
      } catch (err) {
        // 切换失败:保留实际状态,下一轮再试(按顺序重选的待办也原样留着,不算已经判断过)
        state.lastError = `切换失败:${errText(err)}`
        log(`[failover] ${state.tag} 切换到 ${target.ref} 失败:${errText(err)}`)
      }
    } else if (target && target.id && target.ref === parentNow && target.id !== state.currentLaneId) {
      // 目标页签引用的出站和内核当前选的是同一个(两个页签都只挂同一个节点):不用切,只把关联挪过去
      state.currentLaneId = target.id
      state.currentSince = at
      if (reorderMove && state.reorder) state.reorder.evaluated = true
      log(`[failover] ${state.tag}:关联改到页签 ${laneRole(target.index)},出站不变(${reason})`)
    }
    settleIfDone()
    // 4. 状态
    const cur = state.currentLaneId ? laneById(state, state.currentLaneId) : null
    const kernelSel = switched ? switched.to : parentNow
    state.kernelNow = kernelSel
    state.status = kernelSel === state.rejectTag || !cur ? 'reject'
      : cur.health === 'up' ? (cur.index === 0 ? 'ok' : 'backup')
        : cur.health === 'down' ? 'failing' : 'unknown'
    state.lastRoundAt = startedAt
    state.lastRoundResult = switched ? `${switched.reason}` : 'kept'
    persist()
    if (history && kernelStartedAt !== undefined) {
      try { history.recordFromProxies(await fetchProxies(), { kernelStartedAt, at: now() }) } catch { /* 忽略 */ }
    }
    // 有页签这轮没能确认内核的选择(内核刚启动、子组自己的首轮检测还没跑完):不等整个 interval,很快再看一次
    const unconfirmed = state.lanes.some((l) => l.confirmed === false)
    return { switched, unconfirmed, status: state.status, lanes: state.lanes.map((l) => [l.id, l.health]) }
  }

  const runTick = async () => {
    if (!(await syncMap())) return { skipped: 'config' }
    if (!states.size) return { skipped: 'none' }
    const due = [...states.values()].filter((g) => !g.inFlight && now() >= g.nextRoundAt)
    if (!due.length) return { skipped: 'idle' }
    let proxies
    try { proxies = await fetchProxies() } catch (err) {
      // 内核不可达 / 正在重启:所有组暂停,不动健康、不动计数;10 秒后再看
      paused = 'kernel'
      lastError = errText(err)
      for (const g of due) { g.paused = 'kernel'; g.nextRoundAt = now() + Math.min(10_000, g.settings?.intervalMs || 10_000) }
      return { skipped: 'kernel' }
    }
    paused = ''
    lastError = ''
    let kernelStartedAt = null
    try { const up = await processUptime(ctx, 'sing-box'); kernelStartedAt = typeof up === 'number' ? now() - up * 1000 : null } catch { /* 没有也行 */ }
    const results = {}
    await Promise.all(due.map(async (g) => {
      g.inFlight = true
      const intervalMs = Math.max(5000, Number(g.settings?.intervalMs) || 30_000)
      try {
        const r = await runRound(g, proxies, kernelStartedAt)
        results[g.tag] = r
        if (r && r.skipped) {
          g.paused = r.skipped === 'kernel-mismatch' || r.skipped === 'parent-missing' ? 'kernel-mismatch' : r.skipped === 'kernel' ? 'kernel' : ''
          // 内核和映射对不上(部署到一半)/ 内核刚倒:很快再看;作废的轮次由新版本自己安排
          if (r.skipped !== 'stale') g.nextRoundAt = now() + Math.min(10_000, intervalMs)
        } else {
          g.paused = ''
          g.nextRoundAt = now() + (r && r.unconfirmed ? Math.min(10_000, intervalMs) : intervalMs)
        }
      } catch (err) {
        g.lastError = errText(err)
        g.nextRoundAt = now() + Math.min(10_000, intervalMs)
        log(`[failover] ${g.tag} 这轮出错:${errText(err)}`)
      } finally {
        g.inFlight = false
      }
    }))
    return { ran: results }
  }

  const tick = async () => {
    if (inTick) return { skipped: 'busy' }
    inTick = true
    try { return await runTick() } finally { inTick = false }
  }

  const start = () => {
    if (timer) return
    stopped = false
    const loop = () => {
      timer = setTimeout(async () => {
        try { await tick() } catch (err) { log(`[failover] tick 出错:${errText(err)}`) }
        if (!stopped) loop()
      }, tickMs)
      if (timer && typeof timer.unref === 'function') timer.unref()
    }
    loop()
  }
  const stop = () => {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
  }
  // 部署 / 组定义改动后让下一 tick 立刻重载映射并重新检测(不等 interval)
  const refresh = () => {
    version = null
    for (const g of states.values()) g.nextRoundAt = 0
  }

  const status = () => ({
    version, paused, lastError, running: !stopped,
    groups: [...states.values()].map((g) => ({
      id: g.id, tag: g.tag, status: g.status, paused: g.paused, lastError: g.lastError, rejectTag: g.rejectTag,
      currentLaneId: g.currentLaneId, currentSince: g.currentSince, kernelNow: g.kernelNow || null,
      lastSwitch: g.lastSwitch, lastRoundAt: g.lastRoundAt || null, nextRoundAt: g.nextRoundAt || null, inFlight: g.inFlight,
      laneOrder: g.laneOrder, reorder: g.reorder || null,
      settings: g.settings,
      lanes: g.lanes.map((l) => ({
        id: l.id, name: l.name, index: l.index, role: laneRole(l.index), mode: l.mode, ref: l.ref, subTag: l.subTag,
        members: l.members, valid: l.valid, health: l.health, failStreak: l.failStreak, upSince: l.upSince,
        kernelNow: l.kernelNow, confirmed: l.confirmed,
        nodes: Object.fromEntries(l.valid.map((t) => [t, g.nodes[t] ? { ok: g.nodes[t].ok, delay: g.nodes[t].delay ?? null, at: g.nodes[t].at, reason: g.nodes[t].reason || null } : null])),
      })),
    })),
  })

  return { start, stop, tick, refresh, status, _states: states }
}
