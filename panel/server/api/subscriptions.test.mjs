import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerSubscriptionRoutes, dedupeNodeTags } from './subscriptions.mjs'
import { createStore } from '../store/openbox-store.mjs'

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
const startApp = async (fetchImpl) => {
  const store = memStore()
  const app = express()
  registerSubscriptionRoutes(app, { store, fetchImpl })
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

const postJson = (baseUrl, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const HK_LINE = 'ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388#HK-01'
const JP_LINE = 'ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388#JP-01'
const VMESS_US = 'vmess://' + Buffer.from(
  JSON.stringify({ ps: 'US-01', add: 'us.example.com', port: '443', id: 'uuid-1', aid: '0', net: 'tcp' }),
).toString('base64')
const SHARELINK_MULTI = [HK_LINE, VMESS_US].join('\n')

// -------- dedupeNodeTags 单测 --------

test('dedupeNodeTags 无重复保持原样(同引用)', () => {
  const a = { tag: 'A' }
  const b = { tag: 'B' }
  const out = dedupeNodeTags([a, b])
  assert.equal(out[0], a)
  assert.equal(out[1], b)
})

test('dedupeNodeTags 重复 tag 依次追加 -2 -3', () => {
  const nodes = [{ tag: 'HK' }, { tag: 'HK' }, { tag: 'HK' }]
  const out = dedupeNodeTags(nodes)
  assert.deepEqual(out.map((n) => n.tag), ['HK', 'HK-2', 'HK-3'])
})

test('dedupeNodeTags 候选后缀已被占用时继续递增,不二次撞车', () => {
  const nodes = [{ tag: 'HK' }, { tag: 'HK-2' }, { tag: 'HK' }]
  const out = dedupeNodeTags(nodes)
  assert.deepEqual(out.map((n) => n.tag), ['HK', 'HK-2', 'HK-3'])
})

test('dedupeNodeTags 不修改原节点对象,仅重复项产出新对象', () => {
  const a = { tag: 'X', server: 's1' }
  const b = { tag: 'X', server: 's2' }
  const out = dedupeNodeTags([a, b])
  assert.equal(out[0], a)
  assert.equal(out[1].tag, 'X-2')
  assert.equal(out[1].server, 's2')
  assert.equal(a.tag, 'X') // 原对象未被就地修改
})

// -------- HTTP 路由集成测试 --------

test('POST preview 用 content(多协议 sharelink)→ 返回 nodes/preview/groups,且不落库', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', { content: SHARELINK_MULTI })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.format, 'sharelink')
    assert.equal(body.nodes.length, 2)
    assert.ok(body.nodes[0].tag && body.nodes[0].originalTag && body.nodes[0].type && body.nodes[0].server)
    assert.equal(body.preview.length, 2)
    assert.ok(Array.isArray(body.groups))
    assert.deepEqual(body.skipped, [])

    assert.deepEqual(store.getSubscriptions(), [])
    assert.deepEqual(store.getNodes(), [])
  } finally {
    await close()
  }
})

test('POST preview 显式传 renameOptions:null 时按默认选项处理,不误判 400', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', {
      content: SHARELINK_MULTI,
      renameOptions: null,
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.nodes.length, 2)
  } finally {
    await close()
  }
})

test('POST preview 缺少 url/content → 400', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', {})
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error)
  } finally {
    await close()
  }
})

