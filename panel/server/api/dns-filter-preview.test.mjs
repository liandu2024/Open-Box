import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import { registerDnsFilterRoutes } from './dns-filter.mjs'
import { createDnsFilterPreview } from '../system/dns-filter-preview.mjs'
import { parseDnsFilter } from '../engine/dns-filter.mjs'

const url = 'https://example.com/filter.txt'
const fixture = (body, previewFetch = async () => { throw new Error('must not download') }) => {
  const profile = { dns: { filter: { enabled: false, lists: [{ id: 'test', name: 'Test', enabled: false, url }], allowDomains: [] } } }
  const state = { test: { url, path: '/cache/list.txt', hash: 'first', updatedAt: 123 } }
  const files = new Map([['/cache/list.txt', body]])
  let reads = 0
  const deps = {
    store: { getProfile: () => profile, getRaw: (key) => { assert.equal(key, 'openbox/dns-filter-lists'); return JSON.stringify(state) }, setRaw: () => assert.fail('preview wrote state'), setProfile: () => assert.fail('preview saved settings') },
    ctx: { exists: async (path) => files.has(path), readFile: async (path) => { reads++; assert.ok(files.has(path)); return files.get(path) }, exec: () => assert.fail('preview invoked core'), writeFile: () => assert.fail('preview wrote cache') },
    previewFetch, deploy: () => assert.fail('preview deployed'),
  }
  return { deps, state, files, reads: () => reads }
}
const api = async (t, deps) => {
  const app = express()
  registerDnsFilterRoutes(app, deps)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return async (params = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/openbox/dns-filter/preview?${new URLSearchParams({ url, ...params })}`)
    return { status: response.status, ...await response.json() }
  }
}

test('preview uses downloaded disabled lists and the actual parser without changing DNS state', async (t) => {
  const body = '! title\n||ads.example^\n@@||safe.ads.example^$important\n0.0.0.0 host.example second.example\n||conditional.example^$dnstype=A,denyallow=safe.conditional.example\n/^ad[0-9]+\\.example$/\nexample.com##.banner'
  const f = fixture(body), get = await api(t, f.deps)
  const result = await get()
  assert.equal(result.status, 200)
  assert.equal(result.source, 'downloaded')
  assert.equal(result.updatedAt, 123)
  assert.equal(result.ruleCount, 5)
  assert.equal(result.count, 6)
  assert.equal(result.unsupported, 1)
  assert.deepEqual(result.rows.map((row) => row.value), ['ads.example', 'safe.ads.example', 'host.example', 'second.example', 'conditional.example', '^ad[0-9]+\\.example$'])
  assert.equal(result.rows[0].type, 'domain_suffix')
  assert.equal(result.rows[1].action, 'allow')
  assert.equal(result.rows[1].important, true)
  assert.equal(result.rows[4].conditional, true)
  assert.match(result.rows[4].rule, /dnstype=A,denyallow=/)
  const normal = parseDnsFilter(body), { entries, ...collected } = parseDnsFilter(body, { collectEntries: true })
  assert.deepEqual(collected, normal)
  assert.equal(entries.length, 6)
})

test('preview paginates 20/50/100/custom, clamps bounds and searches without reloading the list', async (t) => {
  const f = fixture(Array.from({ length: 125 }, (_, i) => `||ad${i}.example^`).join('\n'))
  const get = await api(t, f.deps)
  const first = await get()
  assert.equal(first.rows.length, 20)
  assert.equal(first.total, 125)
  for (const size of [50, 100, 7]) assert.equal((await get({ pageSize: size })).rows.length, size)
  const last = await get({ pageSize: 20, page: 99999 })
  assert.equal(last.page, 7)
  assert.equal(last.rows.length, 5)
  assert.equal((await get({ pageSize: 99999 })).pageSize, 1000)
  assert.equal((await get({ pageSize: 'invalid', page: -1 })).pageSize, 20)
  const match = await get({ search: 'AD12', page: 99 })
  assert.equal(match.page, 1)
  assert.equal(match.total, 6)
  assert.equal(match.count, 125)
  const empty = await get({ search: 'missing', page: 99 })
  assert.equal(empty.total, 0)
  assert.equal(empty.page, 1)
  assert.equal(f.reads(), 1)
})

test('preview filters rule actions before search and pagination without changing the total list count', async (t) => {
  const f = fixture(Array.from({ length: 30 }, (_, i) => `||ad${i}.example^\n@@||safe${i}.example^`).join('\n'))
  const get = await api(t, f.deps)
  const all = await get({ action: 'all' })
  assert.equal(all.total, 60)
  assert.deepEqual(all, await get())
  for (const action of ['allow', 'block']) {
    const result = await get({ action, page: 2 })
    assert.equal(result.count, 60)
    assert.equal(result.total, 30)
    assert.equal(result.page, 2)
    assert.equal(result.rows.length, 10)
    assert.ok(result.rows.every((row) => row.action === action))
  }
  const match = await get({ action: 'allow', search: 'SAFE1', page: 2, pageSize: 7 })
  assert.equal(match.total, 11)
  assert.equal(match.count, 60)
  assert.equal(match.page, 2)
  assert.deepEqual(match.rows.map((row) => row.value), ['safe16.example', 'safe17.example', 'safe18.example', 'safe19.example'])
  const empty = await get({ action: 'block', search: 'safe', page: 99 })
  assert.equal(empty.total, 0)
  assert.equal(empty.page, 1)
  assert.deepEqual(empty.rows, [])
  const invalid = await get({ action: 'invalid' })
  assert.equal(invalid.status, 400)
  assert.match(invalid.error, /筛选/)
  assert.equal(f.reads(), 1)
})

test('draft URL preview downloads once without saving, and saved-list updates invalidate the preview', async (t) => {
  let downloads = 0
  const f = fixture('||old.example^', async (input) => { downloads++; assert.equal(input, 'https://example.com/draft.txt'); return new Response('||draft.example^') })
  const get = await api(t, f.deps)
  assert.equal((await get()).rows[0].value, 'old.example')
  f.state.test.hash = 'second'
  f.files.set('/cache/list.txt', '||new.example^')
  assert.equal((await get()).rows[0].value, 'new.example')
  const draft = await get({ url: 'https://example.com/draft.txt' })
  assert.equal(draft.source, 'url')
  assert.equal(draft.rows[0].value, 'draft.example')
  await get({ url: 'https://example.com/draft.txt', search: 'draft' })
  assert.equal(downloads, 1)
})

test('invalid URLs, failed and oversized downloads return errors instead of cached rows', async (t) => {
  let downloads = 0
  const f = fixture('||cached.example^', async (input) => {
    downloads++
    if (input.endsWith('/large')) return new Response('small body', { headers: { 'content-length': String(9 * 1024 * 1024) } })
    return new Response('offline', { status: 503 })
  })
  const get = await api(t, f.deps)
  await get()
  for (const invalid of ['', 'file:///etc/passwd', 'https://user:password@example.com/list']) {
    assert.equal((await get({ url: invalid })).status, 400)
  }
  assert.equal(downloads, 0)
  const failed = await get({ url: 'https://example.com/offline' })
  assert.equal(failed.status, 400)
  assert.match(failed.error, /503/)
  assert.equal(failed.rows, undefined)
  const large = await get({ url: 'https://example.com/large' })
  assert.equal(large.status, 400)
  assert.match(large.error, /8MB/)
})

test('production preview downloader retains the existing link-local address guard', async (t) => {
  const f = fixture('||cached.example^')
  delete f.deps.previewFetch
  const get = await api(t, f.deps)
  const result = await get({ url: 'http://169.254.10.10/list.txt' })
  assert.equal(result.status, 400)
  assert.ok(result.error)
})

test('preview shares in-flight downloads and releases its one-list cache after expiry', async () => {
  let downloads = 0, complete
  const f = fixture('||cached.example^')
  const preview = createDnsFilterPreview({ ...f.deps, ttlMs: 10, fetchImpl: async () => { downloads++; if (downloads === 1) await new Promise((resolve) => { complete = resolve }); return new Response('||draft.example^') } })
  const params = { url: 'https://example.com/draft.txt' }
  const one = preview(params), two = preview(params)
  await new Promise((resolve) => setImmediate(resolve))
  complete()
  assert.deepEqual(await one, await two)
  assert.equal(downloads, 1)
  await new Promise((resolve) => setTimeout(resolve, 20))
  await preview(params)
  assert.equal(downloads, 2)
})
