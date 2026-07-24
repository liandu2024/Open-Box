import assert from 'node:assert/strict'
import test from 'node:test'
import { emitOutbound } from './emit-outbound.mjs'
import { createNode } from './node-model.mjs'

test('shadowsocks emit', () => {
  const n = createNode({ tag: '美国-01', type: 'shadowsocks', server: 'a.com', server_port: 8388, fields: { method: 'aes-256-gcm', password: 'pw' }, source: 'clash' })
  assert.deepEqual(emitOutbound(n), { type: 'shadowsocks', tag: '美国-01', server: 'a.com', server_port: 8388, method: 'aes-256-gcm', password: 'pw' })
})

test('vmess emit 带 ws + tls', () => {
  const n = createNode({ tag: 'JP-01', type: 'vmess', server: 'a.com', server_port: 443, fields: { uuid: 'u', alter_id: 0, security: 'auto', transport: { type: 'ws', path: '/vm', headers: { Host: 'cdn.com' } }, tls: { enabled: true, server_name: 'a.com' } }, source: 'sharelink' })
  const o = emitOutbound(n)
  assert.equal(o.type, 'vmess'); assert.equal(o.uuid, 'u'); assert.equal(o.alter_id, 0); assert.equal(o.security, 'auto')
  assert.deepEqual(o.transport, { type: 'ws', path: '/vm', headers: { Host: 'cdn.com' } })
  assert.deepEqual(o.tls, { enabled: true, server_name: 'a.com' })
})

test('vless reality emit 强制补 utls', () => {
  const n = createNode({ tag: 'R-01', type: 'vless', server: 'a.com', server_port: 443, fields: { uuid: 'u', flow: 'xtls-rprx-vision', tls: { enabled: true, server_name: 'a.com', reality: { enabled: true, public_key: 'PK', short_id: 'ab' } } }, source: 'sharelink' })
  const o = emitOutbound(n)
  assert.equal(o.flow, 'xtls-rprx-vision')
  assert.equal(o.tls.reality.public_key, 'PK')
  assert.equal(o.tls.utls.enabled, true)          // 强制补
  assert.equal(o.tls.utls.fingerprint, 'chrome')
})

test('hysteria2 obfs / tuic emit', () => {
  const h = createNode({ tag: 'H', type: 'hysteria2', server: 'a.com', server_port: 8443, fields: { password: 'pw', tls: { enabled: true, server_name: 'a.com' }, obfs: { type: 'salamander', password: 'op' } }, source: 'sharelink' })
  assert.deepEqual(emitOutbound(h).obfs, { type: 'salamander', password: 'op' })
  const t = createNode({ tag: 'T', type: 'tuic', server: 'a.com', server_port: 443, fields: { uuid: 'u', password: 'pw', congestion_control: 'bbr', tls: { enabled: true, server_name: 'a.com', alpn: ['h3'] } }, source: 'sharelink' })
  const to = emitOutbound(t)
  assert.equal(to.congestion_control, 'bbr'); assert.deepEqual(to.tls.alpn, ['h3'])
})

test('wireguard 走 emitOutbound 抛错', () => {
  const w = createNode({ tag: 'W', type: 'wireguard', server: 'a.com', server_port: 51820, fields: { private_key: 'p', peer_public_key: 'q', local_address: ['10.0.0.2/32'] }, source: 'clash' })
  assert.throws(() => emitOutbound(w), /endpoint/)
})
