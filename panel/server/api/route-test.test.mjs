import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerRouteTestRoutes, decideDnsServer, isFakeIp } from './route-test.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'

const paths = createPaths('/opt/open-box')
const config = {
  dns: {
    servers: [
      { type: 'local', tag: 'dns-direct' },
      { type: 'tcp', tag: 'dns-proxy', server: '1.1.1.1', detour: '其他' },
      { type: 'tcp', tag: 'dns-policy-0', server: '1.1.1.1', detour: 'AI' },
    ],
    rules: [
      { rule_set: ['geosite-openai'], server: 'dns-policy-0' },
      { domain_suffix: ['baidu.com'], server: 'dns-direct' },
    ],
    final: 'dns-proxy',
  },
  route: { rule_set: [{ type: 'local', tag: 'geosite-openai', path: `${paths.rulesetDir}/geosite-openai.srs` }] },
}

test('decideDnsServer:域名条件本地判;规则集经内核;都不中落到 final', async () => {
  const srs = `${paths.rulesetDir}/geosite-openai.srs`
  const ctx = createMockContext({
    files: { [paths.singbox]: 'x', [srs]: 'x' },
    execResults: { [`${paths.singbox} rule-set match -f binary ${srs} api.openai.com`]: { code: 0, stderr: 'match rules.\n' } },
  })
  const a = await decideDnsServer(ctx, paths, config, 'www.baidu.com')
  assert.equal(a.server.tag, 'dns-direct'); assert.equal(a.viaProxy, false); assert.equal(a.ruleIndex, 1)
  const b = await decideDnsServer(ctx, paths, config, 'api.openai.com')
  assert.equal(b.server.tag, 'dns-policy-0'); assert.equal(b.viaProxy, true); assert.equal(b.server.detour, 'AI')
  const c = await decideDnsServer(ctx, paths, config, 'example.org')
  assert.equal(c.server.tag, 'dns-proxy'); assert.equal(c.ruleIndex, null)
})

test('POST /route-test:内核解析 + 真实访问 + 在连接表里找到这条连接的链路', async () => {
  // 规则集文件要在:第一条 dns 规则是 rule_set,缺文件会被判成"没法确认"而不是"不命中"
  const ctx = createMockContext({ files: { [paths.configPath]: JSON.stringify(config), [paths.singbox]: 'x', [`${paths.rulesetDir}/geosite-openai.srs`]: 'x' } })
  const fetchImpl = async (url) => {
    if (url.includes('/dns/query')) return { ok: true, status: 200, json: async () => ({ Answer: [{ data: '39.156.66.10' }] }) }
    if (url.includes('/connections')) return { ok: true, status: 200, json: async () => ({ connections: [
      { metadata: { host: 'www.baidu.com', destinationIP: '39.156.66.10' }, chains: ['直连', '中国'], rule: 'RuleSet(geosite-cn)', rulePayload: '', start: '2026-09-03T00:00:00Z' },
    ] }) }
    throw new Error('unexpected fetch ' + url)
  }
  const probeCalls = []
  const probe = async (host, opts) => { probeCalls.push({ host, ...opts }); return { ok: true, status: opts.port === 443 ? 200 : 301, ms: 7 } }
  const app = express()
  registerRouteTestRoutes(app, { store: { getClashSecret: () => 's' }, ctx, paths, fetchImpl, probe })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/openbox/route-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'www.baidu.com' }) })
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.dns.server.tag, 'dns-direct')
    assert.deepEqual(body.resolve.answers, ['39.156.66.10'])
    assert.equal(body.exit.status, 200)
    assert.equal(body.exit.ms, 7)
    assert.deepEqual(body.exit.chains, ['中国', '直连'])
    assert.equal(body.exit.rule, 'RuleSet(geosite-cn)')
    // 探测像终端一样按解析出来的 IP 去连,SNI / Host 仍是域名;链路末尾是内置直连,不算走节点
    assert.deepEqual(probeCalls, [{ host: 'www.baidu.com', port: 443, secure: true, connectTo: '39.156.66.10' }])
    assert.equal(body.exit.connectTo, '39.156.66.10')
    assert.equal(body.exit.viaProxy, false)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

