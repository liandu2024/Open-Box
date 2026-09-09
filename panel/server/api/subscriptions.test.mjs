import assert from 'node:assert/strict'
import net from 'node:net'
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

// 测试环境不能依赖真实 DNS:沙箱/CI 网络里常见"任意域名都被解析成某个地址"的透明代理/
// 合成 resolver(实测过——不存在的域名被解析到 198.18.0.0/15 基准测试网段),真连外网也
// 慢且不确定。这里注入一个假 lookup:字面 IP 原样透传(SSRF 负向用例靠它验证回环/内网
// 地址仍被拒绝),域名一律解析成一个真正的公网地址(8.8.8.8)。
const fakePublicLookup = async (hostname) => {
  const trimmed = String(hostname).replace(/^\[|\]$/g, '').trim()
  const version = net.isIP(trimmed)
  if (version) {
    return [{ address: trimmed, family: version }]
  }
  return [{ address: '8.8.8.8', family: 4 }]
}

// 起一个绑定临时端口的最小 express app,注册待测路由,返回 baseUrl 供 fetch 打真实 HTTP 请求;
// close() 必须在 finally 里调用,防止测试遗留监听中的 server。
const startApp = async (fetchImpl, lookup = fakePublicLookup, extra = {}) => {
  const store = memStore()
  const app = express()
  registerSubscriptionRoutes(app, { store, fetchImpl, lookup, ...extra })
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
    assert.deepEqual(await delRes.json(), { ok: true, changed: true })

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
    assert.deepEqual(await res.json(), { ok: true, changed: false })
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

// -------- P4a round2 复审 Important 1:SSRF 防护的四种已证明绕过 --------
// 复审给出了针对旧实现的四条可复现 PoC:主机名不解析(只查字面 IP)、IPv6 十六进制形式的
// IPv4-mapped 地址漏判、缺失网段(0.0.0.0/::/CGNAT)、重定向不复检。下面每条对应一个用例,
// 全部断言 400 + fetchImpl 从未真正被调用到"危险目的地"。



test('round2:合法的 302 重定向链(公网 → 公网)仍然放行', async () => {
  let hops = 0
  const fetchImpl = async (url) => {
    hops += 1
    if (url === 'https://public-a.example.com/sub') {
      return {
        ok: false,
        status: 302,
        headers: { get: (name) => (name.toLowerCase() === 'location' ? 'https://public-b.example.com/sub' : null) },
      }
    }
    return { ok: true, status: 200, text: async () => HK_LINE }
  }
  const { baseUrl, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', { url: 'https://public-a.example.com/sub' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.nodes.length, 1)
    assert.equal(hops, 2) // 首跳 + 跟随一次重定向
  } finally {
    await close()
  }
})

test('round2:重定向跳数超过上限(4 跳全部合法目标)→ 400', async () => {
  const fetchImpl = async (url) => {
    const match = url.match(/^https:\/\/hop-(\d+)\.example\.com\/sub$/)
    const n = match ? Number(match[1]) : 0
    if (n < 5) {
      return {
        ok: false,
        status: 302,
        headers: { get: (name) => (name.toLowerCase() === 'location' ? `https://hop-${n + 1}.example.com/sub` : null) },
      }
    }
    return { ok: true, status: 200, text: async () => HK_LINE }
  }
  const { baseUrl, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', { url: 'https://hop-0.example.com/sub' })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.match(body.error, /too many redirects/)
  } finally {
    await close()
  }
})

test('round2:域名解析失败(NXDOMAIN 等) → 400,且从未真正拉取', async () => {
  let called = false
  const fetchImpl = async () => { called = true; return { ok: true, status: 200, text: async () => HK_LINE } }
  const lookup = async () => {
    const err = new Error('getaddrinfo ENOTFOUND nx.invalid')
    err.code = 'ENOTFOUND'
    throw err
  }
  const { baseUrl, close } = await startApp(fetchImpl, lookup)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', { url: 'https://nx.invalid/sub' })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error)
    assert.equal(called, false)
  } finally {
    await close()
  }
})

// -------- User-Agent 协商 与 空结果 --------
// 真机诊断的结论:机场订阅端点按 User-Agent 决定返回什么。Node 的 fetch 默认发
// "User-Agent: node",实测同一个订阅地址三种 UA 拿到三份完全不同的响应。此前面板
// 不设任何请求头,拿到的是最贫瘠的那一份;更糟的是解析出 0 个节点时照样按成功存下,
// 界面上只剩一句「0 个节点」,用户无从判断问题出在哪。

