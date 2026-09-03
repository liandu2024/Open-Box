import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { buildMonthView, registerTrafficRoutes } from './traffic.mjs'

const startApp = async (collector, now) => {
  const app = express()
  registerTrafficRoutes(app, { collector, now })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

const fakeCollector = () => {
  const data = {
    '2026-09-03': {
      total: { up: 100, down: 900, conns: 7 },
      node: [{ key: 'A', up: 60, down: 500, conns: 4 }, { key: '直连', up: 10, down: 100, conns: 2 }],
      host: [{ key: 'a.com', up: 70, down: 600, conns: 6 }],
    },
  }
  let flushed = 0
  return {
    flushed: () => flushed,
    flush() { flushed += 1 },
    store: {
      month(month) {
        return Object.entries(data).filter(([d]) => d.startsWith(month)).map(([day, v]) => ({ day, ...v.total }))
      },
      dayTotal(day) { return data[day]?.total || null },
      day(day, kind, limit) { return (data[day]?.[kind] || []).slice(0, limit) },
      daySum(day, kind) {
        const rows = data[day]?.[kind] || []
        return { n: rows.length, up: rows.reduce((s, r) => s + r.up, 0), down: rows.reduce((s, r) => s + r.down, 0) }
      },
    },
  }
}

test('buildMonthView:整月补零;日均按已过天数(往月整月、当月到今天、未来 0)', () => {
  const rows = [{ day: '2026-09-03', up: 100, down: 900, conns: 7 }]
  const cur = buildMonthView('2026-09', rows, '2026-09-10')
  assert.equal(cur.days.length, 30)
  assert.deepEqual(cur.days[2], { day: '2026-09-03', up: 100, down: 900, conns: 7 })
  assert.deepEqual(cur.days[0], { day: '2026-09-01', up: 0, down: 0, conns: 0 })
  assert.equal(cur.avgDays, 10)
  assert.deepEqual(cur.avg, { up: 10, down: 90 })
  assert.equal(buildMonthView('2026-08', [], '2026-09-10').avgDays, 31)
  assert.equal(buildMonthView('2026-10', [], '2026-09-10').avgDays, 0)
})

test('GET /traffic/month:缺参数用当月,格式错 400,读之前先 flush', async () => {
  const collector = fakeCollector()
  const { base, close } = await startApp(collector, () => new Date(2026, 8, 3, 10))
  try {
    const r = await fetch(`${base}/api/openbox/traffic/month`)
    const body = await r.json()
    assert.equal(body.month, '2026-09')
    assert.equal(body.today, '2026-09-03')
    assert.deepEqual(body.total, { up: 100, down: 900, conns: 7 })
    assert.equal(collector.flushed(), 1)
    assert.equal((await fetch(`${base}/api/openbox/traffic/month?month=2026-13`)).status, 400)
    assert.equal((await fetch(`${base}/api/openbox/traffic/month?month=2026/09`)).status, 400)
  } finally {
    await close()
  }
})

test('GET /traffic/day:节点/域名明细 + 未采样差额;非法日期 400', async () => {
  const collector = fakeCollector()
  const { base, close } = await startApp(collector, () => new Date(2026, 8, 3, 10))
  try {
    const r = await fetch(`${base}/api/openbox/traffic/day?day=2026-09-03`)
    const body = await r.json()
    assert.equal(body.nodes.length, 2)
    assert.equal(body.hostsCount, 1)
    assert.deepEqual(body.other, { up: 30, down: 300 })
    const empty = await (await fetch(`${base}/api/openbox/traffic/day?day=2026-09-02`)).json()
    assert.deepEqual(empty.total, { up: 0, down: 0, conns: 0 })
    assert.deepEqual(empty.nodes, [])
    assert.equal((await fetch(`${base}/api/openbox/traffic/day?day=2026-09-32`)).status, 400)
    assert.equal((await fetch(`${base}/api/openbox/traffic/day`)).status, 400)
  } finally {
    await close()
  }
})
