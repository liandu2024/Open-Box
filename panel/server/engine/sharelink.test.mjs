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

test('vless:// ws+tls', () => {
  const n = parseShareLink('vless://22222222-2222-2222-2222-222222222222@v.example.com:443?encryption=none&security=tls&sni=v.example.com&type=ws&path=%2Fvl&host=cdn.v.com&flow=xtls-rprx-vision#VL-US')
  assert.equal(n.type, 'vless')
  assert.equal(n.server, 'v.example.com')
  assert.equal(n.server_port, 443)
  assert.equal(n.fields.uuid, '22222222-2222-2222-2222-222222222222')
  assert.equal(n.fields.flow, 'xtls-rprx-vision')
  assert.equal(n.fields.transport.type, 'ws')
  assert.equal(n.fields.transport.path, '/vl')
  assert.equal(n.fields.transport.headers.Host, 'cdn.v.com')
  assert.equal(n.fields.tls.enabled, true)
  assert.equal(n.fields.tls.server_name, 'v.example.com')
})

test('trojan:// tls', () => {
  const n = parseShareLink('trojan://secretpw@t.example.com:443?sni=t.example.com&type=tcp#TJ-JP')
  assert.equal(n.type, 'trojan')
  assert.equal(n.fields.password, 'secretpw')
  assert.equal(n.fields.tls.enabled, true)
  assert.equal(n.fields.tls.server_name, 't.example.com')
})

test('hysteria2:// 与 hy2 别名 + obfs', () => {
  const a = parseShareLink('hysteria2://authpw@h.example.com:8443?sni=h.example.com&obfs=salamander&obfs-password=xyz#HY2')
  assert.equal(a.type, 'hysteria2')
  assert.equal(a.fields.password, 'authpw')
  assert.equal(a.fields.tls.server_name, 'h.example.com')
  assert.equal(a.fields.obfs.type, 'salamander')
  assert.equal(a.fields.obfs.password, 'xyz')
  const b = parseShareLink('hy2://authpw@h.example.com:8443#HY2b')
  assert.equal(b.type, 'hysteria2')
})

test('tuic:// uuid:password', () => {
  const n = parseShareLink('tuic://33333333-3333-3333-3333-333333333333:tpass@tu.example.com:443?congestion_control=bbr&sni=tu.example.com&alpn=h3#TUIC')
  assert.equal(n.type, 'tuic')
  assert.equal(n.fields.uuid, '33333333-3333-3333-3333-333333333333')
  assert.equal(n.fields.password, 'tpass')
  assert.equal(n.fields.congestion_control, 'bbr')
  assert.equal(n.fields.tls.server_name, 'tu.example.com')
  assert.deepEqual(n.fields.tls.alpn, ['h3'])
})

test('trojan:// 密码含百分号编码字符需解码(修复1)', () => {
  const n = parseShareLink('trojan://p%40ss%23word@t.com:443#PW')
  assert.equal(n.fields.password, 'p@ss#word')
})

test('tuic:// uuid:password 含百分号编码字符需分别解码(修复1)', () => {
  const n = parseShareLink('tuic://33333333-3333-3333-3333-333333333333:p%40ss%3Aw@tu.example.com:443#TUIC2')
  assert.equal(n.fields.uuid, '33333333-3333-3333-3333-333333333333')
  assert.equal(n.fields.password, 'p@ss:w')
})

test('ss:// SIP002 SS-2022 明文 userinfo(method:password,非 base64)(修复2)', () => {
  const n = parseShareLink('ss://2022-blake3-aes-256-gcm:vfOznL8Sc9U=@example.com:8388#SS2022')
  assert.equal(n.type, 'shadowsocks')
  assert.equal(n.fields.method, '2022-blake3-aes-256-gcm')
  assert.equal(n.fields.password, 'vfOznL8Sc9U=')
  assert.equal(n.server, 'example.com')
  assert.equal(n.server_port, 8388)
})

test('ss:// SIP002 IPv6 主机剥括号(修复3)', () => {
  const b = Buffer.from('aes-256-gcm:secretpw').toString('base64')
  const n = parseShareLink(`ss://${b}@[2001:db8::1]:8443#SSv6`)
  assert.equal(n.server, '2001:db8::1')
  assert.equal(n.server_port, 8443)
})

test('vless reality + utls + alpn 字段采集', () => {
  const n = parseShareLink('vless://11111111-1111-1111-1111-111111111111@a.com:443?security=reality&pbk=abcPUBKEY&sid=0123&fp=chrome&type=tcp&flow=xtls-rprx-vision#R')
  assert.equal(n.fields.tls.reality.public_key, 'abcPUBKEY')
  assert.equal(n.fields.tls.reality.short_id, '0123')
  assert.equal(n.fields.tls.utls.fingerprint, 'chrome')
  assert.equal(n.fields.tls.reality.enabled, true)
  assert.equal(n.fields.tls.utls.enabled, true)
})

test('insecure 采集', () => {
  const n = parseShareLink('trojan://pw@a.com:443?sni=a.com&allowInsecure=1#I')
  assert.equal(n.fields.tls.insecure, true)
})

test('h2 传输归一为 http', () => {
  const n = parseShareLink('vless://11111111-1111-1111-1111-111111111111@a.com:443?security=tls&sni=a.com&type=h2&path=%2Fp&host=h.com#H')
  assert.equal(n.fields.transport.type, 'http')
  assert.equal(n.fields.transport.path, '/p')
})

test('vmess:// net:h2 传输归一为 http(修复1)', () => {
  const conf = { v: '2', ps: 'H2-01', add: 'h2.example.com', port: '443', id: '11111111-1111-1111-1111-111111111111', aid: '0', net: 'h2', path: '/vm-h2', host: 'cdn-h2.example.com', scy: 'auto' }
  const b = Buffer.from(JSON.stringify(conf)).toString('base64')
  const n = parseShareLink(`vmess://${b}`)
  assert.equal(n.type, 'vmess')
  assert.equal(n.fields.transport.type, 'http')
  assert.equal(n.fields.transport.path, '/vm-h2')
  assert.equal(n.fields.transport.headers.Host, 'cdn-h2.example.com')
})

test('allowInsecure=true 变体也应置 insecure(修复6)', () => {
  const n = parseShareLink('trojan://pw@a.com:443?sni=a.com&allowInsecure=true#I2')
  assert.equal(n.fields.tls.insecure, true)
})
