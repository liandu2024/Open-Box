import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { checkServerPort, parseProcNet, registerServerRoutes } from './servers.mjs'
import { createMockContext } from '../system/context.mjs'

const TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:07EA 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 0 0 0 0 0 0 0
   1: 0100007F:1F90 0100007F:C350 01 00000000:00000000 00:00000000 00000000     0        0 2 0 0 0 0 0 0 0
`
const UDP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops
   0: 00000000:20FD 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 3 2 0 0
`

test('parseProcNet:端口是十六进制,TCP 只算 LISTEN(0A),UDP 全算', async () => {
  assert.deepEqual(parseProcNet(TCP), [{ port: 2026, state: '0A' }, { port: 8080, state: '01' }])
  const ctx = createMockContext({ files: { '/proc/net/tcp': TCP, '/proc/net/udp': UDP } })
  const { listeningPorts } = await import('./servers.mjs')
  const ports = await listeningPorts(ctx)
  assert.ok(ports.has(2026) && ports.has(8445) && !ports.has(8080))
})

test('checkServerPort:保留端口 / 别的服务器 / 路由器在监听 / 自己原来的端口不算', async () => {
  const ctx = createMockContext({ files: { '/proc/net/tcp': TCP, '/proc/net/udp': UDP } })
  const store = { getProfile: () => ({ servers: [{ id: 'a', name: 'SS', port: 8388 }, { id: 'h', name: 'HY', port: 8445 }] }) }
  assert.deepEqual(await checkServerPort({ store, ctx }, { port: 2026, id: 'x' }), { ok: false, reason: 'reserved' })
  assert.deepEqual(await checkServerPort({ store, ctx }, { port: 8388, id: 'x' }), { ok: false, reason: 'server', name: 'SS' })
  assert.deepEqual(await checkServerPort({ store, ctx }, { port: 8445, id: 'h' }), { ok: true })
  assert.deepEqual(await checkServerPort({ store: { getProfile: () => ({ servers: [] }) }, ctx }, { port: 8445, id: 'x' }), { ok: false, reason: 'listening' })
  assert.deepEqual(await checkServerPort({ store, ctx }, { port: 9000, id: 'x' }), { ok: true })
  assert.deepEqual(await checkServerPort({ store, ctx }, { port: 70000, id: 'x' }), { ok: false, reason: 'invalid' })
})

test('GET /servers/port-check', async () => {
  const app = express()
  registerServerRoutes(app, { store: { getProfile: () => ({ servers: [] }) }, ctx: createMockContext({ files: { '/proc/net/tcp': TCP } }) })
  const srv = app.listen(0)
  await new Promise((r) => srv.once('listening', r))
  try {
    const base = `http://127.0.0.1:${srv.address().port}`
    assert.deepEqual(await (await fetch(`${base}/api/openbox/servers/port-check?port=2026`)).json(), { ok: false, reason: 'reserved' })
    assert.deepEqual(await (await fetch(`${base}/api/openbox/servers/port-check?port=9000&id=a`)).json(), { ok: true })
  } finally {
    await new Promise((r) => srv.close(r))
  }
})
