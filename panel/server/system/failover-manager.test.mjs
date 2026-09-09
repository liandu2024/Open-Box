import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { configMetaPath } from './deploy.mjs'
import { createFailoverManager, FAILOVER_STATE_KEY, laneRole } from './failover-manager.mjs'

const paths = createPaths('/opt/open-box')
const T0 = Date.parse('2026-09-09T10:00:00+08:00')
const iso = (t) => new Date(t).toISOString()
const URL = 'https://www.gstatic.com/generate_204'

const memStore = () => {
  const m = new Map()
  return { getRaw: (k) => (m.has(k) ? m.get(k) : null), setRaw: (k, v) => m.set(k, v), delRaw: (k) => m.delete(k), getClashSecret: () => 's', _m: m }
}

// 运行映射:主用 = 两个节点(内部 urltest 子组),备用 1 = 单节点,备用 2 = 两个节点
const mapping = (over = {}) => ({
  id: 'fo1', tag: '主备', rejectTag: '拒绝',
  lanes: [
    { id: 'A', name: '', index: 0, members: ['a1', 'a2'], valid: ['a1', 'a2'], mode: 'urltest', ref: '__fo:fo1:A', subTag: '__fo:fo1:A' },
    { id: 'B', name: '', index: 1, members: ['b1'], valid: ['b1'], mode: 'single', ref: 'b1', subTag: null },
    { id: 'C', name: '', index: 2, members: ['c1', 'c2'], valid: ['c1', 'c2'], mode: 'urltest', ref: '__fo:fo1:C', subTag: '__fo:fo1:C' },
  ],
  settings: { interval: '30s', intervalMs: 30_000, tolerance: 100, testUrl: URL, timeoutMs: 5000, failureThreshold: 2, restorePrimary: true, recoveryHoldMs: 60_000 },
  ...over,
})
const metaJson = (generatedAt, failover = [mapping()]) => JSON.stringify({ generatedAt, failover })

// 可脚本化的假内核:节点好坏由 down 集合决定;/proxies/<node>/delay 按它给 200 或 504,并像 sing-box 一样
// 成功写 history、失败删 history;/group/<sub>/delay 按 history 重选最小延迟;PUT /proxies/<parent> 改 now
const kernel = (clock) => {
  const down = new Set()
  // 我们的单节点探测偶发超时、内核随后自己的组内重测又通过了的节点(现实里很常见)
  const flaky = new Set()
  const delays = { a1: 80, a2: 120, b1: 200, c1: 300, c2: 310 }
  const proxies = {
    a1: { type: 'ss', history: [] }, a2: { type: 'ss', history: [] }, b1: { type: 'ss', history: [] },
    c1: { type: 'ss', history: [] }, c2: { type: 'ss', history: [] },
    '拒绝': { type: 'Reject', history: [] },
    '__fo:fo1:A': { type: 'URLTest', all: ['a1', 'a2'], now: 'a1', history: [] },
    '__fo:fo1:C': { type: 'URLTest', all: ['c1', 'c2'], now: 'c1', history: [] },
    '主备': { type: 'Selector', all: ['__fo:fo1:A', 'b1', '__fo:fo1:C', '拒绝'], now: '__fo:fo1:A', history: [] },
  }
  const calls = []
  let reachable = true
  let refuseSwitch = false
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  const reselect = (tag) => {
    const g = proxies[tag]
    let best = null
    for (const m of g.all) {
      const h = proxies[m].history
      const last = h[h.length - 1]
      if (!last) continue
      if (!best || last.delay < best.delay) best = { m, delay: last.delay }
    }
    if (best) g.now = best.m
  }
  const fetchImpl = async (url, init = {}) => {
    const u = String(url)
    calls.push(`${init.method || 'GET'} ${u.replace('http://127.0.0.1:9095', '')}`)
    if (!reachable) throw new Error('ECONNREFUSED')
    const path = decodeURIComponent(u.replace('http://127.0.0.1:9095', ''))
    if (path === '/proxies') return json(200, { proxies: JSON.parse(JSON.stringify(proxies)) })
    let m
    if ((m = path.match(/^\/proxies\/([^/?]+)\/delay\?/))) {
      const tag = m[1]
      if (!proxies[tag]) return json(404, { message: 'Proxy not found' })
      if (down.has(tag) || flaky.has(tag)) { proxies[tag].history = []; return json(504, { message: 'Timeout' }) }
      proxies[tag].history = [{ time: iso(clock()), delay: delays[tag] }]
      return json(200, { delay: delays[tag] })
    }
    if ((m = path.match(/^\/proxies\/([^/?]+)$/))) {
      const p = proxies[m[1]]
      if (!p) return json(404, { message: 'Proxy not found' })
      if (init.method === 'PUT') {
        if (refuseSwitch) return json(400, { message: 'refused' })
        const name = JSON.parse(init.body).name
        if (!p.all || !p.all.includes(name)) return json(400, { message: 'Proxy does not exist' })
        p.now = name
        return json(204, {})
      }
      return json(200, JSON.parse(JSON.stringify(p)))
    }
    if ((m = path.match(/^\/group\/([^/?]+)\/delay\?/))) {
      const g = proxies[m[1]]
      if (!g) return json(404, {})
      // force=false:刚测过(30 秒内)的成员跳过;没测过的按 down 集合测
      for (const mem of g.all) {
        const last = proxies[mem].history[proxies[mem].history.length - 1]
        if (last && clock() - Date.parse(last.time) < 30_000) continue
        if (down.has(mem)) proxies[mem].history = []
        else proxies[mem].history = [{ time: iso(clock()), delay: delays[mem] }]
      }
      reselect(m[1])
      return json(200, {})
    }
    throw new Error('unexpected ' + path)
  }
  return {
    proxies, calls, down, flaky, fetchImpl,
    setReachable: (v) => { reachable = v }, setRefuseSwitch: (v) => { refuseSwitch = v },
    now: () => proxies['主备'].now,
  }
}