test('拉订阅时必须带机场认得的 User-Agent,而不是 Node 默认的 "node"', async () => {
  const seenUserAgents = []
  const fetchImpl = async (_url, init) => {
    seenUserAgents.push(init?.headers?.['User-Agent'])
    return { ok: true, status: 200, text: async () => SHARELINK_MULTI }
  }
  const { baseUrl, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'https://sub.example.com/x', name: 'S' })
    assert.equal(res.status, 200)
    assert.equal(seenUserAgents.length, 1, '首选 UA 就拿到节点时只应请求一次')
    assert.match(seenUserAgents[0], /clash/i)
  } finally {
    await close()
  }
})

test('首选 UA 解析不出节点时,换下一个 UA 重试', async () => {
  const seenUserAgents = []
  const fetchImpl = async (_url, init) => {
    const ua = init?.headers?.['User-Agent']
    seenUserAgents.push(ua)
    // 模拟"只认 sing-box UA"的机场:其余 UA 一律回一个网页
    const body = /sing-box/i.test(ua)
      ? JSON.stringify({ outbounds: [{ type: 'anytls', tag: 'HK', server: 'a.com', server_port: 443, password: 'pw', tls: { enabled: true } }] })
      : '<html><body>请使用客户端订阅</body></html>'
    return { ok: true, status: 200, text: async () => body }
  }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'https://sub.example.com/x', name: 'S' })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).nodeCount, 1)
    assert.ok(seenUserAgents.length >= 2, '第一个 UA 落空后应当继续试下一个')
    assert.equal(store.getNodes()[0].type, 'anytls')
  } finally {
    await close()
  }
})

test('所有 UA 都解析不出节点 → 400 并说明原因,而不是静默存成 0 个节点', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html>机场官网</html>' })
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'https://sub.example.com/x', name: 'S' })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /无法识别订阅内容的格式/)
    // 关键:失败不能留下一条"0 个节点"的空订阅记录
    assert.equal(store.getSubscriptions().length, 0)
  } finally {
    await close()
  }
})

test('刷新失败时保留原有节点,不会把订阅刷成 0 个节点', async () => {
  let serveGarbage = false
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => (serveGarbage ? '<html>机场官网</html>' : SHARELINK_MULTI),
  })
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'https://sub.example.com/x', name: 'S' })).json()
    assert.equal(created.nodeCount, 2)

    serveGarbage = true
    const res = await postJson(baseUrl, `/api/openbox/subscriptions/${created.id}/refresh`, {})
    assert.equal(res.status, 400)
    assert.equal(store.getNodes().length, 2, '刷新失败必须保留原有节点')
    assert.equal(store.getSubscriptions()[0].nodeCount, 2)
  } finally {
    await close()
  }
})

// -------- 修改订阅(PATCH) --------

test('只改名字不触发重新拉取(机场抽风时也得能改名)', async () => {
  let fetchCount = 0
  const fetchImpl = async () => {
    fetchCount += 1
    return { ok: true, status: 200, text: async () => SHARELINK_MULTI }
  }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'https://sub.example.com/x', name: '旧名字' })).json()
    assert.equal(fetchCount, 1)

    const res = await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '新名字' }),
    })
    assert.equal(res.status, 200)
    assert.equal(fetchCount, 1, '链接与重命名规则都没变,不应再发请求')
    assert.equal(store.getSubscriptions()[0].name, '新名字')
    assert.equal(store.getSubscriptions()[0].nodeCount, 2, '节点数不该被改动')
  } finally {
    await close()
  }
})

test('开了订阅名前缀时,改名字必须重新解析(否则节点上挂着旧前缀)', async () => {
  let fetchCount = 0
  const fetchImpl = async () => {
    fetchCount += 1
    return { ok: true, status: 200, text: async () => SHARELINK_MULTI }
  }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', {
      url: 'https://sub.example.com/x', name: '旧名字', renameOptions: { usePrefix: true },
    })).json()
    assert.ok(store.getNodes().every((n) => n.tag.startsWith('旧名字 | ')), '建好时就该带前缀')

    const res = await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '新名字' }),
    })
    assert.equal(res.status, 200)
    assert.equal(fetchCount, 2, '名字即前缀,改名等于改所有节点名,必须重新解析')
    assert.ok(store.getNodes().every((n) => n.tag.startsWith('新名字 | ')), '前缀要跟着新名字走')
  } finally {
    await close()
  }
})

test('没开前缀时改名字仍然不重新拉取', async () => {
  let fetchCount = 0
  const fetchImpl = async () => {
    fetchCount += 1
    return { ok: true, status: 200, text: async () => SHARELINK_MULTI }
  }
  const { baseUrl, close } = await startApp(fetchImpl)
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'https://sub.example.com/x', name: 'A' })).json()
    await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B' }),
    })
    assert.equal(fetchCount, 1)
  } finally {
    await close()
  }
})

