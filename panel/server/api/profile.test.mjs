import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerProfileRoutes, validateProfilePatch } from './profile.mjs'
import { createStore, DEFAULT_PROFILE } from '../store/openbox-store.mjs'

const memStore = () => {
  const m = new Map()
  return createStore({
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => m.set(k, v),
    del: (k) => m.delete(k),
  })
}

// 起一个绑定临时端口的最小 express app,注册待测路由,返回 baseUrl 供 fetch 打真实 HTTP 请求;
// close() 必须在 finally 里调用,防止测试遗留监听中的 server。
const startApp = async () => {
  const store = memStore()
  const app = express()
  registerProfileRoutes(app, { store })
  const server = app.listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const { port } = server.address()
  return {
    store,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

const putJson = (baseUrl, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

// -------- validateProfilePatch 单测 --------

test('validateProfilePatch 空 patch 通过', () => {
  assert.equal(validateProfilePatch({}), null)
})

test('validateProfilePatch ipv6 非布尔 → 报错', () => {
  assert.ok(validateProfilePatch({ ipv6: 'yes' }))
})

test('validateProfilePatch 只碰 ipv6 不要求提供 dns(部分 patch 只校验出现的字段)', () => {
  assert.equal(validateProfilePatch({ ipv6: false }), null)
})

test('validateProfilePatch dns.mode 非法值 → 报错', () => {
  assert.ok(validateProfilePatch({ dns: { mode: 'foo' } }))
})

test('validateProfilePatch dns.mode 合法值(hijack/dnsmasq)通过', () => {
  assert.equal(validateProfilePatch({ dns: { mode: 'dnsmasq' } }), null)
  assert.equal(validateProfilePatch({ dns: { mode: 'hijack' } }), null)
})

test('validateProfilePatch dns 非对象 → 报错', () => {
  assert.ok(validateProfilePatch({ dns: 'nope' }))
})

test('validateProfilePatch routing.fallback 非字符串 → 报错', () => {
  assert.ok(validateProfilePatch({ routing: { fallback: 1 } }))
})

test('validateProfilePatch routing.fallback 字符串通过', () => {
  assert.equal(validateProfilePatch({ routing: { fallback: 'direct' } }), null)
})

test('validateProfilePatch routing.categories 非数组 → 报错', () => {
  assert.ok(validateProfilePatch({ routing: { categories: 'nope' } }))
})

test('validateProfilePatch routing.categories 元素缺 target → 报错', () => {
  assert.ok(validateProfilePatch({ routing: { categories: [{ ruleset: 'geosite-cn' }] } }))
})

test('validateProfilePatch routing.categories 元素 target 非字符串 → 报错', () => {
  assert.ok(validateProfilePatch({ routing: { categories: [{ ruleset: 'geosite-cn', target: 1 }] } }))
})

test('validateProfilePatch routing.categories 合法通过', () => {
  assert.equal(
    validateProfilePatch({ routing: { categories: [{ ruleset: 'geosite-cn', target: 'PROXY' }] } }),
    null,
  )
})

test('validateProfilePatch routing.directRulesets 非数组或含非字符串 → 报错', () => {
  assert.ok(validateProfilePatch({ routing: { directRulesets: 'nope' } }))
  assert.ok(validateProfilePatch({ routing: { directRulesets: ['a', 2] } }))
})

test('validateProfilePatch routing.directRulesets 字符串数组通过', () => {
  assert.equal(validateProfilePatch({ routing: { directRulesets: ['geosite-cn', 'geoip-cn'] } }), null)
})

test('validateProfilePatch routing 非对象 → 报错', () => {
  assert.ok(validateProfilePatch({ routing: 'nope' }))
})

test('validateProfilePatch 非对象 patch → 报错', () => {
  assert.ok(validateProfilePatch(null))
  assert.ok(validateProfilePatch('nope'))
})

// -------- HTTP 路由集成测试 --------

test('GET /api/openbox/profile 返回默认 profile', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/profile`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body.profile, DEFAULT_PROFILE)
  } finally {
    await close()
  }
})

test('PUT /api/openbox/profile 深合并后返回并持久化,未提及字段保留', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const res = await putJson(baseUrl, '/api/openbox/profile', { ipv6: false, dns: { mode: 'dnsmasq' } })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.profile.ipv6, false)
    assert.equal(body.profile.dns.mode, 'dnsmasq')
    assert.equal(body.profile.dns.direct, '223.5.5.5') // 未提及字段保留

    assert.deepEqual(store.getProfile(), body.profile) // 已落库
  } finally {
    await close()
  }
})

test('PUT 只碰 ipv6 的部分 patch 不因缺 dns 报错,且不影响 dns', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await putJson(baseUrl, '/api/openbox/profile', { ipv6: false })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.profile.ipv6, false)
    assert.equal(body.profile.dns.mode, 'hijack') // 未提及,保留默认
  } finally {
    await close()
  }
})

test('PUT 非法 dns.mode → 400 且不写入', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const before = store.getProfile()
    const res = await putJson(baseUrl, '/api/openbox/profile', { dns: { mode: 'bogus' } })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error)
    assert.deepEqual(store.getProfile(), before)
  } finally {
    await close()
  }
})

test('PUT 非法 ipv6 → 400 且不写入', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const before = store.getProfile()
    const res = await putJson(baseUrl, '/api/openbox/profile', { ipv6: 'yes' })
    assert.equal(res.status, 400)
    assert.deepEqual(store.getProfile(), before)
  } finally {
    await close()
  }
})

test('PUT 非法 routing.categories(缺 target) → 400 且不写入', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const before = store.getProfile()
    const res = await putJson(baseUrl, '/api/openbox/profile', {
      routing: { categories: [{ ruleset: 'geosite-cn' }] },
    })
    assert.equal(res.status, 400)
    assert.deepEqual(store.getProfile(), before)
  } finally {
    await close()
  }
})

test('PUT 非法 routing.directRulesets(含非字符串) → 400 且不写入', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const before = store.getProfile()
    const res = await putJson(baseUrl, '/api/openbox/profile', {
      routing: { directRulesets: ['geosite-cn', 42] },
    })
    assert.equal(res.status, 400)
    assert.deepEqual(store.getProfile(), before)
  } finally {
    await close()
  }
})

test('GET /defaults?region=CN → CN 推荐默认', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/profile/defaults?region=CN`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.defaults.region, 'CN')
    assert.equal(body.defaults.dns.split, true)
    assert.equal(body.defaults.dns.direct, '223.5.5.5')
    assert.deepEqual(body.defaults.routing.directRulesets, ['geosite-cn', 'geoip-cn'])
    assert.equal(body.defaults.routing.fallback, 'PROXY')
  } finally {
    await close()
  }
})

test('GET /defaults?region=US → 其它区域推荐默认', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/profile/defaults?region=US`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.defaults.region, 'US')
    assert.equal(body.defaults.dns.split, false)
    assert.equal(body.defaults.dns.direct, '1.1.1.1')
    assert.deepEqual(body.defaults.routing.directRulesets, ['geosite-us', 'geoip-us'])
    assert.equal(body.defaults.routing.fallback, 'direct')
  } finally {
    await close()
  }
})

test('GET /defaults 缺 region → 按 CN 兜底', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/profile/defaults`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.defaults.region, 'CN')
  } finally {
    await close()
  }
})

test('GET /defaults?region=jp → 区域大小写归一化(region 大写,ruleset 后缀小写)', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/profile/defaults?region=jp`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.defaults.region, 'JP')
    assert.deepEqual(body.defaults.routing.directRulesets, ['geosite-jp', 'geoip-jp'])
  } finally {
    await close()
  }
})
