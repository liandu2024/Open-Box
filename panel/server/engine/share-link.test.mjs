import assert from 'node:assert/strict'
import test from 'node:test'
import { buildShareLink, shareTokenFor, shareTokenMatches } from './share-link.mjs'

test('四种协议的分享链接;没地址就空;IPv6 地址加方括号', () => {
  assert.equal(buildShareLink({ id: 'a', name: 'ss', protocol: 'shadowsocks', port: 8388, address: 'h.com', method: 'aes-256-gcm', password: 'pw' }),
    `ss://${Buffer.from('aes-256-gcm:pw').toString('base64')}@h.com:8388#ss`)
  assert.match(buildShareLink({ id: 'b', name: 'v', protocol: 'vless', port: 8443, address: '1.2.3.4', uuid: 'u', tls: true }), /^vless:\/\/u@1\.2\.3\.4:8443\?encryption=none&security=tls&sni=open-box\.local&allowInsecure=1&type=tcp#v$/)
  assert.match(buildShareLink({ id: 'c', name: 't', protocol: 'tuic', port: 8444, address: 'fd00::1', uuid: 'u', password: 'p' }), /^tuic:\/\/u:p@\[fd00::1\]:8444\?/)
  assert.match(buildShareLink({ id: 'd', name: 'h', protocol: 'hysteria2', port: 8445, address: 'h.com', password: 'p', obfs: 's' }), /obfs=salamander&obfs-password=s#h$/)
  assert.equal(buildShareLink({ id: 'e', name: 'x', protocol: 'shadowsocks', port: 1, address: '' }), '')
})

test('订阅令牌:凭据一变令牌就变;比对用常量时间', () => {
  const s = { id: 'a', password: 'pw' }
  const t = shareTokenFor('secret', s)
  assert.equal(t.length, 24)
  assert.ok(shareTokenMatches('secret', s, t))
  assert.ok(!shareTokenMatches('secret', { ...s, password: 'other' }, t))
  assert.ok(!shareTokenMatches('other-secret', s, t))
  assert.ok(!shareTokenMatches('secret', s, 'short'))
})
