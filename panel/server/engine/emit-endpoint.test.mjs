import assert from 'node:assert/strict'
import test from 'node:test'
import { emitEndpoint } from './emit-endpoint.mjs'
import { createNode } from './node-model.mjs'

test('wireguard endpoint emit', () => {
  const w = createNode({ tag: 'WG-01', type: 'wireguard', server: 'wg.com', server_port: 51820, fields: { private_key: 'PRIV=', peer_public_key: 'PUB=', local_address: ['10.0.0.2/32'] }, source: 'clash' })
  assert.deepEqual(emitEndpoint(w), {
    type: 'wireguard', tag: 'WG-01', system: false, address: ['10.0.0.2/32'], private_key: 'PRIV=',
    peers: [{ address: 'wg.com', port: 51820, public_key: 'PUB=', allowed_ips: ['0.0.0.0/0', '::/0'] }],
  })
})

test('pre_shared_key 透传', () => {
  const w = createNode({ tag: 'W', type: 'wireguard', server: 'wg.com', server_port: 51820, fields: { private_key: 'p', peer_public_key: 'q', local_address: ['10.0.0.2/32'], pre_shared_key: 'psk' }, source: 'clash' })
  assert.equal(emitEndpoint(w).peers[0].pre_shared_key, 'psk')
})

test('非 wireguard 抛错', () => {
  const n = createNode({ tag: 'x', type: 'trojan', server: 'a', server_port: 1, fields: { password: 'p', tls: { enabled: true } }, source: 'clash' })
  assert.throws(() => emitEndpoint(n), /wireguard/)
})
