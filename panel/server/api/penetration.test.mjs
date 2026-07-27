import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerPenetrationRoutes, matchRuleSet } from './penetration.mjs'
import { createStore } from '../store/openbox-store.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'

const paths = createPaths('/opt/open-box')
const cmds = (ctx) => ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))

const memStore = () => {
  const m = new Map()
  return createStore({
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => m.set(k, v),
    del: (k) => m.delete(k),
  })
}

const NODES = [
  { tag: 'HK-01', type: 'shadowsocks', server: 'hk.example.com', server_port: 443, fields: { method: 'aes-256-gcm', password: 'x' } },
  { tag: 'US-01', type: 'shadowsocks', server: 'us.example.com', server_port: 443, fields: { method: 'aes-256-gcm', password: 'x' } },
]

// 起一个绑定临时端口的最小 express app,注册待测路由;close() 必须在 finally 里调用,
// 防止测试遗留监听中的 server(参照 deploy.test.mjs 的写法)。
const startApp = async ({ ctx, store, fetchImpl } = {}) => {
  const realStore = store || memStore()
  const app = express()
  registerPenetrationRoutes(app, { store: realStore, ctx, paths, fetchImpl })
  const server = app.listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const { port } = server.address()
  return {
    store: realStore,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

const post = async (baseUrl, target) => {
  const res = await fetch(`${baseUrl}/api/openbox/penetration`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target }),
  })
  return { res, body: await res.json() }
}

// ---- matchRuleSet 单元测试:核心回归点 ----

test('matchRuleSet: stdout 含 "match rules." → true(即便退出码非 0,决策依据只看 stdout)', async () => {
  const ctx = createMockContext({
    execResults: {
      [`${paths.singbox} rule-set match -f binary /data/a.srs example.com`]: {
        code: 1, stdout: 'match rules.[0]: domain_suffix=a\n', stderr: '',
      },
    },
  })
  const hit = await matchRuleSet(ctx, paths, '/data/a.srs', 'example.com')
  assert.equal(hit, true)
})

test('matchRuleSet: stdout 为空 + 退出码 0 → false(防回归:严禁用退出码判定命中)', async () => {
  const ctx = createMockContext({
    execResults: {
      [`${paths.singbox} rule-set match -f binary /data/a.srs example.com`]: {
        code: 0, stdout: '', stderr: '',
      },
    },
  })
  const hit = await matchRuleSet(ctx, paths, '/data/a.srs', 'example.com')
  assert.equal(hit, false)
})

test('matchRuleSet: stdout 不匹配 /^match rules\\./m 的其它内容 + 退出码 0 → false', async () => {
  const ctx = createMockContext({
    execResults: {
      [`${paths.singbox} rule-set match -f binary /data/a.srs example.com`]: {
        code: 0, stdout: 'no match rules found\n', stderr: '',
      },
    },
  })
  const hit = await matchRuleSet(ctx, paths, '/data/a.srs', 'example.com')
  assert.equal(hit, false)
})

// ---- POST /api/openbox/penetration ----

test('POST /api/openbox/penetration 缺 target → 400,不 exec', async () => {
  const ctx = createMockContext({})
  const { baseUrl, close } = await startApp({ ctx })
  try {
    const { res, body } = await post(baseUrl, '')
    assert.equal(res.status, 400)
    assert.ok(body.message)
    assert.equal(ctx.calls.length, 0)
  } finally {
    await close()
  }
})

// ---- Important 6:target 校验(防 CLI 参数注入) ----
// target 最终会作为参数传给 `sing-box rule-set match`(execFile,无 shell),以 "-" 开头的
// 值会被当作 flag。必须在做任何 exec 之前拒绝。

test('POST /api/openbox/penetration target 以 "-" 开头("--help") → 400,不 exec', async () => {
  const ctx = createMockContext({})
  const { baseUrl, close } = await startApp({ ctx })
  try {
    const { res, body } = await post(baseUrl, '--help')
    assert.equal(res.status, 400)
    assert.ok(body.message)
    assert.equal(ctx.calls.length, 0)
  } finally {
    await close()
  }
})