// 访问失败(对端关连接、超时)的那一刻这条连接就从内核连接表里消失了,所以要趁请求还挂着的时候
// 就去找;认的是面板回环入站(mixed/panel-in)+ 目标端口 + 目标,别的终端到同一目标的连接不算
test('POST /route-test:访问失败也报出站链路——请求挂着的时候就从连接表里认出探测连接', async () => {
  const ctx = createMockContext({ files: { [paths.configPath]: JSON.stringify(config), [paths.singbox]: 'x' } })
  const run = async ({ withProbeConn }) => {
    let probeDone = false
    const fetchImpl = async (url) => {
      if (url.includes('/connections')) return { ok: true, status: 200, json: async () => ({ connections: [
        // 别的终端到同一目标的连接,更新、走直连——不能被当成探测连接
        { metadata: { type: 'tun/tun-in', host: '', destinationIP: '8.8.8.8', destinationPort: '53', sourceIP: '192.168.3.10' }, chains: ['直连', '国内'], rule: 'x', start: '2026-09-05T00:00:01Z' },
        // 面板探测的那条:访问失败前在表里,失败后立刻消失
        ...(withProbeConn && !probeDone ? [{ metadata: { type: 'mixed/panel-in', host: '', destinationIP: '8.8.8.8', destinationPort: '80', sourceIP: '127.0.0.1' }, chains: ['VW | 香港-OS-01', '香港-自动', '国外'], rule: 'rule_set=[geoip-google] => route(国外)', start: '2026-09-05T00:00:00Z' }] : []),
      ] }) }
      throw new Error('unexpected fetch ' + url)
    }
    const probe = () => new Promise((resolve) => setTimeout(() => { probeDone = true; resolve({ ok: false, error: 'connection closed', ms: 5041 }) }, 250))
    const app = express()
    registerRouteTestRoutes(app, { store: { getClashSecret: () => 's' }, ctx, paths, fetchImpl, probe })
    const server = app.listen(0)
    await new Promise((r) => server.once('listening', r))
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/openbox/route-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: '8.8.8.8' }) })
      assert.equal(res.status, 200)
      return (await res.json()).exit
    } finally {
      await new Promise((r) => server.close(r))
    }
  }
  const failed = await run({ withProbeConn: true })
  assert.equal(failed.ok, false)
  assert.equal(failed.error, 'connection closed')
  assert.equal(failed.ms, 5041)
  assert.deepEqual(failed.chains, ['国外', '香港-自动', 'VW | 香港-OS-01'])
  assert.equal(failed.destinationIP, '8.8.8.8')
  assert.equal(failed.viaProxy, true)
  assert.equal(failed.connectTo, undefined)
  assert.equal(failed.notSeen, undefined)
  // 连接表里始终没有探测连接:失败照报,另标"没认出这条连接";别的终端那条不能顶上
  const unseen = await run({ withProbeConn: false })
  assert.equal(unseen.error, 'connection closed')
  assert.equal(unseen.chains, undefined)
  assert.equal(unseen.notSeen, true)
})

