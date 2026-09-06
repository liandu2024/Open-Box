import assert from 'node:assert/strict'
import test from 'node:test'
import { createLatencyHistory, LATENCY_HISTORY_KEY, MAX_SAMPLES } from './latency-history.mjs'

const memStore = () => {
  const m = new Map()
  return { getRaw: (k) => (m.has(k) ? m.get(k) : null), setRaw: (k, v) => m.set(k, v), delRaw: (k) => m.delete(k), raw: m }
}
const T0 = Date.parse('2026-09-06T21:00:00+08:00')
const at = (min) => new Date(T0 + min * 60_000).toISOString()
const node = (history) => ({ type: 'Shadowsocks', history })

test('记一笔:同一时间不重复、乱序按时间排、最多 10 条,落到 openbox/latency-history', () => {
  const store = memStore()
  const h = createLatencyHistory({ store })
  assert.equal(h.record('A', { time: at(1), delay: 100 }), true)
  assert.equal(h.record('A', { time: at(1), delay: 100 }), false)
  assert.equal(h.record('A', { time: at(0), delay: 90 }), true)
  assert.deepEqual(h.get().A.map((s) => s.delay), [90, 100])
  for (let i = 2; i < 20; i++) h.record('A', { time: at(i), delay: i })
  assert.equal(h.get().A.length, MAX_SAMPLES)
  assert.equal(h.get().A[MAX_SAMPLES - 1].delay, 19)
  h.flush()
  assert.deepEqual(JSON.parse(store.raw.get(LATENCY_HISTORY_KEY)).A.length, MAX_SAMPLES)
  // 非法样本一律不收
  assert.equal(h.record('A', { time: 'bad', delay: 1 }), false)
  assert.equal(h.record('', { time: at(30), delay: 1 }), false)
  assert.equal(h.record('A', { time: at(30), delay: -1 }), false)
})

test('从 /proxies 记:最新一条变了就记;有结果→没结果 = 内核测速超时,记 0;组按当时选中的节点记', () => {
  const h = createLatencyHistory({ store: memStore() })
  h.recordFromProxies({ A: node([{ time: at(0), delay: 120 }]), B: node([{ time: at(0), delay: 80 }]), G: { all: ['A', 'B'], now: 'A', history: [] } }, { kernelStartedAt: T0 - 3_600_000, at: T0 })
  assert.deepEqual(h.get().A.map((s) => s.delay), [120])
  assert.deepEqual(h.get().G, [{ time: at(0), delay: 120, node: 'A' }])
  // A 这次没结果了(内核删了),B 有新结果
  h.recordFromProxies({ A: node([]), B: node([{ time: at(5), delay: 85 }]) }, { kernelStartedAt: T0 - 3_600_000, at: T0 + 6 * 60_000 })
  assert.deepEqual(h.get().A.map((s) => s.delay), [120, 0])
  assert.deepEqual(h.get().B.map((s) => s.delay), [80, 85])
  // 已经是超时状态,历史还是空 → 不重复记
  h.recordFromProxies({ A: node([]) }, { kernelStartedAt: T0 - 3_600_000, at: T0 + 12 * 60_000 })
  assert.deepEqual(h.get().A.map((s) => s.delay), [120, 0])
})

test('内核重启清空历史不算超时;拿不到启动时刻时大面积同时清空也不算,个别清空照记', () => {
  const h = createLatencyHistory({ store: memStore() })
  h.recordFromProxies({ A: node([{ time: at(0), delay: 100 }]) }, { kernelStartedAt: T0 - 1000, at: T0 })
  h.recordFromProxies({ A: node([]) }, { kernelStartedAt: T0 + 60_000, at: T0 + 120_000 })   // 上次记录之后重启过
  assert.deepEqual(h.get().A.map((s) => s.delay), [100])
  const m = createLatencyHistory({ store: memStore() })
  const four = { D: node([{ time: at(0), delay: 1 }]), E: node([{ time: at(0), delay: 1 }]), F: node([{ time: at(0), delay: 1 }]), G: node([{ time: at(0), delay: 1 }]) }
  m.recordFromProxies(four, { kernelStartedAt: null, at: T0 })
  m.recordFromProxies({ D: node([]), E: node([]), F: node([]), G: node([]) }, { kernelStartedAt: null, at: T0 + 300_000 })
  assert.ok(['D', 'E', 'F', 'G'].every((n) => m.get()[n].length === 1), '大面积清空当成重启')
  m.recordFromProxies({ D: node([]), E: node([{ time: at(5), delay: 1 }]), F: node([{ time: at(5), delay: 1 }]), G: node([{ time: at(5), delay: 1 }]) }, { kernelStartedAt: null, at: T0 + 300_000 })
  assert.deepEqual(m.get().D.map((s) => s.delay), [1, 0])
})

test('同一节点 60 秒内的两笔超时当一笔(不同来源在同一事件上各记一笔);recordSamples 批量;prune 只留现存节点', () => {
  const h = createLatencyHistory({ store: memStore() })
  h.record('A', { time: at(0), delay: 100 })
  assert.equal(h.recordSamples([{ name: 'A', time: at(5), delay: 0 }, { name: 'B', time: at(5), delay: 50 }, { name: 'C', time: 'x', delay: 1 }]), true)
  assert.equal(h.record('A', { time: new Date(T0 + 5 * 60_000 + 20_000).toISOString(), delay: 0 }), false)
  assert.equal(h.record('A', { time: at(7), delay: 0 }), true)
  assert.deepEqual(h.get().A.map((s) => s.delay), [100, 0, 0])
  assert.equal(h.prune(['A']), 1)
  assert.deepEqual(Object.keys(h.get()), ['A'])
})

