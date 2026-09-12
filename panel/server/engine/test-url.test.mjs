import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_DIRECT_TEST_URL, DEFAULT_TEST_URL, ensureTestUrlDefaults, kernelTestUrl } from './test-url.mjs'
import { createStore } from '../store/openbox-store.mjs'

const memStore = () => {
  const m = new Map()
  return createStore({ get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), del: (k) => m.delete(k) })
}

test('kernelTestUrl 保留用户指定的协议、主机、端口、路径和参数，不替换成其他检测地址', () => {
  for (const url of [
    'http://cp.cloudflare.com/generate_204', 'HTTP://example.com:8080/x?q=1',
    'https://cp.cloudflare.com/generate_204', 'http://www.msftconnecttest.com/connecttest.txt',
  ]) assert.equal(kernelTestUrl(` ${url} `), url)
  assert.equal(kernelTestUrl(''), '')
  assert.equal(kernelTestUrl(undefined), '')
  assert.equal(kernelTestUrl('not a url'), 'not a url')
  assert.ok(DEFAULT_TEST_URL.startsWith('http://') && DEFAULT_DIRECT_TEST_URL.startsWith('http://'))
})

test('新档案默认 HTTP；旧版内置 HTTPS 默认迁移为 HTTP，重复启动不再写入', () => {
  const fresh = memStore()
  assert.equal(ensureTestUrlDefaults(fresh), false)
  assert.equal(fresh.getProfile().testUrl, DEFAULT_TEST_URL)
  assert.equal(fresh.getProfile().directTestUrl, DEFAULT_DIRECT_TEST_URL)
  const old = memStore()
  old.setProfile({ testUrl: 'https://www.gstatic.com/generate_204', directTestUrl: 'https://connectivitycheck.platform.hicloud.com/generate_204' })
  assert.equal(ensureTestUrlDefaults(old), true)
  assert.equal(old.getProfile().testUrl, DEFAULT_TEST_URL)
  assert.equal(old.getProfile().directTestUrl, DEFAULT_DIRECT_TEST_URL)
  assert.equal(ensureTestUrlDefaults(old), false)
})

test('保留自定义 HTTP 和 HTTPS 地址；兼容早期直连默认值', () => {
  const custom = memStore()
  custom.setProfile({ testUrl: 'http://cp.cloudflare.com/generate_204', directTestUrl: 'https://example.com/204' })
  assert.equal(ensureTestUrlDefaults(custom), false)
  assert.equal(custom.getProfile().testUrl, 'http://cp.cloudflare.com/generate_204')
  assert.equal(custom.getProfile().directTestUrl, 'https://example.com/204')
  custom.setProfile({ directTestUrl: 'http://www.msftconnecttest.com/connecttest.txt' })
  assert.equal(ensureTestUrlDefaults(custom), true)
  assert.equal(custom.getProfile().directTestUrl, DEFAULT_DIRECT_TEST_URL)
})
