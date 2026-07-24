import assert from 'node:assert/strict'
import test from 'node:test'
import { parseShareLink } from './sharelink.mjs'

test('ss:// SIP002(userinfo 为 base64 的 method:password)', () => {
  // base64("aes-256-gcm:secretpw") = YWVzLTI1Ni1nY206c2VjcmV0cHc=
  const n = parseShareLink('ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388#香港节点')
  assert.equal(n.type, 'shadowsocks')
  assert.equal(n.server, 'example.com')
  assert.equal(n.server_port, 8388)
  assert.equal(n.fields.method, 'aes-256-gcm')
  assert.equal(n.fields.password, 'secretpw')
  assert.equal(n.originalTag, '香港节点')
  assert.equal(n.source, 'sharelink')
})

test('ss:// 全 base64 旧格式', () => {
  // base64("aes-128-gcm:pw@1.2.3.4:8888")
  const b = Buffer.from('aes-128-gcm:pw@1.2.3.4:8888').toString('base64')
  const n = parseShareLink(`ss://${b}#节点A`)
  assert.equal(n.fields.method, 'aes-128-gcm')
  assert.equal(n.fields.password, 'pw')
  assert.equal(n.server, '1.2.3.4')
  assert.equal(n.server_port, 8888)
})

test('vmess:// v2rayN base64(JSON)', () => {
  const conf = { v: '2', ps: '美国-01', add: 'us.example.com', port: '443', id: '11111111-1111-1111-1111-111111111111', aid: '0', net: 'ws', path: '/vm', host: 'cdn.example.com', tls: 'tls', sni: 'us.example.com', scy: 'auto' }
  const b = Buffer.from(JSON.stringify(conf)).toString('base64')
  const n = parseShareLink(`vmess://${b}`)
  assert.equal(n.type, 'vmess')
  assert.equal(n.server, 'us.example.com')
  assert.equal(n.server_port, 443)
  assert.equal(n.fields.uuid, '11111111-1111-1111-1111-111111111111')
  assert.equal(n.fields.alter_id, 0)
  assert.equal(n.fields.security, 'auto')
  assert.equal(n.fields.transport.type, 'ws')
  assert.equal(n.fields.transport.path, '/vm')
  assert.equal(n.fields.transport.headers.Host, 'cdn.example.com')
  assert.equal(n.fields.tls.enabled, true)
  assert.equal(n.fields.tls.server_name, 'us.example.com')
  assert.equal(n.originalTag, '美国-01')
})

test('未知协议返回 null', () => {
  assert.equal(parseShareLink('anytls://whatever@a.com:443#x'), null)
  assert.equal(parseShareLink('not-a-uri'), null)
})