const setup = ({ metaAt = 'v1', failover } = {}) => {
  let clock = T0
  const k = kernel(() => clock)
  const store = memStore()
  const ctx = createMockContext({ files: { [configMetaPath(paths)]: metaJson(metaAt, failover) }, execResults: { 'pidof sing-box': { code: 1, stdout: '' } } })
  const logs = []
  const mgr = createFailoverManager({ store, ctx, paths, fetchImpl: k.fetchImpl, now: () => clock, log: (m) => logs.push(m) })
  const advance = (ms) => { clock += ms }
  const round = async (ms = 30_000) => { advance(ms); return mgr.tick() }
  return { k, store, ctx, mgr, logs, advance, round, clock: () => clock }
}
const lanes = (mgr) => Object.fromEntries(mgr.status().groups[0].lanes.map((l) => [l.id, l.health]))
const group = (mgr) => mgr.status().groups[0]

test('laneRole:第一个是主用,后面依次备用', () => {
  assert.equal(laneRole(0), 'primary')
  assert.equal(laneRole(2), 'backup-2')
})

test('首轮:全部通过 → 留在主用(内核默认就是主用),状态 ok;状态里能看到页签、有效节点和探测结果', async () => {
  const { k, mgr, store } = setup()
  const r = await mgr.tick()
  assert.equal(r.ran['主备'].switched, null)
  assert.deepEqual(lanes(mgr), { A: 'up', B: 'up', C: 'up' })
  const g = group(mgr)
  assert.equal(g.status, 'ok')
  assert.equal(g.currentLaneId, 'A')
  assert.equal(g.kernelNow, '__fo:fo1:A')
  assert.equal(k.now(), '__fo:fo1:A')
  assert.deepEqual(g.lanes.map((l) => l.role), ['primary', 'backup-1', 'backup-2'])
  assert.equal(g.lanes[0].nodes.a1.ok, true)
  assert.equal(g.lanes[0].nodes.a1.delay, 80)
  // 每个节点只探测一次(a1 a2 b1 c1 c2),多节点页签各触发一次组内重选
  assert.equal(k.calls.filter((c) => /\/proxies\/[^/]+\/delay/.test(c)).length, 5)
  assert.equal(k.calls.filter((c) => c.includes('/group/')).length, 2)
  // 关联按页签 id 存下来了
  assert.equal(JSON.parse(store.getRaw(FAILOVER_STATE_KEY)).groups.fo1.laneId, 'A')
})

test('验收 8:主用里一个节点失败、另一个仍可用 → 流量留在主用页签,内核子组切到可用节点,外层不动', async () => {
  const { k, mgr, round } = setup()
  await mgr.tick()
  k.down.add('a1')
  const r = await round()
  assert.equal(r.ran['主备'].switched, null)
  assert.equal(lanes(mgr).A, 'up')
  assert.equal(k.now(), '__fo:fo1:A')
  assert.equal(k.proxies['__fo:fo1:A'].now, 'a2', '内核子组应已重选到 a2')
  assert.equal(group(mgr).lanes[0].kernelNow, 'a2')
  assert.equal(group(mgr).lanes[0].confirmed, true)
  assert.equal(group(mgr).status, 'ok')
})