// 配置里的 DNS 决策是生成那一刻定死的:站点集在直连 / 代理之间翻面之后,这条决策就过期了。
// 正常情况下面板会在后台重新生成(见 server/index.mjs),这里标出来的是那几秒窗口。
test('DNS 规则过期:内核里的选择和配置里定死的判断对不上就标出来,只换代理线路不标', async () => {
  const staleConfig = {
    dns: {
      servers: [
        { type: 'udp', tag: 'dns-direct', server: '192.168.1.1' },
        { type: 'tcp', tag: 'dns-proxy', server: '1.1.1.1', detour: '其他' },
      ],
      rules: [{ domain_suffix: ['baidu.com'], server: 'dns-direct' }],
      final: 'dns-proxy',
    },
    route: { rule_set: [] },
  }
  const ctx = createMockContext({ files: { [paths.configPath]: JSON.stringify(staleConfig), [paths.singbox]: 'x' } })
  const store = {
    getClashSecret: () => 's',
    getGroups: () => [],
    getProfile: () => ({ routing: { fallbackDefault: 'proxy', policies: [{ name: '国内', default: 'direct', domainSuffix: ['baidu.com'] }] } }),
  }
  const run = async (proxies, target) => {
    const fetchImpl = async (url) => {
      if (url.includes('/proxies')) return { ok: true, status: 200, json: async () => ({ proxies }) }
      if (url.includes('/dns/query')) return { ok: true, status: 200, json: async () => ({ Answer: [] }) }
      if (url.includes('/connections')) return { ok: true, status: 200, json: async () => ({ connections: [] }) }
      throw new Error('unexpected fetch ' + url)
    }
    const app = express()
    registerRouteTestRoutes(app, { store, ctx, paths, fetchImpl, probe: async () => ({ ok: false, error: 'timeout', ms: 1 }) })
    const server = app.listen(0)
    await new Promise((r) => server.once('listening', r))
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/openbox/route-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target }) })
      return (await res.json()).dns
    } finally {
      await new Promise((r) => server.close(r))
    }
  }
  // 兜底还在走代理(只是从香港换到了美国):final 指着代理侧解析器,没过期
  const fresh = await run({ 其他: { now: '美国-自动' } }, 'example.org')
  assert.equal(fresh.stale, undefined)
  assert.equal(fresh.runtimeLeaf, '美国-自动')
  // 兜底切到了直连:配置里 final 还指着代理侧解析器(detour 已经变成直连,查询会超时)
  const stale = await run({ 其他: { now: '直连' } }, 'example.org')
  assert.equal(stale.stale, 'direct')
  // 走直连的站点集切到了节点组:配置里那条规则还写着 dns-direct
  const staleProxy = await run({ 国内: { now: '香港-自动' } }, 'www.baidu.com')
  assert.equal(staleProxy.stale, 'proxy')
})

