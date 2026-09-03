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