test('验收 9:主用全部失败达到阈值(2 轮)才转到第一个可用备用;它再失败则转到下一个候选', async () => {
  const { k, mgr, round } = setup()
  await mgr.tick()
  k.down.add('a1'); k.down.add('a2')
  let r = await round()
  assert.equal(r.ran['主备'].switched, null, '第 1 轮失败还没到阈值,不切')
  assert.equal(lanes(mgr).A, 'down')
  assert.equal(group(mgr).status, 'failing')
  assert.equal(k.now(), '__fo:fo1:A')
  r = await round()
  assert.deepEqual(r.ran['主备'].switched, { from: '__fo:fo1:A', to: 'b1', reason: 'lane-failed' })
  assert.equal(k.now(), 'b1')
  assert.equal(group(mgr).currentLaneId, 'B')
  assert.equal(group(mgr).status, 'backup')
  assert.equal(group(mgr).lastSwitch.reason, 'lane-failed')
  // 备用 1 也倒了 → 两轮后转到备用 2
  k.down.add('b1')
  await round()
  assert.equal(k.now(), 'b1')
  r = await round()
  assert.deepEqual(r.ran['主备'].switched, { from: 'b1', to: '__fo:fo1:C', reason: 'lane-failed' })
  assert.equal(group(mgr).currentLaneId, 'C')
})

test('验收 10:主用持续恢复满 60 秒才切回;短暂恢复又失败不来回切;关闭回切时留在健康的备用', async () => {
  const { k, mgr, round } = setup()
  await mgr.tick()
  k.down.add('a1'); k.down.add('a2')
  await round(); await round()
  assert.equal(k.now(), 'b1')
  // 主用恢复:第 1 轮(0s)只是记下恢复时刻,第 2 轮(30s)不够 60s,第 3 轮(60s)切回
  k.down.clear()
  let r = await round()
  assert.equal(r.ran['主备'].switched, null)
  assert.equal(lanes(mgr).A, 'up')
  r = await round()
  assert.equal(r.ran['主备'].switched, null)
  // 又倒了:等待时间重新计算
  k.down.add('a1'); k.down.add('a2')
  r = await round()
  assert.equal(r.ran['主备'].switched, null)
  assert.equal(k.now(), 'b1')
  k.down.clear()
  await round(); await round()
  assert.equal(k.now(), 'b1', '恢复后 30 秒还不够 60 秒')
  r = await round()
  assert.deepEqual(r.ran['主备'].switched, { from: 'b1', to: '__fo:fo1:A', reason: 'restore-primary' })
  assert.equal(group(mgr).status, 'ok')

  // 关闭回切
  const off = setup({ failover: [mapping({ settings: { ...mapping().settings, restorePrimary: false } })] })
  await off.mgr.tick()
  off.k.down.add('a1'); off.k.down.add('a2')
  await off.round(); await off.round()
  assert.equal(off.k.now(), 'b1')
  off.k.down.clear()
  for (let i = 0; i < 5; i++) await off.round()
  assert.equal(off.k.now(), 'b1', '关闭回切:主用恢复也留在健康的备用')
  assert.equal(group(off.mgr).status, 'backup')
})

test('验收 11:全部失败 → 切到兜底拒绝、状态 reject,继续定期检查;有候选恢复就切回去', async () => {
  const { k, mgr, round } = setup()
  await mgr.tick()
  for (const t of ['a1', 'a2', 'b1', 'c1', 'c2']) k.down.add(t)
  await round()
  const r = await round()
  assert.deepEqual(r.ran['主备'].switched, { from: '__fo:fo1:A', to: '拒绝', reason: 'all-failed' })
  assert.equal(k.now(), '拒绝')
  assert.equal(group(mgr).status, 'reject')
  assert.equal(group(mgr).currentLaneId, null)
  // 只有备用 2 恢复 → 立刻用它(不需要阈值:拒绝状态下有可用候选就切)
  k.down.delete('c1')
  const r2 = await round()
  assert.deepEqual(r2.ran['主备'].switched, { from: '拒绝', to: '__fo:fo1:C', reason: 'recovered' })
  assert.equal(group(mgr).status, 'backup')
})

test('验收 11:内核 API 不可达时暂停,不把基础设施故障记成节点失败;恢复后照常', async () => {
  const { k, mgr, round } = setup()
  await mgr.tick()
  k.setReachable(false)
  const r = await round()
  assert.equal(r.skipped, 'kernel')
  assert.equal(mgr.status().paused, 'kernel')
  assert.deepEqual(lanes(mgr), { A: 'up', B: 'up', C: 'up' }, '健康不动')
  assert.equal(group(mgr).lanes[0].failStreak, 0)
  k.setReachable(true)
  const r2 = await round(10_000)
  assert.ok(r2.ran && r2.ran['主备'], '10 秒后重试')
  assert.equal(mgr.status().paused, '')
})

