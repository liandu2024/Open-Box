import assert from 'node:assert/strict'
import test from 'node:test'
import { createTrafficCollector, createTrafficStore, hostOf, leafOf, localDay, pairKindFor } from './traffic-collector.mjs'

const fakeStore = () => ({
  rows: [],
  add(rows) { this.rows.push(...rows) },
  prune() {},
  month() { return [] },
  dayTotal() { return null },
  day() { return [] },
  daySum() { return { n: 0, up: 0, down: 0 } },
})

const conn = (id, upload, download, chains = ['节点A', '策略'], metadata = { host: 'Example.COM', destinationIP: '1.1.1.1', sourceIP: '10.0.0.9' }) => ({
  id, upload, download, chains, metadata,
})

const at = new Date(2026, 8, 3, 12, 0, 0)

const pendingOf = (collector) => {
  const store = fakeStore()
  collector.store.rows.length = 0
  collector.flush()
  const rows = collector.store.rows
  void store
  return Object.fromEntries(rows.map((r) => [`${r.day}|${r.kind}|${r.key}`, { up: r.up, down: r.down, conns: r.conns }]))
}

test('helpers:chains[0] 是末端节点;host 优先域名(小写)否则目标 IP;localDay 补零', () => {
  assert.equal(leafOf(['破晓 | 香港-04', '香港-自动', '其他']), '破晓 | 香港-04')
  assert.equal(leafOf([]), '')
  assert.equal(hostOf({ host: 'Example.COM', destinationIP: '1.1.1.1' }), 'example.com')
  assert.equal(hostOf({ host: '', destinationIP: '1.1.1.1' }), '1.1.1.1')
  assert.equal(localDay(new Date(2026, 0, 5)), '2026-01-05')
})

test('第一次快照只做基线不计数;之后按增量记 总量/节点/域名,新连接从 0 起算并计一次连接数', () => {
  const store = fakeStore()
  const c = createTrafficCollector({ store, now: () => at })
  c.applySnapshot({ uploadTotal: 1000, downloadTotal: 5000, connections: [conn('a', 100, 400)] }, at)
  assert.equal(c.pendingSize, 0)

  c.applySnapshot({
    uploadTotal: 1300,
    downloadTotal: 6000,
    connections: [conn('a', 150, 900), conn('b', 20, 30, ['直连'], { host: '', destinationIP: '10.0.0.8' })],
  }, at)
  const p = pendingOf(c)
  assert.deepEqual(p['2026-09-03|total|'], { up: 300, down: 1000, conns: 1 })
  assert.deepEqual(p['2026-09-03|node|节点A'], { up: 50, down: 500, conns: 0 })
  assert.deepEqual(p['2026-09-03|host|example.com'], { up: 50, down: 500, conns: 0 })
  assert.deepEqual(p['2026-09-03|node|直连'], { up: 20, down: 30, conns: 1 })
  assert.deepEqual(p['2026-09-03|host|10.0.0.8'], { up: 20, down: 30, conns: 1 })
  // 终端设备:按来源 IP;b 没写 sourceIP,记到空串
  assert.deepEqual(p['2026-09-03|client|10.0.0.9'], { up: 50, down: 500, conns: 0 })
  assert.deepEqual(p['2026-09-03|client|'], { up: 20, down: 30, conns: 1 })
  // 两维交叉:终端\t目标、终端\t节点、节点\t目标,给面板往下钻
  assert.deepEqual(p['2026-09-03|client_host|10.0.0.9\texample.com'], { up: 50, down: 500, conns: 0 })
  assert.deepEqual(p['2026-09-03|client_node|10.0.0.9\t节点A'], { up: 50, down: 500, conns: 0 })
  assert.deepEqual(p['2026-09-03|node_host|节点A\texample.com'], { up: 50, down: 500, conns: 0 })
  assert.deepEqual(p['2026-09-03|node_host|直连\t10.0.0.8'], { up: 20, down: 30, conns: 1 })
  assert.deepEqual(p['2026-09-03|client_host|\t10.0.0.8'], { up: 20, down: 30, conns: 1 })
})

