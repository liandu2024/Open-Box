import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerRouteTestRoutes, decideDnsServer } from './route-test.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'

const paths = createPaths('/opt/open-box')
const config = {
  dns: {
    servers: [
      { type: 'local', tag: 'dns-direct' },
      { type: 'https', tag: 'dns-proxy', server: '1.1.1.1', detour: '其他' },
      { type: 'https', tag: 'dns-policy-0', server: '1.1.1.1', detour: 'AI' },
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
    return { ok: true, status: 200, body: null }
  }
  const app = express()
  registerRouteTestRoutes(app, { store: { getClashSecret: () => 's' }, ctx, paths, fetchImpl })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/openbox/route-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'www.baidu.com' }) })
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.dns.server.tag, 'dns-direct')
    assert.deepEqual(body.resolve.answers, ['39.156.66.10'])
    assert.equal(body.exit.status, 200)
    assert.deepEqual(body.exit.chains, ['中国', '直连'])
    assert.equal(body.exit.rule, 'RuleSet(geosite-cn)')
  } finally {
    await new Promise((r) => server.close(r))
  }
})