test('POST /api/openbox/penetration target 以 "-" 开头("-x") → 400,不 exec', async () => {
  const ctx = createMockContext({})
  const { baseUrl, close } = await startApp({ ctx })
  try {
    const { res, body } = await post(baseUrl, '-x')
    assert.equal(res.status, 400)
    assert.ok(body.message)
    assert.equal(ctx.calls.length, 0)
  } finally {
    await close()
  }
})

test('POST /api/openbox/penetration 合法域名/IPv4/IPv6 target 仍然通过(不被参数校验误拦)', async () => {
  const ctx = createMockContext({ defaultExec: { code: 0, stdout: '' } })
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ name: 'PROXY' }) })
  const { baseUrl, close } = await startApp({ ctx, fetchImpl })
  try {
    for (const target of ['good.example.com', '8.8.8.8', '2001:4860:4860::8888']) {
      const { res, body } = await post(baseUrl, target)
      assert.equal(res.status, 200, `target=${target} 应通过校验`)
      assert.equal(body.finalOutbound, 'PROXY')
    }
  } finally {
    await close()
  }
})

test('按序首个命中生效:前一条 rule_set 命中时,后一条同样会命中的规则不会被求值(shadow)', async () => {
  const store = memStore()
  store.setProfile({
    routing: {
      proxyTag: 'PROXY',
      categories: [
        { ruleset: 'geosite-a', target: 'NodeA' },
        { ruleset: 'geosite-b', target: 'NodeB' },
      ],
      directRulesets: [],
      adBlock: false,
      fallback: 'PROXY',
    },
  })
  const target = 'a.example.com'
  const keyA = `${paths.singbox} rule-set match -f binary /opt/open-box/data/rulesets/geosite-a.srs ${target}`
  const keyB = `${paths.singbox} rule-set match -f binary /opt/open-box/data/rulesets/geosite-b.srs ${target}`
  const ctx = createMockContext({
    execResults: {
      [keyA]: { code: 0, stdout: 'match rules.[0]: domain_suffix=geosite-a\n' },
      [keyB]: { code: 0, stdout: 'match rules.[0]: domain_suffix=geosite-b\n' }, // 若被求值也会命中——用来暴露"未 short-circuit"的 bug
    },
  })
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ name: 'NodeA' }) })
  const { baseUrl, close } = await startApp({ ctx, store, fetchImpl })
  try {
    const { res, body } = await post(baseUrl, target)
    assert.equal(res.status, 200)
    assert.ok(body.matched)
    assert.equal(body.matched.rule.rule_set, 'geosite-a')
    assert.equal(body.matched.outbound, 'NodeA')
    assert.equal(body.finalOutbound, 'NodeA')

    // 关键断言:geosite-b 从未被求值
    assert.ok(!cmds(ctx).includes(keyB))
    assert.ok(cmds(ctx).includes(keyA))
  } finally {
    await close()
  }
})

test('无命中 → 落到 route.final,matched 为 null', async () => {
  const store = memStore()
  store.setProfile({
    routing: {
      proxyTag: 'PROXY',
      categories: [],
      directRulesets: ['geosite-cn'],
      adBlock: false,
      fallback: 'PROXY',
    },
  })
  const target = 'nowhere.example.org'
  const ctx = createMockContext({
    defaultExec: { code: 0, stdout: '' }, // 所有 rule-set match 都不命中
  })
  const fetchImpl = async (url) => {
    const u = new URL(url)
    if (u.pathname === '/proxies/PROXY') {
      return { ok: true, status: 200, json: async () => ({ name: 'PROXY', type: 'Selector', now: 'direct' }) }
    }
    return { ok: true, status: 200, json: async () => ({ name: 'direct', type: 'Direct' }) }
  }
  const { baseUrl, close } = await startApp({ ctx, store, fetchImpl })
  try {
    const { res, body } = await post(baseUrl, target)
    assert.equal(res.status, 200)
    assert.equal(body.matched, null)
    assert.equal(body.finalOutbound, 'PROXY')
    assert.deepEqual(body.chain, ['PROXY', 'direct'])
    assert.equal(body.chainError, undefined)
  } finally {
    await close()
  }
})