test('POST 创建订阅后 GET 列表可见;DELETE 后消失(同时移除节点)', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => SHARELINK_MULTI })
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const createRes = await postJson(baseUrl, '/api/openbox/subscriptions', {
      url: 'http://sub.example.com/a',
      name: 'Sub A',
    })
    assert.equal(createRes.status, 200)
    const created = await createRes.json()
    assert.ok(created.id)
    assert.equal(created.name, 'Sub A')
    assert.equal(created.nodeCount, 2)
    assert.deepEqual(created.skipped, [])

    const listRes = await fetch(`${baseUrl}/api/openbox/subscriptions`)
    const listBody = await listRes.json()
    assert.equal(listBody.subscriptions.length, 1)
    assert.equal(listBody.subscriptions[0].id, created.id)
    assert.equal(store.getNodes().length, 2)

    const delRes = await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}`, { method: 'DELETE' })
    assert.equal(delRes.status, 200)
    assert.deepEqual(await delRes.json(), { ok: true })

    const listRes2 = await fetch(`${baseUrl}/api/openbox/subscriptions`)
    assert.deepEqual((await listRes2.json()).subscriptions, [])
    assert.deepEqual(store.getNodes(), [])
  } finally {
    await close()
  }
})

test('DELETE 不存在的 id 仍是幂等的 ok:true', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/subscriptions/does-not-exist`, { method: 'DELETE' })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
  } finally {
    await close()
  }
})

test('两条订阅含同名节点 → 保存后 tag 全局唯一(dedupeNodeTags 集成断言)', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => (url === 'http://a' ? HK_LINE : HK_LINE), // 两个订阅巧合同名(同 originalTag→同 renamed tag)
  })
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://a', name: 'Sub A' })
    await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://b', name: 'Sub B' })

    const tags = store.getNodes().map((n) => n.tag)
    assert.equal(tags.length, 2)
    assert.equal(new Set(tags).size, 2) // 全局唯一
    assert.equal(tags[0], '香港-01')
    assert.equal(tags[1], '香港-01-2') // 后到的订阅追加 -2
  } finally {
    await close()
  }
})

test('创建时 fetch 返回 500 → 400 且不写入任何数据', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'boom' })
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://a', name: 'Sub A' })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error)
    assert.deepEqual(store.getSubscriptions(), [])
    assert.deepEqual(store.getNodes(), [])
  } finally {
    await close()
  }
})

test('创建时 fetch 网络异常(reject) → 400 且不写入任何数据', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNRESET')
  }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://a', name: 'Sub A' })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error)
    assert.deepEqual(store.getSubscriptions(), [])
    assert.deepEqual(store.getNodes(), [])
  } finally {
    await close()
  }
})

test('创建时缺 url 或 name → 400', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res1 = await postJson(baseUrl, '/api/openbox/subscriptions', { name: 'no url' })
    assert.equal(res1.status, 400)
    const res2 = await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://a' })
    assert.equal(res2.status, 400)
  } finally {
    await close()
  }
})

// -------- Important 4:订阅拉取 SSRF 防护 --------
// 面板本身跑在网关上,拉取订阅是"服务端发起、URL 客户端可控"——不加限制就能拿来当跳板
// 探测回环/内网端口。校验必须发生在真的调用 fetchImpl 之前,且不能改变已存状态。

test('SSRF 防护:订阅 URL 指向回环地址(127.0.0.1)→ 400,且从未真正调用 fetchImpl', async () => {
  let called = false
  const fetchImpl = async () => {
    called = true
    return { ok: true, status: 200, text: async () => HK_LINE }
  }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', {
      url: 'http://127.0.0.1:9095/sub',
      name: 'Loopback',
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error)
    assert.equal(called, false) // 校验在拉取之前就已经拒绝
    assert.deepEqual(store.getSubscriptions(), [])
    assert.deepEqual(store.getNodes(), [])
  } finally {
    await close()
  }
})

test('SSRF 防护:订阅 URL 指向内网地址(192.168.x.x)→ 400,且从未真正调用 fetchImpl', async () => {
  // 必须显式注入 fetchImpl(而不是让它退化到 globalThis.fetch)——192.168.1.1 是极常见的
  // 路由器默认地址,真打一次网络请求既慢又环境相关(不同网络下可能真的连得通)。
  let called = false
  const fetchImpl = async () => {
    called = true
    return { ok: true, status: 200, text: async () => HK_LINE }
  }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', {
      url: 'http://192.168.1.1/sub',
      name: 'Private',
    })
    assert.equal(res.status, 400)
    assert.equal(called, false)
    assert.deepEqual(store.getSubscriptions(), [])
  } finally {
    await close()
  }
})

