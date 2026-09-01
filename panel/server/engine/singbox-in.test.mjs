import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSingboxOutbounds } from './singbox-in.mjs'

const doc = JSON.stringify({
  outbounds: [
    { type: 'shadowsocks', tag: 'SS-US', server: 'us.com', server_port: 8388, method: 'aes-256-gcm', password: 'pw' },
    { type: 'vless', tag: 'VL', server: 'v.com', server_port: 443, uuid: 'u', tls: { enabled: true, server_name: 'v.com' } },
    { type: 'selector', tag: 'PROXY', outbounds: ['SS-US', 'VL'] },
    { type: 'direct', tag: 'direct' },
    // 换成仍不支持的 ssh(anytls 现已支持),继续覆盖"未知代理类型计入 skipped"
    { type: 'ssh', tag: 'SSH', server: 'a.com', server_port: 22 },
  ],
})

test('parseSingboxOutbounds 只取代理节点,忽略 selector/direct,未知代理计入 skipped', () => {
  const { nodes, skipped } = parseSingboxOutbounds(doc)
  assert.deepEqual(nodes.map((n) => n.originalTag).sort(), ['SS-US', 'VL'])
  assert.equal(nodes.find((n) => n.originalTag === 'SS-US').fields.method, 'aes-256-gcm')
  assert.deepEqual(skipped, [{ name: 'SSH', type: 'ssh' }])
})

test('从 endpoints 采 wireguard', () => {
  const doc = JSON.stringify({
    endpoints: [{ type: 'wireguard', tag: 'WG', address: ['10.0.0.2/32'], private_key: 'PRIV=', peers: [{ address: 'wg.com', port: 51820, public_key: 'PUB=', allowed_ips: ['0.0.0.0/0'] }] }],
    outbounds: [{ type: 'shadowsocks', tag: 'SS', server: 's.com', server_port: 8388, method: 'aes-256-gcm', password: 'pw' }],
  })
  const { nodes } = parseSingboxOutbounds(doc)
  const wg = nodes.find((n) => n.originalTag === 'WG')
  assert.equal(wg.type, 'wireguard')
  assert.equal(wg.server, 'wg.com')
  assert.equal(wg.server_port, 51820)
  assert.equal(wg.fields.private_key, 'PRIV=')
  assert.equal(wg.fields.peer_public_key, 'PUB=')
  assert.deepEqual(wg.fields.local_address, ['10.0.0.2/32'])
})