test('私有/回环 IP:ip_is_private 规则命中 outbound=direct,不触发任何 rule-set exec 或 clash_api 调用', async () => {
  const store = memStore()
  const ctx = createMockContext({})
  let fetchCalls = 0
  const fetchImpl = async () => { fetchCalls += 1; return { ok: true, status: 200, json: async () => ({}) } }
  const { baseUrl, close } = await startApp({ ctx, store, fetchImpl })
  try {
    for (const target of ['192.168.1.5', '127.0.0.1', '10.0.0.1']) {
      const { res, body } = await post(baseUrl, target)
      assert.equal(res.status, 200)
      assert.ok(body.matched)
      assert.equal(body.matched.rule.ip_is_private, true)
      assert.equal(body.matched.outbound, 'direct')
      assert.equal(body.finalOutbound, 'direct')
      assert.deepEqual(body.chain, ['direct'])
    }
    assert.equal(ctx.calls.length, 0) // ip_is_private 是纯 JS 判定,不 exec
    assert.equal(fetchCalls, 0) // direct 不是策略组,不查 clash_api
  } finally {
    await close()
  }
})

test('公网 IP 不命中 ip_is_private,继续走后续规则(落到 final)', async () => {
  const store = memStore()
  store.setProfile({
    routing: {
      proxyTag: 'PROXY', categories: [], directRulesets: [], adBlock: false, fallback: 'PROXY',
    },
  })
  const ctx = createMockContext({ defaultExec: { code: 0, stdout: '' } })
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ name: 'PROXY' }) })
  const { baseUrl, close } = await startApp({ ctx, store, fetchImpl })
  try {
    const { res, body } = await post(baseUrl, '8.8.8.8')
    assert.equal(res.status, 200)
    assert.equal(body.matched, null)
    assert.equal(body.finalOutbound, 'PROXY')
  } finally {
    await close()
  }
})

test('策略组下钻:outbound 为策略组时经 clash_api 沿 now 字段逐层下钻到叶子节点', async () => {
  const store = memStore()
  store.setNodes(NODES)
  store.setProfile({
    routing: {
      proxyTag: 'PROXY',
      categories: [{ ruleset: 'geosite-hk', target: 'HK' }],
      directRulesets: [],
      adBlock: false,
      fallback: 'PROXY',
    },
  })
  const target = 'hk.example.com'
  const keyHk = `${paths.singbox} rule-set match -f binary /opt/open-box/data/rulesets/geosite-hk.srs ${target}`
  const ctx = createMockContext({
    execResults: { [keyHk]: { code: 0, stdout: 'match rules.[0]: domain_suffix=geosite-hk\n' } },
  })

  const requestedPaths = []
  const fetchImpl = async (url, opts) => {
    const u = new URL(url)
    requestedPaths.push({ path: u.pathname, auth: opts && opts.headers && opts.headers.Authorization })
    if (u.pathname === '/proxies/HK') {
      return { ok: true, status: 200, json: async () => ({ name: 'HK', type: 'URLTest', now: 'HK-01' }) }
    }
    if (u.pathname === '/proxies/HK-01') {
      return { ok: true, status: 200, json: async () => ({ name: 'HK-01', type: 'Shadowsocks' }) } // 叶子:无 now
    }
    throw new Error(`unexpected path ${u.pathname}`)
  }

  const { baseUrl, close } = await startApp({ ctx, store, fetchImpl })
  try {
    const { res, body } = await post(baseUrl, target)
    assert.equal(res.status, 200)
    assert.equal(body.matched.outbound, 'HK')
    assert.equal(body.finalOutbound, 'HK')
    assert.deepEqual(body.chain, ['HK', 'HK-01'])
    assert.equal(body.chainError, undefined)

    assert.ok(requestedPaths.some((r) => r.path === '/proxies/HK'))
    assert.ok(requestedPaths.some((r) => r.path === '/proxies/HK-01'))
    // 携带了 clash secret 的 Bearer 鉴权
    const expectedSecret = store.getClashSecret()
    assert.ok(requestedPaths.every((r) => r.auth === `Bearer ${expectedSecret}`))
  } finally {
    await close()
  }
})