test('换订阅链接会重新拉取并替换该订阅的节点', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => (url.includes('/new') ? HK_LINE : SHARELINK_MULTI),
  })
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'https://sub.example.com/old', name: 'S' })).json()
    assert.equal(created.nodeCount, 2)

    const res = await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://sub.example.com/new' }),
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).nodeCount, 1)
    assert.equal(store.getSubscriptions()[0].url, 'https://sub.example.com/new')
    assert.equal(store.getNodes().length, 1)
  } finally {
    await close()
  }
})

test('改成一个拉不通的链接 → 400,原有名称/链接/节点全部保留', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/bad')) return { ok: false, status: 500, text: async () => 'boom' }
    return { ok: true, status: 200, text: async () => SHARELINK_MULTI }
  }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'https://sub.example.com/ok', name: '原名' })).json()

    const res = await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '改坏了', url: 'https://sub.example.com/bad' }),
    })
    assert.equal(res.status, 400)

    const sub = store.getSubscriptions()[0]
    assert.equal(sub.name, '原名', '失败时名称也不能被改掉')
    assert.equal(sub.url, 'https://sub.example.com/ok')
    assert.equal(store.getNodes().length, 2)
  } finally {
    await close()
  }
})

test('PATCH 不存在的订阅 → 404', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => SHARELINK_MULTI })
  const { baseUrl, close } = await startApp(fetchImpl)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/subscriptions/nope`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    assert.equal(res.status, 404)
  } finally {
    await close()
  }
})

// -------- 粘贴节点保存(「节点」模式)--------
// 此前粘贴内容只能预览、不能保存(创建接口硬性要求 url)。但"手上只有一堆分享链接、
// 没有订阅地址"是很常见的情况,所以现在 url / content 二选一。

test('只粘贴内容也能创建订阅(url 为空),内容被存下来', async () => {
  let fetched = false
  const fetchImpl = async () => { fetched = true; throw new Error('不该走网络') }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', {
      name: '手动节点', content: SHARELINK_MULTI,
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).nodeCount, 2)
    assert.equal(fetched, false, '粘贴来源不该发起任何网络请求')
    const sub = store.getSubscriptions()[0]
    assert.equal(sub.url, '')
    assert.equal(sub.content, SHARELINK_MULTI, '内容要存下来:改重命名规则时要拿它重新解析')
  } finally {
    await close()
  }
})

test('粘贴来源的订阅刷新时重新解析已存内容,不走网络', async () => {
  let fetched = false
  const fetchImpl = async () => { fetched = true; throw new Error('不该走网络') }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', {
      name: '手动节点', content: SHARELINK_MULTI,
    })).json()
    const res = await postJson(baseUrl, `/api/openbox/subscriptions/${created.id}/refresh`, {})
    assert.equal(res.status, 200)
    assert.equal((await res.json()).nodeCount, 2)
    assert.equal(fetched, false)
    assert.equal(store.getNodes().length, 2)
  } finally {
    await close()
  }
})

test('改粘贴内容会重新解析并换掉该订阅的节点', async () => {
  const fetchImpl = async () => { throw new Error('不该走网络') }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', {
      name: '手动节点', content: SHARELINK_MULTI,
    })).json()
    assert.equal(created.nodeCount, 2)

    const res = await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: HK_LINE }),
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).nodeCount, 1)
    assert.equal(store.getNodes().length, 1)
    assert.equal(store.getSubscriptions()[0].content, HK_LINE)
  } finally {
    await close()
  }
})

test('粘贴来源只改名字同样不重新解析', async () => {
  const fetchImpl = async () => { throw new Error('不该走网络') }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', {
      name: '旧名', content: SHARELINK_MULTI,
    })).json()
    const res = await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '新名' }),
    })
    assert.equal(res.status, 200)
    assert.equal(store.getSubscriptions()[0].name, '新名')
    assert.equal(store.getSubscriptions()[0].content, SHARELINK_MULTI)
  } finally {
    await close()
  }
})

test('url 和 content 都没有 → 400', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => SHARELINK_MULTI })
  const { baseUrl, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', { name: 'x' })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /url or content/)
  } finally {
    await close()
  }
})

test('拉取失败时把系统 fetch 藏在 cause 里的原因带出来', async () => {
  const fetchImpl = async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 1.2.3.4:443' } })
  }
  const { baseUrl, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', { url: 'https://1.2.3.4/sub/x' })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.match(body.error, /fetch failed \(ECONNREFUSED: connect ECONNREFUSED 1\.2\.3\.4:443\)/)
  } finally {
    await close()
  }
})

test('PUT /order:按给定 id 顺序重排订阅,节点池跟着重排;id 集合不对 → 400', async () => {
  const fetchImpl = async (url) => ({ status: 200, ok: true, headers: new Map(), text: async () => (url.includes('a.test') ? HK_LINE : JP_LINE) })
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const a = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'https://a.test/sub', name: 'A' })).json()
    const b = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'https://b.test/sub', name: 'B' })).json()
    assert.deepEqual(store.getSubscriptions().map((s) => s.name), ['A', 'B'])
    assert.equal(store.getNodes()[0].subscriptionId, a.id)
    const put = (ids) => fetch(`${baseUrl}/api/openbox/subscriptions/order`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) })
    const ok = await put([b.id, a.id])
    assert.equal(ok.status, 200)
    assert.deepEqual((await ok.json()).subscriptions.map((s) => s.name), ['B', 'A'])
    assert.deepEqual(store.getSubscriptions().map((s) => s.name), ['B', 'A'])
    assert.deepEqual(store.getNodes().map((n) => n.subscriptionId), [b.id, a.id])
    assert.equal((await put([a.id])).status, 400)
    assert.equal((await put([a.id, a.id])).status, 400)
    assert.equal((await put([a.id, 'nope'])).status, 400)
  } finally {
    await close()
  }
})

test('刷新订阅期间删掉了另一条订阅 → 刷新完成后它不会复活(按此刻的列表写回,不用拉取前的快照)', async () => {
  let store
  let deleteDuringFetch = false
  const fetchImpl = async () => {
    if (deleteDuringFetch) {
      // 模拟用户在拉取进行中删掉 Sub B(连同它的节点)
      const keep = store.getSubscriptions().filter((s) => s.name !== 'Sub B')
      const gone = store.getSubscriptions().find((s) => s.name === 'Sub B')
      store.setSubscriptions(keep)
      store.setNodes(store.getNodes().filter((n) => n.subscriptionId !== gone.id))
    }
    return { ok: true, status: 200, text: async () => HK_LINE }
  }
  const app = await startApp(fetchImpl)
  store = app.store
  try {
    const a = await (await postJson(app.baseUrl, '/api/openbox/subscriptions', { url: 'http://a', name: 'Sub A' })).json()
    await postJson(app.baseUrl, '/api/openbox/subscriptions', { url: 'http://b', name: 'Sub B' })
    assert.equal(store.getSubscriptions().length, 2)
    deleteDuringFetch = true
    const res = await postJson(app.baseUrl, `/api/openbox/subscriptions/${a.id}/refresh`, {})
    assert.equal(res.status, 200)
    assert.deepEqual(store.getSubscriptions().map((s) => s.name), ['Sub A'])
    assert.ok(store.getNodes().every((n) => n.subscriptionId === a.id))
  } finally {
    await app.close()
  }
})

// -------- 一条订阅多个地址 --------

const multiFetch = (byUrl) => async (url) => ({ ok: true, status: 200, text: async () => byUrl[url] ?? '' })

test('多个地址:逐个拉取、节点按地址顺序合在一起、完全相同的节点只留一份;记录里存 urls,url 是第一条', async () => {
  const fetchImpl = multiFetch({ 'http://a': [HK_LINE, VMESS_US].join('\n'), 'http://b': [HK_LINE, JP_LINE].join('\n') })
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', { urls: ['http://a', 'http://b'], name: 'Sub' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.nodeCount, 3, 'HK 在两个地址里都出现,只算一次')
    const [sub] = store.getSubscriptions()
    assert.deepEqual(sub.urls, ['http://a', 'http://b'])
    assert.equal(sub.url, 'http://a')
    assert.equal(store.getNodes().length, 3)
    assert.equal(new Set(store.getNodes().map((n) => n.originalTag)).size, 3)
  } finally {
    await close()
  }
})

test('多个地址里有一个拉不动:整次失败、报错点名那个地址,什么都不落库', async () => {
  const fetchImpl = async (url) => (url === 'http://bad'
    ? { ok: false, status: 502, text: async () => '' }
    : { ok: true, status: 200, text: async () => HK_LINE })
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', { urls: ['http://a', 'http://bad'], name: 'Sub' })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /http:\/\/bad/)
    assert.deepEqual(store.getSubscriptions(), [])
    assert.deepEqual(store.getNodes(), [])
  } finally {
    await close()
  }
})

test('刷新和改地址都按 urls 逐个重拉;只改名字不拉', async () => {
  const calls = []
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, status: 200, text: async () => (url === 'http://a' ? HK_LINE : JP_LINE) } }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', { urls: ['http://a', 'http://b'], name: 'Sub' })).json()
    assert.deepEqual(calls, ['http://a', 'http://b'])

    calls.length = 0
    const refresh = await postJson(baseUrl, `/api/openbox/subscriptions/${created.id}/refresh`, {})
    assert.equal(refresh.status, 200)
    assert.deepEqual(calls, ['http://a', 'http://b'])

    calls.length = 0
    const rename = await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Renamed' }),
    })
    assert.equal(rename.status, 200)
    assert.deepEqual(calls, [], '只改名字不该去拉')

    const shrink = await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ urls: ['http://b'] }),
    })
    assert.equal(shrink.status, 200)
    assert.deepEqual(calls, ['http://b'])
    const [sub] = store.getSubscriptions()
    assert.deepEqual(sub.urls, ['http://b'])
    assert.equal(sub.url, 'http://b')
    assert.equal(sub.nodeCount, 1)
  } finally {
    await close()
  }
})

test('老字段 url 照旧能用:只传 url 时记录里 urls 就是它一条', async () => {
  const { baseUrl, store, close } = await startApp(multiFetch({ 'http://a': HK_LINE }))
  try {
    await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://a', name: 'Sub' })
    assert.deepEqual(store.getSubscriptions()[0].urls, ['http://a'])
  } finally {
    await close()
  }
})

// -------- 节点池变没变:前端凭它决定要不要提示"重启内核生效" --------

test('每个动作都如实报 changed:上游没动的刷新、只改名字是 false;换了节点、换地址、删除是 true;任何动作都不自动重启', async () => {
  let body = HK_LINE
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => body })
  const { baseUrl, close } = await startApp(fetchImpl)
  const patch = (id, data) => fetch(`${baseUrl}/api/openbox/subscriptions/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json())
  const refresh = (id) => postJson(baseUrl, `/api/openbox/subscriptions/${id}/refresh`, {}).then((r) => r.json())
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://a', name: 'A' })).json()
    assert.equal(created.changed, true)

    assert.equal((await refresh(created.id)).changed, false, '上游没动')
    body = JP_LINE
    assert.equal((await refresh(created.id)).changed, true, '上游换了节点')

    assert.equal((await patch(created.id, { name: 'B' })).changed, false, '只改名字')
    body = VMESS_US
    assert.equal((await patch(created.id, { urls: ['http://b'] })).changed, true, '换地址且内容不同')

    const order = await (await fetch(`${baseUrl}/api/openbox/subscriptions/order`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [created.id] }) })).json()
    assert.equal(order.changed, false, '只有一条,顺序没变')

    const del = await (await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}`, { method: 'DELETE' })).json()
    assert.equal(del.changed, true)
    const delAgain = await (await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}`, { method: 'DELETE' })).json()
    assert.equal(delAgain.changed, false, '本来就不存在')
    // 没有任何 /apply 一类的接口:重启由用户在面板上点
    const apply = await postJson(baseUrl, '/api/openbox/subscriptions/apply', {})
    assert.equal(apply.status, 404)
  } finally {
    await close()
  }
})