test('组按当时选中的节点记:切了节点下一笔是新节点的;切到早就测过的节点用观察时刻;选中节点没结果记超时', () => {
  const h = createLatencyHistory({ store: memStore() })
  const K = T0 - 3_600_000
  const proxies = (now, aHist, bHist) => ({
    A: node(aHist), B: node(bHist),
    G: { type: 'URLTest', all: ['A', 'B'], now, history: [] },
    // 选组的组:一路下钻到节点
    S: { type: 'Selector', all: ['G'], now: 'G', history: [] },
  })
  h.recordFromProxies(proxies('A', [{ time: at(0), delay: 100 }], [{ time: at(0), delay: 200 }]), { kernelStartedAt: K, at: T0 })
  assert.deepEqual(h.get().G, [{ time: at(0), delay: 100, node: 'A' }])
  assert.deepEqual(h.get().S, [{ time: at(0), delay: 100, node: 'A' }])
  // A 又测了一次 → 组多一笔 A
  h.recordFromProxies(proxies('A', [{ time: at(5), delay: 110 }], [{ time: at(0), delay: 200 }]), { kernelStartedAt: K, at: T0 + 5 * 60_000 })
  assert.deepEqual(h.get().G.map((s) => [s.delay, s.node]), [[100, 'A'], [110, 'A']])
  // 同一份数据再来一遍 → 不重复
  h.recordFromProxies(proxies('A', [{ time: at(5), delay: 110 }], [{ time: at(0), delay: 200 }]), { kernelStartedAt: K, at: T0 + 6 * 60_000 })
  assert.equal(h.get().G.length, 2)
  // 切到 B:B 的结果(at 0)比组上一笔(at 5)还旧 → 用观察时刻(at 7),排在最后
  h.recordFromProxies(proxies('B', [{ time: at(5), delay: 110 }], [{ time: at(0), delay: 200 }]), { kernelStartedAt: K, at: T0 + 7 * 60_000 })
  assert.deepEqual(h.get().G.map((s) => [s.time, s.delay, s.node]), [[at(0), 100, 'A'], [at(5), 110, 'A'], [at(7), 200, 'B']])
  // B 没结果了、但 A 还有结果:组会切走,不记超时(切走时记 A 那笔)
  h.recordFromProxies(proxies('B', [{ time: at(5), delay: 110 }], []), { kernelStartedAt: K, at: T0 + 12 * 60_000 })
  assert.equal(h.get().G.length, 3)
  // 全组都没结果、无处可切 → 记一笔超时;再来不重复
  h.recordFromProxies(proxies('B', [], []), { kernelStartedAt: K, at: T0 + 13 * 60_000 })
  h.recordFromProxies(proxies('B', [], []), { kernelStartedAt: K, at: T0 + 14 * 60_000 })
  assert.deepEqual(h.get().G.slice(-1).map((s) => [s.time, s.delay, s.node]), [[at(13), 0, 'B']])
  assert.equal(h.get().G.length, 4)
  // 节点自己的时间线照旧不带 node
  assert.ok(h.get().A.every((s) => s.node === undefined))
})

test('组不记超时:选中节点超时、别的成员还有结果 → 等它切走记新节点那笔;成员是组的也一路看到叶子', () => {
  const h = createLatencyHistory({ store: memStore() })
  const K = T0 - 3_600_000
  const proxies = (now, aHist, bHist) => ({ A: node(aHist), B: node(bHist), G: { type: 'URLTest', all: ['A', 'B'], now, history: [] } })
  h.recordFromProxies(proxies('A', [{ time: at(0), delay: 100 }], [{ time: at(0), delay: 120 }]), { kernelStartedAt: K, at: T0 })
  // A 的探测超时了,组这一眼还挂在 A 上
  h.recordFromProxies(proxies('A', [], [{ time: at(0), delay: 120 }]), { kernelStartedAt: K, at: T0 + 5 * 60_000 })
  // 5 秒后这轮结束,组切到 B
  h.recordFromProxies(proxies('B', [], [{ time: at(0), delay: 120 }]), { kernelStartedAt: K, at: T0 + 5 * 60_000 + 5000 })
  assert.deepEqual(h.get().G.map((s) => [s.delay, s.node]), [[100, 'A'], [120, 'B']])
  // 节点 A 自己的时间线照样记了超时
  assert.deepEqual(h.get().A.map((s) => s.delay), [100, 0])
  // 成员是组:外层组选着内层组,内层组的成员还有结果,外层也不记超时
  const nested = createLatencyHistory({ store: memStore() })
  const p2 = (inner, aHist, bHist) => ({ A: node(aHist), B: node(bHist), G: { type: 'URLTest', all: ['A', 'B'], now: inner, history: [] }, S: { type: 'Selector', all: ['G'], now: 'G', history: [] } })
  nested.recordFromProxies(p2('A', [{ time: at(0), delay: 100 }], [{ time: at(0), delay: 120 }]), { kernelStartedAt: K, at: T0 })
  nested.recordFromProxies(p2('A', [], [{ time: at(0), delay: 120 }]), { kernelStartedAt: K, at: T0 + 60_000 })
  assert.deepEqual(nested.get().S.map((s) => [s.delay, s.node]), [[100, 'A']])
})