test('pairKindFor:三种交叉表覆盖六种「我是谁 / 按谁拆」组合,同维或未知返回 null', () => {
  assert.deepEqual(pairKindFor('client', 'host'), ['client_host', 0])
  assert.deepEqual(pairKindFor('host', 'client'), ['client_host', 1])
  assert.deepEqual(pairKindFor('node', 'client'), ['client_node', 1])
  assert.deepEqual(pairKindFor('node', 'host'), ['node_host', 0])
  assert.equal(pairKindFor('node', 'node'), null)
  assert.equal(pairKindFor('total', 'node'), null)
})

test('内核重启计数归零:总量按当前值算;消失的连接被遗忘,同 id 再出现当新连接', () => {
  const store = fakeStore()
  const c = createTrafficCollector({ store, now: () => at })
  c.applySnapshot({ uploadTotal: 9000, downloadTotal: 9000, connections: [conn('a', 800, 800)] }, at)
  c.applySnapshot({ uploadTotal: 40, downloadTotal: 60, connections: [] }, at)
  let p = pendingOf(c)
  assert.deepEqual(p['2026-09-03|total|'], { up: 40, down: 60, conns: 0 })

  c.applySnapshot({ uploadTotal: 100, downloadTotal: 100, connections: [conn('a', 5, 7)] }, at)
  p = pendingOf(c)
  assert.deepEqual(p['2026-09-03|node|节点A'], { up: 5, down: 7, conns: 1 })
})

test('增量记到快照发生的那一天;flush 失败时增量放回去不丢', () => {
  const store = fakeStore()
  const c = createTrafficCollector({ store, now: () => at })
  c.applySnapshot({ uploadTotal: 0, downloadTotal: 0, connections: [] }, at)
  c.applySnapshot({ uploadTotal: 10, downloadTotal: 10, connections: [] }, new Date(2026, 8, 4, 0, 0, 1))
  c.applySnapshot({ uploadTotal: 15, downloadTotal: 12, connections: [] }, new Date(2026, 8, 4, 1, 0, 0))
  assert.equal(c.pendingSize, 1)

  store.add = () => { throw new Error('disk full') }
  assert.equal(c.flush(), 0)
  assert.equal(c.pendingSize, 1)
  store.add = function (rows) { this.rows.push(...rows) }
  assert.equal(c.flush(), 1)
  assert.deepEqual(store.rows[0], { day: '2026-09-04', kind: 'total', key: '', up: 15, down: 12, conns: 0 })
})

test('poll:读不到内核只在第一次记日志,恢复后继续', async () => {
  const store = fakeStore()
  const logs = []
  let fail = true
  const fetchImpl = async () => {
    if (fail) throw new Error('ECONNREFUSED')
    return { ok: true, json: async () => ({ uploadTotal: 1, downloadTotal: 1, connections: [] }) }
  }
  const c = createTrafficCollector({ store, fetchImpl, now: () => at, log: (m) => logs.push(m) })
  await c.poll()
  await c.poll()
  assert.equal(logs.length, 1)
  fail = false
  await c.poll()
  assert.equal(logs.length, 2)
})

const sqlite = await import('node:sqlite').then((m) => m).catch(() => null)

test('sqlite store:upsert 累加、按月/按天查询、清理', { skip: !sqlite && '本机 Node 没有 node:sqlite' }, () => {
  const db = new sqlite.DatabaseSync(':memory:')
  const store = createTrafficStore(db)
  store.add([
    { day: '2026-08-31', kind: 'total', key: '', up: 10, down: 20, conns: 2 },
    { day: '2026-08-31', kind: 'node', key: 'A', up: 6, down: 14, conns: 2 },
    { day: '2026-09-01', kind: 'total', key: '', up: 1, down: 1, conns: 1 },
  ])
  store.add([{ day: '2026-08-31', kind: 'total', key: '', up: 5, down: 5, conns: 1 }])
  assert.deepEqual(store.month('2026-08'), [{ day: '2026-08-31', up: 15, down: 25, conns: 3 }])
  assert.deepEqual(store.dayTotal('2026-08-31'), { up: 15, down: 25, conns: 3 })
  assert.deepEqual(store.day('2026-08-31', 'node', 10), [{ key: 'A', up: 6, down: 14, conns: 2 }])
  assert.deepEqual(store.daySum('2026-08-31', 'node'), { n: 1, up: 6, down: 14 })
  store.prune('2026-09-01')
  assert.deepEqual(store.month('2026-08'), [])
  assert.equal(store.month('2026-09').length, 1)
})