// -------- 定期更新计划 --------

test('autoUpdate:新建时存下(归一化到 1~30 天、0~23 点),改它不重拉,关掉就是 null;粘贴来的订阅没有计划', async () => {
  let fetched = 0
  const fetchImpl = async () => { fetched += 1; return { ok: true, status: 200, text: async () => HK_LINE } }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  const patch = (id, data) => fetch(`${baseUrl}/api/openbox/subscriptions/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json())
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://a', name: 'A', autoUpdate: { enabled: true, days: 99, hour: 30 } })).json()
    assert.deepEqual(store.getSubscriptions()[0].autoUpdate, { enabled: true, days: 30, hour: 23 })
    assert.equal(fetched, 1)

    const r = await patch(created.id, { autoUpdate: { enabled: true, days: 3, hour: 4 } })
    assert.equal(r.changed, false)
    assert.equal(fetched, 1, '改计划不重拉')
    assert.deepEqual(store.getSubscriptions()[0].autoUpdate, { enabled: true, days: 3, hour: 4 })

    await patch(created.id, { autoUpdate: { enabled: false } })
    assert.equal(store.getSubscriptions()[0].autoUpdate, null)

    await postJson(baseUrl, '/api/openbox/subscriptions', { content: HK_LINE, name: 'P', autoUpdate: { enabled: true, days: 1, hour: 4 } })
    assert.equal(store.getSubscriptions()[1].autoUpdate, null, '粘贴来的没有地址,不给计划')
  } finally {
    await close()
  }
})

// -------- 审查第 9 项:刷新期间的修改不能被旧刷新结果覆盖 --------
const deferredFetch = () => {
  let release
  const gate = new Promise((r) => { release = r })
  const fetchImpl = async () => { await gate; return { ok: true, status: 200, text: async () => [HK_LINE, JP_LINE].join('\n') } }
  return { fetchImpl, release: () => release() }
}

test('refresh 期间只改了自动更新开关 → 刷新照常写节点,开关保持新值,不被拉取前的快照改回去', async () => {
  const { fetchImpl, release } = deferredFetch()
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    release()
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://a', name: 'old', autoUpdate: { enabled: true, days: 1, hour: 3 } })).json()
    const slow = deferredFetch()
    const { refreshSubscriptionById } = await import('./subscriptions.mjs')
    const refreshing = refreshSubscriptionById(store, created.id, { fetchImpl: slow.fetchImpl, lookup: fakePublicLookup })
    await new Promise((r) => setTimeout(r, 20))
    store.setSubscriptions(store.getSubscriptions().map((s) => (s.id === created.id ? { ...s, autoUpdate: { enabled: false, days: 1, hour: 3 } } : s)))
    slow.release()
    const r = await refreshing
    assert.equal(r.nodeCount, 2)
    const sub = store.getSubscriptions().find((s) => s.id === created.id)
    assert.equal(sub.autoUpdate.enabled, false)
    assert.equal(sub.nodeCount, 2)
    assert.equal(store.getNodes().filter((n) => n.subscriptionId === created.id).length, 2)
  } finally {
    await close()
  }
})

test('refresh 期间改了名字或来源 → 这次结果作废(报错、节点不动),新名字和新来源保留', async () => {
  const { fetchImpl, release } = deferredFetch()
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    release()
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://a', name: 'old' })).json()
    const { refreshSubscriptionById } = await import('./subscriptions.mjs')
    const slow = deferredFetch()
    const refreshing = refreshSubscriptionById(store, created.id, { fetchImpl: slow.fetchImpl, lookup: fakePublicLookup })
    await new Promise((r) => setTimeout(r, 20))
    store.setSubscriptions(store.getSubscriptions().map((s) => (s.id === created.id ? { ...s, name: 'new', url: 'http://c' } : s)))
    slow.release()
    await assert.rejects(refreshing, /modified while refreshing/)
    const sub = store.getSubscriptions().find((s) => s.id === created.id)
    assert.equal(sub.name, 'new')
    assert.equal(sub.url, 'http://c')
    // 节点还是创建时那 2 个(旧来源),没被这次刷新写成别的
    assert.equal(store.getNodes().filter((n) => n.subscriptionId === created.id).length, 2)
  } finally {
    await close()
  }
})

// -------- 审查第 5 项:校验过的地址要绑定到建连上,不给 DNS rebinding 留窗口 --------
test('拉订阅时把校验过的地址交给 fetch 实现(init.lookup),每一跳重定向都重新校验重新绑定', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    // 记下这一跳绑定的地址:调用 init.lookup 看它给谁
    const pinned = await new Promise((resolve, reject) => init.lookup('whatever', {}, (err, address, family) => (err ? reject(err) : resolve({ address, family }))))
    seen.push({ url: String(url), ...pinned })
    if (String(url) === 'http://first.example/sub') return { ok: false, status: 302, headers: new Headers({ location: 'http://second.example/sub' }) }
    return { ok: true, status: 200, text: async () => HK_LINE }
  }
  // 第一个域名校验时答 93.184.216.34,第二个答 8.8.8.8;若建连再解析一次就可能拿到别的地址
  const lookup = async (hostname) => [{ address: hostname === 'first.example' ? '93.184.216.34' : '8.8.8.8', family: 4 }]
  const { baseUrl, close } = await startApp(fetchImpl, lookup)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', { url: 'http://first.example/sub' })
    assert.equal(res.status, 200)
    assert.deepEqual(seen, [
      { url: 'http://first.example/sub', address: '93.184.216.34', family: 4 },
      { url: 'http://second.example/sub', address: '8.8.8.8', family: 4 },
    ])
  } finally {
    await close()
  }
})

// GitHub #27:机场按 User-Agent 拒第三方客户端时,第一个 UA 被 403 不能整次失败,要换下一个 UA 继续
test('创建时首个 UA 被 403 → 换下一个 UA 继续,第二个 UA 拿到节点就成功', async () => {
  const seen = []
  const fetchImpl = async (_url, init) => {
    const ua = init?.headers?.['User-Agent'] || ''
    seen.push(ua)
    if (seen.length === 1) return { ok: false, status: 403, text: async () => 'forbidden' }
    return { ok: true, status: 200, text: async () => SHARELINK_MULTI }
  }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://sub.example.com/a', name: 'Sub A' })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).nodeCount, 2)
    assert.equal(seen.length, 2)
    assert.notEqual(seen[0], seen[1], '第二次请求要换 UA')
    assert.equal(store.getNodes().length, 2)
  } finally {
    await close()
  }
})

test('创建时所有 UA 都被 403 → 400,错误里逐个列出 UA 和状态码;网络错误不换 UA、只请求一次', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return { ok: false, status: 403, text: async () => 'forbidden' }
  }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://sub.example.com/a', name: 'Sub A' })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.match(body.error, /User-Agent/)
    assert.match(body.error, /clash-verge\/v2\.0\.0 → HTTP 403/)
    assert.match(body.error, /Open-Box\/1\.0 → HTTP 403/)
    assert.ok(calls >= 3, `应逐个 UA 都试过:${calls}`)
    assert.deepEqual(store.getSubscriptions(), [])
  } finally {
    await close()
  }
  let netCalls = 0
  const netFail = async () => { netCalls += 1; throw new Error('ECONNRESET') }
  const app2 = await startApp(netFail)
  try {
    const res = await postJson(app2.baseUrl, '/api/openbox/subscriptions', { url: 'http://sub.example.com/a', name: 'Sub A' })
    assert.equal(res.status, 400)
    assert.equal(netCalls, 1, '网络错误和 UA 无关,不该逐个 UA 重试')
  } finally {
    await app2.close()
  }
})

// ---------- 订阅地址允许内网 / 本机(GitHub #42):自建 subconverter 就在局域网或路由器上 ----------
test('#42:内网 / 回环 / CGNAT 的订阅地址正常拉取(127.0.0.1、192.168.x.x、localhost → 127.0.0.1、::ffff:7f00:1、100.64.x)', async () => {
  const cases = [
    { url: 'http://127.0.0.1:25500/sub' },
    { url: 'http://192.168.1.2/sub' },
    { url: 'http://[::ffff:7f00:1]:9999/sub' },
    { url: 'http://100.64.0.1:9999/sub' },
    { url: 'http://localhost:25500/sub', lookup: async () => [{ address: '127.0.0.1', family: 4 }] },
  ]
  for (const c of cases) {
    let called = 0
    const fetchImpl = async () => { called += 1; return { ok: true, status: 200, text: async () => HK_LINE } }
    const { baseUrl, close } = await startApp(fetchImpl, c.lookup)
    try {
      const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', { url: c.url })
      assert.equal(res.status, 200, `${c.url} 应能拉取`)
      assert.equal(called, 1, `${c.url} 应真正发起拉取`)
    } finally {
      await close()
    }
  }
  // 创建也一样能存下
  let called = false
  const fetchImpl = async () => { called = true; return { ok: true, status: 200, text: async () => HK_LINE } }
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'http://192.168.198.123:25500/sub?target=clash', name: 'LAN' })
    assert.equal(res.status, 200)
    assert.equal(called, true)
    assert.equal(store.getSubscriptions().length, 1)
  } finally {
    await close()
  }
})

test('SSRF 防护(仍保留):未指定地址 / 链路本地(0.0.0.0、::、169.254.x、fe80::)→ 400,且从未真正拉取;file:// 照拒', async () => {
  const targets = ['0.0.0.0', '[::]', '169.254.1.1', '[fe80::1]']
  for (const host of targets) {
    let called = false
    const fetchImpl = async () => { called = true; return { ok: true, status: 200, text: async () => HK_LINE } }
    const { baseUrl, close } = await startApp(fetchImpl)
    try {
      const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', { url: `http://${host}:9999/sub` })
      assert.equal(res.status, 400, `host=${host} 应被拒绝`)
      assert.equal(called, false, `host=${host} 不应真正拉取`)
    } finally {
      await close()
    }
  }
})