test('未知不算失败:探测服务对某个节点报 500(不是 503/504)→ 该页签未知,不计失败轮数、不切换', async () => {
  const { k, mgr, round } = setup()
  await mgr.tick()
  const origin = k.fetchImpl
  const flaky = async (url, init) => {
    if (String(url).includes('/proxies/a1/delay') || String(url).includes('/proxies/a2/delay')) return { ok: false, status: 500, json: async () => ({}) }
    return origin(url, init)
  }
  const mgr2 = createFailoverManager({ store: memStore(), ctx: createMockContext({ files: { [configMetaPath(paths)]: metaJson('v1') }, execResults: { 'pidof sing-box': { code: 1 } } }), paths, fetchImpl: flaky, now: () => T0, log: () => {} })
  await mgr2.tick()
  assert.equal(lanes(mgr2).A, 'unknown')
  assert.equal(group(mgr2).lanes[0].failStreak, 0)
  assert.equal(k.now(), '__fo:fo1:A')
  assert.equal(group(mgr2).status, 'unknown')
  void round
})

test('我们的探测偶发超时、内核组内重测又通过并仍选着它 → 按内核的新鲜结果确认页签通过,不切换', async () => {
  const { k, mgr, round } = setup()
  await mgr.tick()
  // a1 是延迟最低的,内核选着它;我们这轮探测它超时,但内核紧接着的组内重测通过(history 是重测后新写的)
  k.flaky.add('a1')
  const r = await round()
  assert.equal(r.ran['主备'].switched, null)
  assert.equal(group(mgr).lanes[0].kernelNow, 'a1')
  assert.equal(group(mgr).lanes[0].confirmed, true)
  assert.equal(lanes(mgr).A, 'up')
  assert.equal(group(mgr).lanes[0].nodes.a1.ok, false, '我们自己的探测结果照实记')
  assert.equal(k.now(), '__fo:fo1:A')
})

test('多节点页签有节点通过但内核实际选中的还是坏节点且没新结果 → 这轮算未确认(未知),不宣布恢复', async () => {
  const { k, mgr, round } = setup()
  await mgr.tick()
  k.down.add('a1')
  // 让内核的组重选失灵:/group 接口什么都不做
  const origin = k.fetchImpl
  const stuck = async (url, init) => {
    if (String(url).includes('/group/')) return { ok: true, status: 200, json: async () => ({}) }
    return origin(url, init)
  }
  const mgr2 = createFailoverManager({ store: memStore(), ctx: createMockContext({ files: { [configMetaPath(paths)]: metaJson('v1') }, execResults: { 'pidof sing-box': { code: 1 } } }), paths, fetchImpl: stuck, now: () => T0 + 60_000, log: () => {} })
  await mgr2.tick()
  assert.equal(group(mgr2).lanes[0].kernelNow, 'a1')
  assert.equal(group(mgr2).lanes[0].confirmed, false)
  assert.equal(lanes(mgr2).A, 'unknown')
  void round
})

test('验收 12:配置版本变了 → 重载映射、旧关联按页签 id 恢复但健康重测;组从映射里消失就不再管;空页签永远不可用', async () => {
  const { k, mgr, ctx, round, store } = setup()
  await mgr.tick()
  k.down.add('a1'); k.down.add('a2')
  await round(); await round()
  assert.equal(k.now(), 'b1')
  // 重新部署:主用页签变成单节点 a2(a1 被订阅删了),备用 2 变空;内核重启后 selector 按 cache 仍在 b1
  const v2 = mapping({ lanes: [
    { id: 'A', name: '', index: 0, members: ['a1', 'a2'], valid: ['a2'], mode: 'single', ref: 'a2', subTag: null },
    { id: 'B', name: '', index: 1, members: ['b1'], valid: ['b1'], mode: 'single', ref: 'b1', subTag: null },
    { id: 'C', name: '', index: 2, members: ['c1'], valid: [], mode: 'empty', ref: null, subTag: null },
  ] })
  ctx.files[configMetaPath(paths)] = metaJson('v2', [v2])
  k.proxies['主备'].all = ['a2', 'b1', '拒绝']
  delete k.proxies['__fo:fo1:A']; delete k.proxies['__fo:fo1:C']
  const r = await round()
  assert.equal(mgr.status().version, 'v2')
  const g = group(mgr)
  assert.equal(g.currentLaneId, 'B', '按页签 id 恢复关联')
  assert.deepEqual(lanes(mgr), { A: 'down', B: 'up', C: 'down' })
  assert.equal(r.ran['主备'].switched, null)
  // a2 恢复:单节点主用 → 满 60s 切回 a2(不是旧的子组 tag)
  k.down.delete('a2')
  await round(); await round()
  const r2 = await round()
  assert.deepEqual(r2.ran['主备'].switched, { from: 'b1', to: 'a2', reason: 'restore-primary' })
  // 组被删:映射空
  ctx.files[configMetaPath(paths)] = metaJson('v3', [])
  const r3 = await round()
  assert.equal(r3.skipped, 'none')
  assert.deepEqual(mgr.status().groups, [])
  assert.deepEqual(JSON.parse(store.getRaw(FAILOVER_STATE_KEY)).groups, {})
})

