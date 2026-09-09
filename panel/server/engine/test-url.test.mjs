import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_DIRECT_TEST_URL, DEFAULT_TEST_URL, ensureTestUrlDefaults, kernelTestUrl } from './test-url.mjs'
import { createStore } from '../store/openbox-store.mjs'

const memStore = () => {
  const m = new Map()
  return createStore({ get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), del: (k) => m.delete(k) })
}

test('kernelTestUrl:http:// 升 https://,https 原样,老默认值换新默认,空 / 非法原样', () => {
  assert.equal(kernelTestUrl('http://cp.cloudflare.com/generate_204'), 'https://cp.cloudflare.com/generate_204')
  assert.equal(kernelTestUrl(' HTTP://example.com/x '), 'https://example.com/x')
  assert.equal(kernelTestUrl('https://cp.cloudflare.com/generate_204'), 'https://cp.cloudflare.com/generate_204')
  assert.equal(kernelTestUrl('http://www.gstatic.com/generate_204'), DEFAULT_TEST_URL)
  assert.equal(kernelTestUrl('http://www.msftconnecttest.com/connecttest.txt'), DEFAULT_DIRECT_TEST_URL)
  assert.equal(kernelTestUrl(''), '')
  assert.equal(kernelTestUrl(undefined), '')
  assert.equal(kernelTestUrl('not a url'), 'not a url')
  assert.ok(DEFAULT_TEST_URL.startsWith('https://') && DEFAULT_DIRECT_TEST_URL.startsWith('https://'))
})

test('ensureTestUrlDefaults:新档案默认就是 https,不写;老的 http 默认值换成新默认;用户自己改过的不动', () => {
  const fresh = memStore()
  assert.equal(ensureTestUrlDefaults(fresh), false)
  assert.equal(fresh.getProfile().testUrl, DEFAULT_TEST_URL)
  assert.equal(fresh.getProfile().directTestUrl, DEFAULT_DIRECT_TEST_URL)

  const old = memStore()
  old.setProfile({ testUrl: 'http://www.gstatic.com/generate_204', directTestUrl: 'http://www.msftconnecttest.com/connecttest.txt' })
  assert.equal(ensureTestUrlDefaults(old), true)
  assert.equal(old.getProfile().testUrl, DEFAULT_TEST_URL)
  assert.equal(old.getProfile().directTestUrl, DEFAULT_DIRECT_TEST_URL)
  assert.equal(ensureTestUrlDefaults(old), false)

  const custom = memStore()
  custom.setProfile({ testUrl: 'http://cp.cloudflare.com/generate_204', directTestUrl: 'http://www.msftconnecttest.com/connecttest.txt' })
  assert.equal(ensureTestUrlDefaults(custom), true)
  assert.equal(custom.getProfile().testUrl, 'http://cp.cloudflare.com/generate_204', '用户自己填的 http 地址存档不动,发给内核时才升 https')
  assert.equal(custom.getProfile().directTestUrl, DEFAULT_DIRECT_TEST_URL)
})