test('重定向逐跳仍校验:302 到内网地址放行并真的去拉;302 到链路本地 → 400、从未打到目标', async () => {
  const run = async (location) => {
    let hit = ''
    const fetchImpl = async (url, options) => {
      if (url === 'https://public.example.com/sub' && options && options.redirect === 'manual') {
        return { ok: false, status: 302, headers: { get: (name) => (name.toLowerCase() === 'location' ? location : null) } }
      }
      hit = String(url)
      return { ok: true, status: 200, text: async () => HK_LINE }
    }
    const { baseUrl, close } = await startApp(fetchImpl)
    try {
      const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', { url: 'https://public.example.com/sub' })
      return { status: res.status, hit }
    } finally {
      await close()
    }
  }
  const lan = await run('http://192.168.1.2:25500/real')
  assert.equal(lan.status, 200)
  assert.equal(lan.hit, 'http://192.168.1.2:25500/real')
  const linkLocal = await run('http://169.254.1.1/evil')
  assert.equal(linkLocal.status, 400)
  assert.equal(linkLocal.hit, '')
})

// ---------- GitHub #37:Node fetch 全被拒 → 系统 curl 兜底 ----------
test('#37:所有 UA 都被 403 时改用 curl 拉(同一个 UA、逐个试),拿到节点就用;没注入 curl 的测试路径不会去跑系统 curl', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'forbidden' })
  const curlCalls = []
  const curlFetch = async (url, { userAgent }) => {
    curlCalls.push(`${userAgent} ${url}`)
    // 第一个 UA 也被拒,第二个才通:兜底那边同样逐个试
    if (curlCalls.length === 1) return { status: 403, text: '' }
    return { status: 200, text: HK_LINE }
  }
  const { baseUrl, close } = await startApp(fetchImpl, fakePublicLookup, { curlFetch })
  try {
    const res = await postJson(baseUrl, '/api/openbox/subscriptions/preview', { url: 'https://public.example.com/sub' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.nodes && body.nodes.length >= 1, JSON.stringify(body).slice(0, 200))
    assert.equal(curlCalls.length, 2)
    assert.ok(curlCalls[0].startsWith('clash-verge/v2.0.0 https://public.example.com/sub'))
  } finally {
    await close()
  }
  // 系统没有 curl(available:false)→ 照旧报「拒绝了所有客户端标识」
  const { baseUrl: b2, close: c2 } = await startApp(fetchImpl, fakePublicLookup, { curlFetch: async () => ({ available: false }) })
  try {
    const res = await postJson(b2, '/api/openbox/subscriptions/preview', { url: 'https://public.example.com/sub' })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /拒绝了所有客户端标识/)
  } finally {
    await c2()
  }
})

