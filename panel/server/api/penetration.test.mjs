import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerPenetrationRoutes, matchRuleSet } from './penetration.mjs'
import { createStore } from '../store/openbox-store.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'

const paths = createPaths('/opt/open-box')
const cmds = (ctx) => ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))

// matchRuleSet 现在会先 ctx.exists() 探测 sing-box 二进制 + .srs 文件是否存在(Important 1:
// 缺失时必须报 could-not-check,不能读成"未命中")。这里给"正常跑起来了"的测试用例统一搭好
// 这两个文件的存在性,免得每个用例都重复写。srsPaths 額外传入具体会被探测到的 .srs 路径。
const withSingbox = (...srsPaths) => {
  const files = { [paths.singbox]: 'binary' }
  for (const p of srsPaths) files[p] = 'srs'
  return files
}

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
// 实测(sing-box 1.13.14 二进制):"match rules." 那一行实际写在 stderr,stdout 恒为空。
// 判定必须同时看 stdout + stderr,且永远不能用退出码判定命中——下面覆盖两个流各自命中的
// 情形,以及退出码在两种情形下都被忽略。
//
// matchRuleSet 现在返回 { hit, error } 而不是裸 boolean(P4b 终审 Important 1)——下面每个
// "正常跑起来了"的用例都用 withSingbox() 把二进制 + .srs 的存在性搭好,这样才能实际走到
// exec 这一步,而不是在前置存在性检查就被拦成 could-not-check。

test('matchRuleSet: stdout 含 "match rules."(stderr 为空)→ hit:true', async () => {
  const ctx = createMockContext({
    files: withSingbox('/data/a.srs'),
    execResults: {
      [`${paths.singbox} rule-set match -f binary /data/a.srs example.com`]: {
        code: 0, stdout: 'match rules.[0]: domain_suffix=a\n', stderr: '',
      },
    },
  })
  const result = await matchRuleSet(ctx, paths, '/data/a.srs', 'example.com')
  assert.deepEqual(result, { hit: true })
})

test('matchRuleSet: stderr 含 "match rules."(stdout 为空)→ hit:true(sing-box 1.13.14 实测:match 结果实际写在 stderr)', async () => {
  const ctx = createMockContext({
    files: withSingbox('/data/a.srs'),
    execResults: {
      [`${paths.singbox} rule-set match -f binary /data/a.srs example.com`]: {
        code: 0, stdout: '', stderr: 'match rules.[0]: domain/domain_suffix=<binary>\n',
      },
    },
  })
  const result = await matchRuleSet(ctx, paths, '/data/a.srs', 'example.com')
  assert.deepEqual(result, { hit: true })
})

test('matchRuleSet: stdout 命中 + 退出码非 0 → hit:true(防回归:退出码依然被忽略)', async () => {
  const ctx = createMockContext({
    files: withSingbox('/data/a.srs'),
    execResults: {
      [`${paths.singbox} rule-set match -f binary /data/a.srs example.com`]: {
        code: 1, stdout: 'match rules.[0]: domain_suffix=a\n', stderr: '',
      },
    },
  })
  const result = await matchRuleSet(ctx, paths, '/data/a.srs', 'example.com')
  assert.deepEqual(result, { hit: true })
})

test('matchRuleSet: stderr 命中 + 退出码非 0 → hit:true(防回归:退出码依然被忽略,即便命中信息在 stderr)', async () => {
  const ctx = createMockContext({
    files: withSingbox('/data/a.srs'),
    execResults: {
      [`${paths.singbox} rule-set match -f binary /data/a.srs example.com`]: {
        code: 1, stdout: '', stderr: 'match rules.[0]: domain/domain_suffix=<binary>\n',
      },
    },
  })
  const result = await matchRuleSet(ctx, paths, '/data/a.srs', 'example.com')
  assert.deepEqual(result, { hit: true })
})

test('matchRuleSet: stdout 和 stderr 均为空 + 退出码 0 → hit:false, 无 error(防回归:真正跑完的"不命中"不能被误判成 could-not-check)', async () => {
  const ctx = createMockContext({
    files: withSingbox('/data/a.srs'),
    execResults: {
      [`${paths.singbox} rule-set match -f binary /data/a.srs example.com`]: {
        code: 0, stdout: '', stderr: '',
      },
    },
  })
  const result = await matchRuleSet(ctx, paths, '/data/a.srs', 'example.com')
  assert.deepEqual(result, { hit: false })
})

test('matchRuleSet: stdout/stderr 均不匹配 /^match rules\\./m 的其它内容 + 退出码 0 → hit:false, 无 error', async () => {
  const ctx = createMockContext({
    files: withSingbox('/data/a.srs'),
    execResults: {
      [`${paths.singbox} rule-set match -f binary /data/a.srs example.com`]: {
        code: 0, stdout: 'no match rules found\n', stderr: 'some unrelated warning\n',
      },
    },
  })
  const result = await matchRuleSet(ctx, paths, '/data/a.srs', 'example.com')
  assert.deepEqual(result, { hit: false })
})

