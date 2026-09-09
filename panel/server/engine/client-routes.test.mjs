import assert from 'node:assert/strict'
import test from 'node:test'
import { isIpOrCidr, normalizeCidr, normalizeClientRoutes } from './client-routes.mjs'

test('normalizeCidr:裸 IPv4/IPv6 补前缀,网段原样,非法返回空', () => {
  assert.equal(normalizeCidr('10.0.0.209'), '10.0.0.209/32')
  assert.equal(normalizeCidr(' 10.0.0.0/24 '), '10.0.0.0/24')
  assert.equal(normalizeCidr('fd00::1'), 'fd00::1/128')
  assert.equal(normalizeCidr('fd00::/64'), 'fd00::/64')
  for (const bad of ['', '10.0.0.256', '10.0.0.1/33', 'abc', '10.0.0.1/24/1', 'fd00::/129']) assert.equal(normalizeCidr(bad), '', bad)
  assert.ok(isIpOrCidr('192.168.1.5') && !isIpOrCidr('192.168.1'))
})

test('normalizeClientRoutes:停用的、来源全非法的、没出口的都丢掉', () => {
  const list = [
    { id: 'a', enabled: true, name: '电视', sources: ['10.0.0.5', 'bad', '10.0.1.0/24'], outbound: '香港-自动' },
    { id: 'b', enabled: false, name: '关', sources: ['10.0.0.6'], outbound: '直连' },
    { id: 'c', enabled: true, name: '空', sources: ['x'], outbound: '直连' },
    { id: 'd', enabled: true, name: '无出口', sources: ['10.0.0.7'], outbound: '' },
  ]
  assert.deepEqual(normalizeClientRoutes(list), [{ id: 'a', name: '电视', sources: ['10.0.0.5/32', '10.0.1.0/24'], outbound: '香港-自动' }])
  assert.deepEqual(normalizeClientRoutes(null), [])
})

test('IPv6 校验交给 node:net:段数不够、段超 ffff、段数超 8 一律拒;带 zone 的链路本地地址不当网段;IPv4-mapped 收(审核 B6)', () => {
  for (const bad of ['1:2:3', '12345::1', '2001:db8:0:0:0:0:0:0:1', 'fe80::1%eth0', ':::1', '2001:db8::/129', '256.1.1.1']) {
    assert.equal(normalizeCidr(bad), '', bad)
    assert.equal(isIpOrCidr(bad), false, bad)
  }
  assert.equal(normalizeCidr('2001:db8::10'), '2001:db8::10/128')
  assert.equal(normalizeCidr('2001:db8:1234::/48'), '2001:db8:1234::/48')
  assert.equal(normalizeCidr('::ffff:192.168.1.1'), '::ffff:192.168.1.1/128')
})

test('不进内核(bypass):MAC 归一成小写冒号写法、去重、丢掉不合法的;出站写成内置直连的 tag;普通规则原样', async () => {
  const { normalizeClientRoutes, normalizeMac, isMac } = await import('./client-routes.mjs')
  assert.equal(normalizeMac('AA-BB-CC-DD-EE-FF'), 'aa:bb:cc:dd:ee:ff')
  assert.equal(normalizeMac('aa:bb:cc:dd:ee'), '')
  assert.equal(isMac('00:15:5d:03:0a:28'), true)
  const out = normalizeClientRoutes([
    { id: 'sw', name: 'Switch', sources: ['10.0.0.9'], bypass: true, macs: ['AA:BB:CC:DD:EE:FF', 'aa:bb:cc:dd:ee:ff', 'bad'] },
    { id: 'tv', name: 'TV', sources: ['10.0.0.8'], outbound: '香港-自动' },
    { id: 'x', name: 'x', sources: ['10.0.0.7'], bypass: true, macs: ['zz'] },
  ], { directTag: '直连' })
  assert.deepEqual(out, [
    { id: 'sw', name: 'Switch', sources: ['10.0.0.9/32'], outbound: '直连', bypass: true, macs: ['aa:bb:cc:dd:ee:ff'] },
    { id: 'tv', name: 'TV', sources: ['10.0.0.8/32'], outbound: '香港-自动' },
    { id: 'x', name: 'x', sources: ['10.0.0.7/32'], outbound: '直连', bypass: true, macs: [] },
  ])
})