// ---------- GitHub #40:订阅启用 / 停用 ----------
test('#40:PATCH enabled 只改开关不重拉,开关翻转算节点池变了(changed:true);停用的订阅节点不在 activeNodes 里,记录和节点池原样', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => HK_LINE })
  const { baseUrl, store, close } = await startApp(fetchImpl)
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'https://public.example.com/sub', name: 'A' })).json()
    const id = created.id
    const total = store.getNodes().length
    assert.ok(total >= 1)
    const off = await fetch(`${baseUrl}/api/openbox/subscriptions/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })
    assert.equal(off.status, 200)
    const offBody = await off.json()
    assert.equal(offBody.changed, true, '停用 = 节点不进内核,要提示重启')
    assert.equal(store.getSubscriptions()[0].enabled, false)
    assert.equal(store.getNodes().length, total, '节点池不动')
    const { activeNodes } = await import('./subscriptions.mjs')
    assert.equal(activeNodes(store).length, 0)
    // 再存一次同样的开关:没变化
    const same = await (await fetch(`${baseUrl}/api/openbox/subscriptions/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })).json()
    assert.equal(same.changed, false)
    const on = await (await fetch(`${baseUrl}/api/openbox/subscriptions/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) })).json()
    assert.equal(on.changed, true)
    assert.equal(activeNodes(store).length, total)
    const bad = await fetch(`${baseUrl}/api/openbox/subscriptions/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: 'yes' }) })
    assert.equal(bad.status, 400)
  } finally {
    await close()
  }
})

