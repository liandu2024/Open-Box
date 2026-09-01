import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import express from 'express'
import { registerNodeLatencyRoutes } from './node-latency.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'

const paths = createPaths('/opt/open-box')

// 域名默认解析到公网地址;负向用例单独注入。
const fakeLookup = async (hostname) => {
  const trimmed = String(hostname).replace(/^\[|\]$/g, '').trim()
  const v = net.isIP(trimmed)
  if (v) return [{ address: trimmed, family: v }]
  return [{ address: '8.8.8.8', family: 4 }]
}

const SUB = [
  'ss://YWVzLTI1Ni1nY206cHc=@a.example.com:8388#HK-01',
  'trojan://pw@b.example.com:443?sni=b.example.com#JP-01',
].join('\n')

const startApp = async ({ ctx = createMockContext(), lookup = fakeLookup } = {}) => {
  const app = express()
  registerNodeLatencyRoutes(app, { ctx, paths, fetchImpl: async () => { throw new Error('no net') }, lookup })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  return { ctx, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

const post = (baseUrl, body) =>
  fetch(`${baseUrl}/api/openbox/nodes/latency`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

test('tags 为空 → 400', async () => {
  const { baseUrl, close } = await startApp()
  try {
    assert.equal((await post(baseUrl, { content: SUB, tags: [] })).status, 400)
  } finally {
    await close()
  }
})

test('目标过多 → 400', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await post(baseUrl, { content: SUB, tags: Array.from({ length: 101 }, (_, i) => `t${i}`) })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /too many/)
  } finally {
    await close()
  }
})

test('走 sing-box tools fetch 拨号(不是裸 TCP 连接)', async () => {
  const { ctx, baseUrl, close } = await startApp()
  try {
    const res = await post(baseUrl, { content: SUB, tags: ['HK-01'] })
    assert.equal(res.status, 200)
    const [r] = (await res.json()).results
    assert.equal(r.ok, true)
    assert.ok(typeof r.ms === 'number')

    const call = ctx.calls.find((c) => c.args?.[0] === 'tools')
    assert.ok(call, '应当调用了 sing-box tools')
    assert.equal(call.cmd, paths.singbox)
    assert.deepEqual(call.args.slice(0, 2), ['tools', 'fetch'])
    assert.ok(call.args.includes('-o'), '必须指定出站,否则测的是默认直连')
  } finally {
    await close()
  }
})

test('探测配置只含被测节点的出站,写在 etc 下', async () => {
  const { ctx, baseUrl, close } = await startApp()
  try {
    await post(baseUrl, { content: SUB, tags: ['JP-01'] })
    const write = ctx.writes.find((w) => w.path.endsWith('config.latency.json'))
    assert.ok(write)
    const cfg = JSON.parse(write.content)
    assert.equal(cfg.outbounds.length, 1)
    assert.equal(cfg.outbounds[0].type, 'trojan')
    // 出站 tag 用 probe-N:节点原名可能重复、含空格或特殊字符
    assert.match(cfg.outbounds[0].tag, /^probe-\d+$/)
  } finally {
    await close()
  }
})

test('内核返回非 0 时如实报错,不谎报成功', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1, stdout: '', stderr: 'FATAL connection reset' } })
  const { baseUrl, close } = await startApp({ ctx })
  try {
    const [r] = (await (await post(baseUrl, { content: SUB, tags: ['HK-01'] })).json()).results
    assert.equal(r.ok, false)
    assert.match(r.error, /connection reset/)
  } finally {
    await close()
  }
})

test('订阅里不存在的 tag 返回 not found,不影响同批其它节点', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const { results } = await (await post(baseUrl, { content: SUB, tags: ['HK-01', '不存在的节点'] })).json()
    assert.equal(results[0].ok, true)
    assert.equal(results[1].ok, false)
    assert.equal(results[1].error, 'not found')
  } finally {
    await close()
  }
})

// server 来自订阅内容,是可控输入:不挡的话这个接口能被用来探测内网。
test('SSRF 防护:节点服务器解析到内网地址时拒绝测试', async () => {
  const { baseUrl, close } = await startApp({ lookup: async () => [{ address: '192.168.3.1', family: 4 }] })
  try {
    const [r] = (await (await post(baseUrl, { content: SUB, tags: ['HK-01'] })).json()).results
    assert.equal(r.ok, false)
    assert.match(r.error, /non-public/)
  } finally {
    await close()
  }
})

test('结果与传入 tags 顺序一一对应', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const { results } = await (await post(baseUrl, { content: SUB, tags: ['JP-01', '不存在', 'HK-01'] })).json()
    assert.equal(results.length, 3)
    assert.equal(results[1].error, 'not found')
  } finally {
    await close()
  }
})
