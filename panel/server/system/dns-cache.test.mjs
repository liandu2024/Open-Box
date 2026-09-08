import assert from 'node:assert/strict'
import test from 'node:test'
import { flushDnsCache } from './dns-cache.mjs'

test('flushDnsCache:POST /cache/dns/flush,带上 secret', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization })
    return { ok: true, status: 204 }
  }
  assert.equal(await flushDnsCache(fetchImpl, 'sec'), true)
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/cache\/dns\/flush$/)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].auth, 'Bearer sec')
})

test('flushDnsCache:内核没在跑 / 接口不存在都只回 false,不抛出去', async () => {
  assert.equal(await flushDnsCache(async () => { throw new Error('ECONNREFUSED') }, 's'), false)
  assert.equal(await flushDnsCache(async () => ({ ok: false, status: 404 }), 's'), false)
})

test('flushDnsCache:没有 secret 时不带 Authorization 头', async () => {
  let headers = null
  await flushDnsCache(async (_u, init) => { headers = init.headers; return { ok: true, status: 204 } }, '')
  assert.deepEqual(headers, {})
})
