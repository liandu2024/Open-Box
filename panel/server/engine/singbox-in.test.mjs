import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSingboxOutbounds } from './singbox-in.mjs'

const doc = JSON.stringify({
  outbounds: [
    { type: 'shadowsocks', tag: 'SS-US', server: 'us.com', server_port: 8388, method: 'aes-256-gcm', password: 'pw' },
    { type: 'vless', tag: 'VL', server: 'v.com', server_port: 443, uuid: 'u', tls: { enabled: true, server_name: 'v.com' } },
    { type: 'selector', tag: 'PROXY', outbounds: ['SS-US', 'VL'] },
    { type: 'direct', tag: 'direct' },
    { type: 'anytls', tag: 'AT', server: 'a.com', server_port: 443 },
  ],
})

test('parseSingboxOutbounds 只取代理节点,忽略 selector/direct,未知代理计入 skipped', () => {
  const { nodes, skipped } = parseSingboxOutbounds(doc)
  assert.deepEqual(nodes.map((n) => n.originalTag).sort(), ['SS-US', 'VL'])
  assert.equal(nodes.find((n) => n.originalTag === 'SS-US').fields.method, 'aes-256-gcm')
  assert.deepEqual(skipped, [{ name: 'AT', type: 'anytls' }])
})