test('sqlite store:交叉表按前一维 / 后一维查构成,含空串 key;交叉表单独清理', { skip: !sqlite && '本机 Node 没有 node:sqlite' }, () => {
  const db = new sqlite.DatabaseSync(':memory:')
  const store = createTrafficStore(db)
  store.add([
    { day: '2026-09-03', kind: 'client_host', key: '10.0.0.9\ta.com', up: 1, down: 10, conns: 1 },
    { day: '2026-09-03', kind: 'client_host', key: '10.0.0.9\tb.com', up: 2, down: 30, conns: 1 },
    { day: '2026-09-03', kind: 'client_host', key: '10.0.0.90\ta.com', up: 5, down: 50, conns: 1 },
    { day: '2026-09-03', kind: 'client_host', key: '\ta.com', up: 7, down: 70, conns: 1 },
    { day: '2026-09-03', kind: 'node_host', key: '香港 | 01\ta.com', up: 3, down: 3, conns: 1 },
    { day: '2026-09-02', kind: 'client_host', key: '10.0.0.9\ta.com', up: 9, down: 9, conns: 1 },
    { day: '2026-09-02', kind: 'client', key: '10.0.0.9', up: 9, down: 9, conns: 1 },
  ])
  // 终端 10.0.0.9 按访问目标拆:只拿它自己的两条(10.0.0.90 是别的终端),按总量倒序
  assert.deepEqual(store.drill('2026-09-03', 'client', '10.0.0.9', 'host', 10), {
    rows: [{ key: 'b.com', up: 2, down: 30, conns: 1 }, { key: 'a.com', up: 1, down: 10, conns: 1 }],
    count: 2,
    sum: { up: 3, down: 40 },
  })
  // limit 截行时 sum 不受影响(父行总量减 sum = 没记到交叉表里的部分)
  assert.deepEqual(store.drill('2026-09-03', 'client', '10.0.0.9', 'host', 1).sum, { up: 3, down: 40 })
  // 访问目标 a.com 按终端拆:后一维匹配,包括来源为空串的
  const byClient = store.drill('2026-09-03', 'host', 'a.com', 'client', 10)
  assert.deepEqual(byClient.rows.map((r) => r.key), ['', '10.0.0.90', '10.0.0.9'])
  assert.equal(byClient.count, 3)
  assert.deepEqual(store.drill('2026-09-03', 'host', 'a.com', 'node', 10).rows, [{ key: '香港 | 01', up: 3, down: 3, conns: 1 }])
  // limit 只截行,count 还是全部
  assert.deepEqual(store.drill('2026-09-03', 'host', 'a.com', 'client', 1).count, 3)
  assert.equal(store.drill('2026-09-03', 'host', 'a.com', 'client', 1).rows.length, 1)
  assert.deepEqual(store.drill('2026-09-03', 'node', 'node', 'node', 10), { rows: [], count: 0, sum: { up: 0, down: 0 } })
  // 交叉表单独清理,单维的不动
  store.prunePairs('2026-09-03')
  assert.deepEqual(store.drill('2026-09-02', 'client', '10.0.0.9', 'host', 10), { rows: [], count: 0, sum: { up: 0, down: 0 } })
  assert.deepEqual(store.day('2026-09-02', 'client', 10), [{ key: '10.0.0.9', up: 9, down: 9, conns: 1 }])
})