test('SSRF 防护:非 http/https 协议(file://)→ 400,且从未真正调用 fetchImpl', async () => {
  let called = false
  const fetchImpl = async () => {
    called = true
    return { ok: true, status: 200, text: async () => HK_LINE }
  }
  const { baseUrl, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', {
      url: 'file:///etc/passwd',
      name: 'File',
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error)
    assert.equal(called, false)
  } finally {
    await close()
  }
})

test('SSRF 防护:preview 接口同样校验(用 url 而非 content 时),且从未真正调用 fetchImpl', async () => {
  let called = false
  const fetchImpl = async () => {
    called = true
    return { ok: true, status: 200, text: async () => HK_LINE }
  }
  const { baseUrl, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', { url: 'http://[::1]/sub' })
    assert.equal(res.status, 400)
    assert.equal(called, false)
  } finally {
    await close()
  }
})

test('SSRF 防护:正常公网 https 域名仍能通过(注入 fetchImpl,不发真实网络请求)', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => HK_LINE })
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', {
      url: 'https://sub.example.com/feed',
      name: 'Public',
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.nodeCount, 1)
    assert.equal(store.getSubscriptions().length, 1)
  } finally {
    await close()
  }
})

test('refresh 时拉取失败 → 400,已存订阅与节点保持不变', async () => {
  let shouldFail = false
  const fetchImpl = async () => {
    if (shouldFail) return { ok: false, status: 500, text: async () => 'boom' }
    return { ok: true, status: 200, text: async () => HK_LINE }
  }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const createRes = await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://a', name: 'Sub A' })
    const created = await createRes.json()
    const nodesBefore = store.getNodes()
    const subsBefore = store.getSubscriptions()

    shouldFail = true
    const refreshRes = await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}/refresh`, { method: 'POST' })
    assert.equal(refreshRes.status, 400)
    const body = await refreshRes.json()
    assert.ok(body.error)

    assert.deepEqual(store.getNodes(), nodesBefore)
    assert.deepEqual(store.getSubscriptions(), subsBefore)
  } finally {
    await close()
  }
})

test('refresh 未知 id → 404', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/subscriptions/nope/refresh`, { method: 'POST' })
    assert.equal(res.status, 404)
  } finally {
    await close()
  }
})

test('refresh 成功后只替换该订阅节点,其它订阅节点不受影响', async () => {
  // Sub A 订阅源后续会"新增一个节点";用可变闭包让同一个 fetchImpl 在 refresh 前后返回不同内容。
  const GROWN_A = [HK_LINE, 'ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8389#HK-02'].join('\n')
  let aContent = HK_LINE
  const fetchImpl = async (url) => {
    if (url === 'http://a') return { ok: true, status: 200, text: async () => aContent }
    return { ok: true, status: 200, text: async () => JP_LINE }
  }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const createA = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://a', name: 'Sub A' })).json()
    await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://b', name: 'Sub B' })
    assert.equal(createA.nodeCount, 1)

    aContent = GROWN_A
    const refreshRes = await fetch(`${baseUrl}/api/openbox/subscriptions/${createA.id}/refresh`, { method: 'POST' })
    assert.equal(refreshRes.status, 200)
    const refreshed = await refreshRes.json()
    assert.equal(refreshed.id, createA.id)
    assert.equal(refreshed.nodeCount, 2)

    const nodes = store.getNodes()
    const aNodes = nodes.filter((n) => n.subscriptionId === createA.id)
    const bNode = nodes.find((n) => n.subscriptionId !== createA.id)
    assert.equal(aNodes.length, 2) // 该订阅节点已替换为新的两个
    assert.equal(bNode.tag, '日本-01') // 另一条订阅的节点未受影响
  } finally {
    await close()
  }
})