test('fake-ip:代理侧解析回 198.18.x.x 就标出是 detour 此刻落到的那个节点答的;直连解析回 fake-ip 不带节点', async () => {
  assert.equal(isFakeIp('198.18.0.55'), true)
  assert.equal(isFakeIp('198.19.255.1'), true)
  assert.equal(isFakeIp('198.17.0.1'), false)
  assert.equal(isFakeIp('142.250.66.4'), false)
  assert.equal(isFakeIp('fc00::1'), true)
  assert.equal(isFakeIp('fd00::1'), false)
  const config = {
    dns: {
      servers: [
        { type: 'udp', tag: 'dns-direct', server: '192.168.3.5' },
        { type: 'tcp', tag: 'dns-policy-7', server: '1.1.1.1', detour: 'Google' },
      ],
      rules: [{ domain_suffix: ['google.com'], server: 'dns-policy-7' }],
      final: 'dns-direct',
    },
    route: { rule_set: [] },
  }
  const ctx = createMockContext({ files: { [paths.configPath]: JSON.stringify(config), [paths.singbox]: 'x' } })
  const store = { getClashSecret: () => 's', getGroups: () => [], getProfile: () => ({ routing: {} }) }
  const run = async (target, answer) => {
    const fetchImpl = async (url) => {
      if (url.includes('/proxies')) return { ok: true, status: 200, json: async () => ({ proxies: { Google: { now: '香港-自动' }, '香港-自动': { now: 'VW | 香港-HOME-01' } } }) }
      if (url.includes('/dns/query')) return { ok: true, status: 200, json: async () => ({ Answer: [{ data: answer, TTL: 287 }] }) }
      if (url.includes('/connections')) return { ok: true, status: 200, json: async () => ({ connections: [] }) }
      throw new Error('unexpected fetch ' + url)
    }
    const app = express()
    registerRouteTestRoutes(app, { store, ctx, paths, fetchImpl, probe: async () => ({ ok: true, status: 200, ms: 1 }) })
    const server = app.listen(0)
    await new Promise((r) => server.once('listening', r))
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/openbox/route-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target }) })
      const body = await res.json()
      return { ...body.resolve, chain: body.dns.runtimeChain }
    } finally {
      await new Promise((r) => server.close(r))
    }
  }
  const viaProxy = await run('www.google.com', '198.18.0.55')
  assert.equal(viaProxy.fakeIp, true)
  assert.equal(viaProxy.fakeIpFrom, 'VW | 香港-HOME-01')
  assert.deepEqual(viaProxy.chain, ['Google', '香港-自动', 'VW | 香港-HOME-01'])
  const real = await run('www.google.com', '142.250.66.4')
  assert.equal(real.fakeIp, undefined)
  assert.equal(real.fakeIpFrom, undefined)
  // 代理侧解析几毫秒就回来 = 命中内核缓存;TTL 原样带回去
  assert.equal(real.ttl, 287)
  assert.equal(real.cached, true)
  const direct = await run('www.example.org', '198.18.1.2')
  assert.equal(direct.fakeIp, true)
  assert.equal(direct.fakeIpFrom, undefined)
  assert.equal(direct.chain, undefined)
  // 直连解析本来就快,分不出缓存,不标
  assert.equal(direct.cached, undefined)
})

test('POST /route-test:每次查询都先清内核 DNS 缓存,而且清在解析之前', async () => {
  const ctx = createMockContext({ files: { [paths.configPath]: JSON.stringify(config), [paths.singbox]: 'x', [`${paths.rulesetDir}/geosite-openai.srs`]: 'x' } })
  const run = async (body) => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push(`${(init && init.method) || 'GET'} ${url.replace(/^https?:\/\/[^/]+/, '')}`)
      if (url.includes('/cache/dns/flush')) return { ok: true, status: 204, json: async () => ({}) }
      if (url.includes('/dns/query')) return { ok: true, status: 200, json: async () => ({ Answer: [{ data: '39.156.66.10' }] }) }
      if (url.includes('/connections')) return { ok: true, status: 200, json: async () => ({ connections: [] }) }
      throw new Error('unexpected fetch ' + url)
    }
    const app = express()
    registerRouteTestRoutes(app, { store: { getClashSecret: () => 's' }, ctx, paths, fetchImpl, probe: async () => ({ ok: true, status: 200, ms: 3 }) })
    const server = app.listen(0)
    await new Promise((r) => server.once('listening', r))
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/openbox/route-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      assert.equal(res.status, 200)
      return calls
    } finally {
      await new Promise((r) => server.close(r))
    }
  }

  // 打字触发的那次也清:这一页的意义就是看真实路由,拿缓存答案没有意义
  const calls = await run({ target: 'www.baidu.com' })
  const iFlush = calls.findIndex((c) => c.includes('/cache/dns/flush'))
  const iQuery = calls.findIndex((c) => c.includes('/dns/query'))
  assert.ok(iFlush >= 0, `没有清缓存:${calls.join(' | ')}`)
  assert.ok(iFlush < iQuery, `清缓存必须在解析之前:${calls.join(' | ')}`)
  assert.ok(calls[iFlush].startsWith('POST '), calls[iFlush])

  // 目标是 IP 时没有解析这一步,也就不必清
  const ipCalls = await run({ target: '8.8.8.8' })
  assert.ok(!ipCalls.some((c) => c.includes('/cache/dns/flush')), ipCalls.join(' | '))
})