// ---- matchRuleSet 单元测试:could-not-check(P4b 终审 Important 1)----
// 三种"没能真正检查"的情形:sing-box 二进制缺失、.srs 文件缺失、进程异常退出且没有任何
// 输出(context-real.mjs 里 execFile spawn 失败时的真实折叠形态:{code:1,stdout:'',stderr:''})。
// 三种都必须报 error,而不是安静地读成"确认不命中"。

test('matchRuleSet: sing-box 二进制不存在 → hit:false + error,且不执行 exec(不存在的命令没法 exec)', async () => {
  const ctx = createMockContext({
    files: { '/data/a.srs': 'srs' }, // 只有 .srs,没有二进制
    defaultExec: { code: 1, stdout: '', stderr: '' }, // 万一真的 exec 了,也不能被读成命中
  })
  const result = await matchRuleSet(ctx, paths, '/data/a.srs', 'example.com')
  assert.equal(result.hit, false)
  assert.equal(typeof result.error, 'string')
  assert.ok(result.error.length > 0)
  assert.equal(ctx.calls.length, 0, '二进制都不存在,不应该还去 exec 它')
})

test('matchRuleSet: .srs 文件不存在 → hit:false + error,且不执行 exec', async () => {
  const ctx = createMockContext({
    files: { [paths.singbox]: 'binary' }, // 只有二进制,没有 .srs
    defaultExec: { code: 1, stdout: '', stderr: '' },
  })
  const result = await matchRuleSet(ctx, paths, '/data/missing.srs', 'example.com')
  assert.equal(result.hit, false)
  assert.equal(typeof result.error, 'string')
  assert.ok(result.error.length > 0)
  assert.equal(ctx.calls.length, 0, '.srs 都不存在,不应该还去 exec')
})