test('clash_api 不可达时降级:只返回组名 + chainError,不整体失败', async () => {
  const store = memStore()
  store.setNodes(NODES)
  store.setProfile({
    routing: {
      proxyTag: 'PROXY',
      categories: [{ ruleset: 'geosite-hk', target: 'HK' }],
      directRulesets: [],
      adBlock: false,
      fallback: 'PROXY',
    },
  })
  const target = 'hk.example.com'
  const keyHk = `${paths.singbox} rule-set match -f binary /opt/open-box/data/rulesets/geosite-hk.srs ${target}`
  const ctx = createMockContext({
    execResults: { [keyHk]: { code: 0, stdout: 'match rules.[0]: domain_suffix=geosite-hk\n' } },
  })
  const fetchImpl = async () => { throw new Error('ECONNREFUSED') }

  const { baseUrl, close } = await startApp({ ctx, store, fetchImpl })
  try {
    const { res, body } = await post(baseUrl, target)
    assert.equal(res.status, 200) // 整体请求仍然成功
    assert.equal(body.matched.outbound, 'HK')
    assert.equal(body.finalOutbound, 'HK')
    assert.deepEqual(body.chain, ['HK']) // 降级:只有组名本身
    assert.equal(typeof body.chainError, 'string')
    assert.ok(body.chainError.length > 0)
  } finally {
    await close()
  }
})

test('clash_api 返回非 2xx 时同样降级为 chainError', async () => {
  const store = memStore()
  store.setNodes(NODES)
  store.setProfile({
    routing: {
      proxyTag: 'PROXY',
      categories: [{ ruleset: 'geosite-hk', target: 'HK' }],
      directRulesets: [],
      adBlock: false,
      fallback: 'PROXY',
    },
  })
  const target = 'hk.example.com'
  const keyHk = `${paths.singbox} rule-set match -f binary /opt/open-box/data/rulesets/geosite-hk.srs ${target}`
  const ctx = createMockContext({
    execResults: { [keyHk]: { code: 0, stdout: 'match rules.[0]: domain_suffix=geosite-hk\n' } },
  })
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) })

  const { baseUrl, close } = await startApp({ ctx, store, fetchImpl })
  try {
    const { res, body } = await post(baseUrl, target)
    assert.equal(res.status, 200)
    assert.deepEqual(body.chain, ['HK'])
    assert.equal(typeof body.chainError, 'string')
  } finally {
    await close()
  }
})

test('ad-block reject 规则命中:matched.action=reject,无 outbound,不下钻', async () => {
  const store = memStore()
  store.setProfile({
    routing: {
      proxyTag: 'PROXY',
      categories: [],
      directRulesets: [],
      adBlock: true,
      adRuleset: 'geosite-ads',
      fallback: 'PROXY',
    },
  })
  const target = 'ads.example.com'
  const keyAds = `${paths.singbox} rule-set match -f binary /opt/open-box/data/rulesets/geosite-ads.srs ${target}`
  const ctx = createMockContext({
    execResults: { [keyAds]: { code: 0, stdout: 'match rules.[0]: domain_suffix=geosite-ads\n' } },
  })
  let fetchCalls = 0
  const fetchImpl = async () => { fetchCalls += 1; return { ok: true, status: 200, json: async () => ({}) } }

  const { baseUrl, close } = await startApp({ ctx, store, fetchImpl })
  try {
    const { res, body } = await post(baseUrl, target)
    assert.equal(res.status, 200)
    assert.equal(body.matched.action, 'reject')
    assert.equal(body.matched.outbound, undefined)
    assert.equal(body.finalOutbound, null)
    assert.deepEqual(body.chain, [])
    assert.equal(fetchCalls, 0)
  } finally {
    await close()
  }
})
