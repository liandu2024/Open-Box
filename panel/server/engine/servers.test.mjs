import assert from 'node:assert/strict'
import test from 'node:test'
import { buildServerInbounds, configNeedsTlsKeypair, serverFirewallProto, serverWanExposed } from './servers.mjs'

const tls = { certPath: '/c.crt', keyPath: '/c.key' }

test('四种协议各自的入站;停用的不出;TUIC/HY2 带自签 TLS,VLESS 按开关', () => {
  const servers = [
    { id: 'a', enabled: true, name: 'ss', protocol: 'shadowsocks', port: 8388, method: 'aes-256-gcm', password: 'pw' },
    { id: 'b', enabled: true, name: 'vl', protocol: 'vless', port: 8443, uuid: '11111111-1111-4111-8111-111111111111', tls: true },
    { id: 'c', enabled: true, name: 'vl2', protocol: 'vless', port: 8444, uuid: '11111111-1111-4111-8111-111111111111', tls: false },
    { id: 'd', enabled: true, name: 'tu', protocol: 'tuic', port: 8445, uuid: '11111111-1111-4111-8111-111111111111', password: 'pw' },
    { id: 'e', enabled: true, name: 'hy', protocol: 'hysteria2', port: 8446, password: 'pw', obfs: 'salt' },
    { id: 'f', enabled: false, name: 'off', protocol: 'shadowsocks', port: 8447, method: 'aes-256-gcm', password: 'pw' },
  ]
  const inbounds = buildServerInbounds(servers, tls)
  assert.deepEqual(inbounds.map((i) => i.tag), ['share-a', 'share-b', 'share-c', 'share-d', 'share-e'])
  assert.deepEqual(inbounds[0], { type: 'shadowsocks', tag: 'share-a', listen: '::', listen_port: 8388, method: 'aes-256-gcm', password: 'pw' })
  assert.equal(inbounds[1].tls.certificate_path, '/c.crt')
  assert.equal(inbounds[2].tls, undefined)
  assert.deepEqual(inbounds[3].tls.alpn, ['h3'])
  assert.equal(inbounds[3].congestion_control, 'bbr')
  assert.deepEqual(inbounds[4].obfs, { type: 'salamander', password: 'salt' })
  assert.ok(configNeedsTlsKeypair({ inbounds }))
  assert.ok(!configNeedsTlsKeypair({ inbounds: [inbounds[0], inbounds[2]] }))
  assert.equal(serverFirewallProto(servers[0]), 'tcp udp')
  assert.equal(serverFirewallProto(servers[1]), 'tcp')
  assert.equal(serverFirewallProto(servers[4]), 'udp')
})

test('mixed:SOCKS5 + HTTP 共用一个端口;填了用户名才带认证;只走 TCP、不在 WAN 放行', () => {
  const inbounds = buildServerInbounds([
    { id: 'm1', enabled: true, name: 'open', protocol: 'mixed', port: 7080 },
    { id: 'm2', enabled: true, name: 'auth', protocol: 'mixed', port: 7081, username: 'u', password: 'p' },
  ], tls)
  assert.deepEqual(inbounds[0], { type: 'mixed', tag: 'share-m1', listen: '::', listen_port: 7080 })
  assert.deepEqual(inbounds[1].users, [{ username: 'u', password: 'p' }])
  assert.ok(!configNeedsTlsKeypair({ inbounds }))
  assert.equal(serverFirewallProto({ protocol: 'mixed' }), 'tcp')
  assert.equal(serverWanExposed({ protocol: 'mixed' }), false)
  assert.equal(serverWanExposed({ protocol: 'shadowsocks' }), true)
})