test('matchRuleSet: 退出码非 0 + stdout/stderr 均为空 → hit:false + error(could-not-check,不是"确认不命中")', async () => {
  // 这正是 context-real.mjs 在 execFile 本身失败(比如命令路径存在但不可执行、或系统层面
  // 的 spawn 错误)时折叠出来的形态——和"跑完了、就是没找到匹配"在字节上完全一样,
  // 只能靠"非 0 退出码 + 全空输出"这个信号加上前置存在性检查来分辨。
  const ctx = createMockContext({
    files: withSingbox('/data/a.srs'),
    execResults: {
      [`${paths.singbox} rule-set match -f binary /data/a.srs example.com`]: {
        code: 1, stdout: '', stderr: '',
      },
    },
  })
  const result = await matchRuleSet(ctx, paths, '/data/a.srs', 'example.com')
  assert.equal(result.hit, false)
  assert.equal(typeof result.error, 'string')
  assert.ok(result.error.length > 0)
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
  // 走默认 profile(directRulesets: ['geosite-cn','geoip-cn']),所以要把这两个 .srs 的
  // 存在性也搭好,否则会在 could-not-check 那条路径上被拦下来,而不是这个用例真正想测的
  // 参数校验路径。
  const ctx = createMockContext({
    files: withSingbox(
      '/opt/open-box/data/rulesets/geosite-cn.srs',
      '/opt/open-box/data/rulesets/geoip-cn.srs',
    ),
    defaultExec: { code: 0, stdout: '' },
  })
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
    // geosite-b 从未被求值(短路),所以只需要 geosite-a 的 .srs 存在即可让 matchRuleSet
    // 走到 exec 那一步。
    files: withSingbox('/opt/open-box/data/rulesets/geosite-a.srs'),
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
    files: withSingbox('/opt/open-box/data/rulesets/geosite-cn.srs'),
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
    files: withSingbox('/opt/open-box/data/rulesets/geosite-hk.srs'),
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
    files: withSingbox('/opt/open-box/data/rulesets/geosite-hk.srs'),
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
    files: withSingbox('/opt/open-box/data/rulesets/geosite-hk.srs'),
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
    files: withSingbox('/opt/open-box/data/rulesets/geosite-ads.srs'),
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

// ---- POST /api/openbox/penetration:matchError(P4b 终审 Important 1)----
// 端到端验证:.srs 缺失 / sing-box 异常退出且无输出这两种"没能真正检查"的情形,必须让整个
// 响应带上 matchError,并且 matched 停在 null——不能悄悄落到 route.final 冒充"确认没命中"。

test('POST /penetration:.srs 文件缺失 → 200 + matchError,matched 为 null,finalOutbound 也不敢冒充 route.final', async () => {
  const store = memStore()
  store.setProfile({
    routing: {
      proxyTag: 'PROXY', categories: [], directRulesets: ['geosite-cn'], adBlock: false, fallback: 'PROXY',
    },
  })
  const target = 'missing-srs.example.com'
  // 只给二进制搭好存在性,geosite-cn.srs 故意不放进 files——模拟部署损坏/文件被删的情形。
  const ctx = createMockContext({ files: { [paths.singbox]: 'binary' } })
  let fetchCalls = 0
  const fetchImpl = async () => { fetchCalls += 1; return { ok: true, status: 200, json: async () => ({}) } }

  const { baseUrl, close } = await startApp({ ctx, store, fetchImpl })
  try {
    const { res, body } = await post(baseUrl, target)
    assert.equal(res.status, 200)
    assert.equal(body.matched, null)
    assert.equal(body.finalOutbound, null) // 不能冒充"落到 route.final"——那条没查成的规则也许原本会命中
    assert.deepEqual(body.chain, [])
    assert.equal(typeof body.matchError, 'string')
    assert.ok(body.matchError.length > 0)
    assert.ok(body.matchError.includes('geosite-cn'))
    assert.equal(fetchCalls, 0) // finalOutbound 是 null,不是策略组 tag,不该去查 clash_api
  } finally {
    await close()
  }
})

test('POST /penetration:sing-box 异常退出且无输出 → 200 + matchError,不是"确认不命中"', async () => {
  const store = memStore()
  store.setProfile({
    routing: {
      proxyTag: 'PROXY', categories: [], directRulesets: ['geosite-cn'], adBlock: false, fallback: 'PROXY',
    },
  })
  const target = 'crash.example.com'
  const key = `${paths.singbox} rule-set match -f binary /opt/open-box/data/rulesets/geosite-cn.srs ${target}`
  const ctx = createMockContext({
    files: withSingbox('/opt/open-box/data/rulesets/geosite-cn.srs'),
    execResults: { [key]: { code: 1, stdout: '', stderr: '' } },
  })

  const { baseUrl, close } = await startApp({ ctx, store })
  try {
    const { res, body } = await post(baseUrl, target)
    assert.equal(res.status, 200)
    assert.equal(body.matched, null)
    assert.equal(body.finalOutbound, null)
    assert.equal(typeof body.matchError, 'string')
    assert.ok(body.matchError.length > 0)
  } finally {
    await close()
  }
})

test('POST /penetration:could-not-check 命中后立刻停止求值——后面同样会命中的规则不会被拿来冒充确定结果', async () => {
  const store = memStore()
  store.setProfile({
    routing: {
      proxyTag: 'PROXY',
      categories: [
        { ruleset: 'geosite-a', target: 'NodeA' }, // .srs 缺失 → could-not-check
        { ruleset: 'geosite-b', target: 'NodeB' }, // 若被求值也会命中——用来证明循环已经停了
      ],
      directRulesets: [],
      adBlock: false,
      fallback: 'PROXY',
    },
  })
  const target = 'a.example.com'
  const keyB = `${paths.singbox} rule-set match -f binary /opt/open-box/data/rulesets/geosite-b.srs ${target}`
  const ctx = createMockContext({
    files: { [paths.singbox]: 'binary' }, // geosite-a.srs 故意缺失,geosite-b.srs 也不存在但不该被检查到
    execResults: {
      [keyB]: { code: 0, stdout: 'match rules.[0]: domain_suffix=geosite-b\n' },
    },
  })

  const { baseUrl, close } = await startApp({ ctx, store })
  try {
    const { res, body } = await post(baseUrl, target)
    assert.equal(res.status, 200)
    assert.equal(body.matched, null)
    assert.equal(typeof body.matchError, 'string')
    assert.ok(body.matchError.includes('geosite-a'))

    // 关键断言:geosite-b 从未被求值——不能因为它"如果查了也会命中"就被拿来当作确定答案。
    assert.ok(!cmds(ctx).includes(keyB))
  } finally {
    await close()
  }
})

test('POST /penetration:更早的确定命中(ip_is_private)优先于后面失效的 rule_set——不应该出现 matchError', async () => {
  const store = memStore()
  store.setProfile({
    routing: {
      proxyTag: 'PROXY', categories: [], directRulesets: ['geosite-cn'], adBlock: false, fallback: 'PROXY',
    },
  })
  // geosite-cn.srs 故意缺失,但 target 是私网 IP,ip_is_private 规则排在 rule_set 规则之前
  // 且是纯 JS 判定、不需要 exec,应该在到达那条坏掉的规则之前就已经 break 出循环。
  const ctx = createMockContext({ files: { [paths.singbox]: 'binary' } })

  const { baseUrl, close } = await startApp({ ctx, store })
  try {
    const { res, body } = await post(baseUrl, '192.168.1.5')
    assert.equal(res.status, 200)
    assert.ok(body.matched)
    assert.equal(body.matched.rule.ip_is_private, true)
    assert.equal(body.finalOutbound, 'direct')
    assert.equal(body.matchError, undefined)
    assert.equal(ctx.calls.length, 0) // 从未走到 rule_set 那条规则
  } finally {
    await close()
  }
})
