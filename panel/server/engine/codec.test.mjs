import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeBase64, isProbablyBase64, parseUri } from './codec.mjs'

test('decodeBase64 标准 + URL-safe + 缺 padding', () => {
  assert.equal(decodeBase64('aGVsbG8='), 'hello')
  assert.equal(decodeBase64('aGVsbG8'), 'hello')            // 缺 padding
  assert.equal(decodeBase64('YT9iPWM_ZA'), 'a?b=c?d')       // URL-safe '_' => '/'
})

test('decodeBase64 UTF-8 中文', () => {
  // base64 of "美国" (UTF-8)
  assert.equal(decodeBase64('576O5Zu9'), '美国')
})

test('isProbablyBase64', () => {
  assert.equal(isProbablyBase64('aGVsbG8gd29ybGQ='), true)
  assert.equal(isProbablyBase64('proxies:\n  - name: x'), false)  // 含 : 空格 换行
  assert.equal(isProbablyBase64('ss://abc'), false)
})

test('parseUri 基本', () => {
  const u = parseUri('vless://11111111-1111-1111-1111-111111111111@a.com:443?type=ws&sni=b.com#美国-01')
  assert.equal(u.scheme, 'vless')
  assert.equal(u.userinfo, '11111111-1111-1111-1111-111111111111')
  assert.equal(u.host, 'a.com')
  assert.equal(u.port, 443)
  assert.equal(u.query.get('type'), 'ws')
  assert.equal(u.fragment, '美国-01')
})

test('parseUri IPv6 主机剥括号', () => {
  const u = parseUri('trojan://pw@[2001:db8::1]:8443#x')
  assert.equal(u.host, '2001:db8::1')
  assert.equal(u.port, 8443)
})

test('parseUri userinfo 带冒号(tuic uuid:password)', () => {
  const u = parseUri('tuic://uuid-x:pass-y@h.com:443?alpn=h3#t')
  assert.equal(u.userinfo, 'uuid-x:pass-y')
})