test('验收 12:部署到一半(映射已更新、内核还是旧出站)→ 这轮跳过、不切换,10 秒后再看', async () => {
  const { k, mgr, ctx, round } = setup()
  await mgr.tick()
  ctx.files[configMetaPath(paths)] = metaJson('v2', [mapping({ lanes: [
    { id: 'A', name: '', index: 0, members: ['a1', 'a2'], valid: ['a1', 'a2'], mode: 'urltest', ref: '__fo:fo1:A', subTag: '__fo:fo1:A' },
    { id: 'B', name: '', index: 1, members: ['b1', 'b2'], valid: ['b1', 'b2'], mode: 'urltest', ref: '__fo:fo1:B', subTag: '__fo:fo1:B' },
  ] })])
  const r = await round()
  assert.equal(r.ran['主备'].skipped, 'kernel-mismatch')
  assert.equal(group(mgr).paused, 'kernel-mismatch')
  assert.equal(k.calls.filter((c) => c.startsWith('PUT')).length, 0)
  const before = k.calls.length
  await round(5_000)
  assert.equal(k.calls.length, before, '还没到 10 秒不重试')
  await round(5_000)
  assert.ok(k.calls.length > before)
})

test('验收 12:轮次进行中配置版本变了 → 旧轮次结果作废,不操作新配置', async () => {
  const { k, mgr, ctx, round } = setup()
  await mgr.tick()
  k.down.add('a1'); k.down.add('a2')
  await round()
  // 第二轮探测过程中部署了新版本
  const origin = k.fetchImpl
  let flipped = false
  k.fetchImpl = async (url, init) => {
    if (!flipped && String(url).includes('/proxies/b1/delay')) {
      flipped = true
      ctx.files[configMetaPath(paths)] = metaJson('v2')
    }
    return origin(url, init)
  }
  const mgr2 = createFailoverManager({ store: memStore(), ctx, paths, fetchImpl: (u, i) => k.fetchImpl(u, i), now: () => T0 + 90_000, log: () => {} })
  // 新管理器先载入 v1(文件此刻还是 v1)…
  ctx.files[configMetaPath(paths)] = metaJson('v1')
  await mgr2.tick()
  // …再跑一轮时中途变成 v2:这轮作废
  ctx.files[configMetaPath(paths)] = metaJson('v1')
  const p = mgr2.tick()
  const r = await p
  assert.ok(r.ran === undefined || r.skipped || Object.values(r.ran).every((x) => x.skipped === 'stale' || x.switched === null))
  assert.equal(k.calls.filter((c) => c.startsWith('PUT')).length, 0)
  void round
})

test('切换失败(PUT 被拒)→ 保留实际状态并记原因,下一轮再试', async () => {
  const { k, mgr, round } = setup()
  await mgr.tick()
  k.down.add('a1'); k.down.add('a2')
  await round()
  k.setRefuseSwitch(true)
  const r = await round()
  assert.equal(r.ran['主备'].switched, null)
  assert.equal(k.now(), '__fo:fo1:A')
  assert.match(group(mgr).lastError, /切换失败/)
  assert.equal(group(mgr).currentLaneId, 'A')
  k.setRefuseSwitch(false)
  const r2 = await round()
  assert.equal(r2.ran['主备'].switched.to, 'b1')
  assert.equal(group(mgr).lastError, '')
})

test('没部署过(meta 不存在)→ 没有组可管,不报错;stop 后不再跑', async () => {
  const store = memStore()
  const ctx = createMockContext({ files: {}, execResults: {} })
  const mgr = createFailoverManager({ store, ctx, paths, fetchImpl: async () => { throw new Error('no') }, now: () => T0, log: () => {} })
  const r = await mgr.tick()
  assert.equal(r.skipped, 'config')
  assert.equal(mgr.status().paused, 'config')
  mgr.start(); mgr.stop()
  assert.equal(mgr.status().running, false)
})