test('F1:curl 兜底传到一半失败 → 刷新失败,原有节点池和更新时间原样保留', async () => {
  let phase = 'create'
  const fetchImpl = async () => (phase === 'create'
    ? { ok: true, status: 200, text: async () => `${HK_LINE}\n${JP_LINE}` }
    : { ok: false, status: 403, text: async () => 'forbidden' })
  let curlCalls = 0
  const curlFetch = async () => { curlCalls += 1; return { status: 0, httpStatus: 200, error: 'curl 退出码 18:transfer closed with 65 bytes remaining to read' } }
  const { baseUrl, store, close } = await startApp(fetchImpl, fakePublicLookup, { curlFetch })
  try {
    const created = await (await postJson(baseUrl, '/api/openbox/subscriptions', { url: 'https://public.example.com/sub', name: 'A' })).json()
    const before = { nodes: JSON.stringify(store.getNodes()), updatedAt: store.getSubscriptions()[0].updatedAt }
    assert.equal(store.getNodes().length, 2)
    phase = 'refresh'
    const res = await fetch(`${baseUrl}/api/openbox/subscriptions/${created.id}/refresh`, { method: 'POST' })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /curl 退出码 18/)
    assert.equal(curlCalls, 1, '进程失败就停,不再换 UA 重试')
    assert.equal(JSON.stringify(store.getNodes()), before.nodes, '节点池原样')
    assert.equal(store.getSubscriptions()[0].updatedAt, before.updatedAt, '更新时间原样')
  } finally {
    await close()
  }
})
