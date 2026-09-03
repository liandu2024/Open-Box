import assert from 'node:assert/strict'
import test from 'node:test'
import { createSubscriptionFetch, hasInsecureFlag } from './insecure-fetch.mjs'

test('hasInsecureFlag:只认片段里的 insecure/allowInsecure 等开关', () => {
  assert.equal(hasInsecureFlag('https://1.2.3.4/sub/x#insecure=1'), true)
  assert.equal(hasInsecureFlag('https://1.2.3.4/sub/x#insecure'), true)
  assert.equal(hasInsecureFlag('https://1.2.3.4/sub/x#a=1&allowInsecure=true'), true)
  assert.equal(hasInsecureFlag('https://1.2.3.4/sub/x#skip-cert-verify=1'), true)
  assert.equal(hasInsecureFlag('https://1.2.3.4/sub/x#insecure=0'), false)
  assert.equal(hasInsecureFlag('https://1.2.3.4/sub/x?insecure=1'), false)
  assert.equal(hasInsecureFlag('https://1.2.3.4/sub/x'), false)
  assert.equal(hasInsecureFlag('not a url'), false)
})

test('createSubscriptionFetch:带开关或 init.insecure 走 insecure,否则走系统 fetch,且 insecure 字段不外传', async () => {
  const calls = []
  const f = createSubscriptionFetch({
    secure: async (u, i) => { calls.push(['secure', u, i]); return 'S' },
    insecure: async (u, i) => { calls.push(['insecure', u, i]); return 'I' },
  })
  assert.equal(await f('https://a.test/s#insecure=1', { redirect: 'manual' }), 'I')
  assert.equal(await f('https://a.test/s', { redirect: 'manual' }), 'S')
  assert.equal(await f('https://b.test/after-redirect', { redirect: 'manual', insecure: true }), 'I')
  assert.deepEqual(calls.map((c) => c[0]), ['insecure', 'secure', 'insecure'])
  assert.ok(calls.every((c) => !('insecure' in c[2])))
})
