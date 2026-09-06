import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerLatencyHistoryRoutes } from './latency-history.mjs'
import { createLatencyHistory } from '../system/latency-history.mjs'

const memStore = () => {
  const m = new Map()
  return { getRaw: (k) => (m.has(k) ? m.get(k) : null), setRaw: (k, v) => m.set(k, v), delRaw: (k) => m.delete(k) }
}
const startApp = async (history, scheduler) => {
  const app = express()
  registerLatencyHistoryRoutes(app, { history, scheduler })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

test('GET 整份;POST samples 校验字段并记入;POST sync 让服务端读一次内核再返回整份', async () => {
  const history = createLatencyHistory({ store: memStore() })
  let synced = 0
  const scheduler = { sync: async () => { synced += 1; history.record('B', { time: '2026-09-06T10:00:00.000Z', delay: 50 }) } }
  const { baseUrl, close } = await startApp(history, scheduler)
  try {
    const post = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const ok = await post('/api/openbox/latency-history/samples', { samples: [{ name: 'A', time: '2026-09-06T10:00:00.000Z', delay: 0 }] })
    assert.equal(ok.status, 200)
    assert.deepEqual((await ok.json()).history.A, [{ time: '2026-09-06T10:00:00.000Z', delay: 0 }])
    assert.equal((await post('/api/openbox/latency-history/samples', { samples: [{ name: 'A', time: 'bad', delay: 0 }] })).status, 400)
    assert.equal((await post('/api/openbox/latency-history/samples', { samples: 'x' })).status, 400)
    assert.equal((await post('/api/openbox/latency-history/samples', { samples: [{ name: 'A', time: '2026-09-06T10:00:00.000Z', delay: -1 }] })).status, 400)
    const sync = await post('/api/openbox/latency-history/sync', {})
    assert.equal(sync.status, 200)
    assert.equal(synced, 1)
    assert.deepEqual((await sync.json()).history.B.map((s) => s.delay), [50])
    const get = await fetch(`${baseUrl}/api/openbox/latency-history`)
    assert.deepEqual(Object.keys((await get.json()).history).sort(), ['A', 'B'])
  } finally {
    await close()
  }
})
