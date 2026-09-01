import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import express from 'express'
import { registerNodeLatencyRoutes, tcpPing } from './node-latency.mjs'

// 字面 IP 原样透传;域名一律解析成公网地址,除非用例另行注入。
const fakeLookup = async (hostname) => {
  const trimmed = String(hostname).replace(/^\[|\]$/g, '').trim()
  const version = net.isIP(trimmed)
  if (version) return [{ address: trimmed, family: version }]
  return [{ address: '127.0.0.1', family: 4 }] // 域名默认指回环,专供 SSRF 用例
}

const startApp = async (lookup = fakeLookup) => {
  const app = express()
  registerNodeLatencyRoutes(app, { lookup })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  }
}

const post = (baseUrl, body) =>
  fetch(`${baseUrl}/api/openbox/nodes/latency`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

// 起一个真实的 TCP 监听,作为"可达的公网节点"的替身
const startEcho = async () => {
  const srv = net.createServer((s) => s.end())
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  return { port: srv.address().port, close: () => new Promise((r) => srv.close(r)) }
}

// 成功路径单独测 tcpPing:守卫会拒绝回环地址,没法在整条路由上既通过校验又真的连上。
test('tcpPing:能连通的目标返回 ok 与毫秒数', async () => {
  const echo = await startEcho()
  try {
    const r = await tcpPing('127.0.0.1', echo.port, 3000)
    assert.equal(r.ok, true)
    assert.equal(typeof r.ms, 'number')
    assert.ok(r.ms >= 0 && r.ms < 3000)
  } finally {
    await echo.close()
  }
})

test('tcpPing:端口没人监听时返回错误而不是抛异常', async () => {
  const echo = await startEcho()
  const deadPort = echo.port
  await echo.close()
  const r = await tcpPing('127.0.0.1', deadPort, 3000)
  assert.equal(r.ok, false)
  assert.ok(r.error)
})

// 超时路径没有确定性的测法:本机实测 192.0.2.1(RFC 5737 保留测试网段)会在 1ms 内
// "连上"——网络里有东西在劫持保留网段。依赖真实网络的超时用例只会变成随机失败,
// 故不写;失败路径由上面"端口没人监听"那条覆盖。

test('目标不是数组 → 400', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await post(baseUrl, {})
    assert.equal(res.status, 400)
  } finally {
    await close()
  }
})

test('目标过多 → 400,不发起任何连接', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const targets = Array.from({ length: 201 }, () => ({ server: 'a.com', port: 443 }))
    const res = await post(baseUrl, { targets })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /too many targets/)
  } finally {
    await close()
  }
})

// SSRF:server 来自订阅内容,是攻击者可控输入。不拦的话这个接口就是内网端口扫描器。
test('SSRF 防护:字面回环地址被拒,不会真的去连', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await post(baseUrl, { targets: [{ server: '127.0.0.1', port: 22 }] })
    assert.equal(res.status, 200)
    const [r] = (await res.json()).results
    assert.equal(r.ok, false)
    assert.match(r.error, /non-public/)
  } finally {
    await close()
  }
})

test('SSRF 防护:解析到内网地址的域名同样被拒', async () => {
  const { baseUrl, close } = await startApp(async () => [{ address: '192.168.3.1', family: 4 }])
  try {
    const res = await post(baseUrl, { targets: [{ server: 'evil.example.com', port: 80 }] })
    const [r] = (await res.json()).results
    assert.equal(r.ok, false)
    assert.match(r.error, /non-public/)
  } finally {
    await close()
  }
})

test('SSRF 防护:解析失败按拒绝处理(解析不出来不等于安全)', async () => {
  const { baseUrl, close } = await startApp(async () => { throw new Error('ENOTFOUND') })
  try {
    const res = await post(baseUrl, { targets: [{ server: 'nope.example.com', port: 443 }] })
    const [r] = (await res.json()).results
    assert.equal(r.ok, false)
  } finally {
    await close()
  }
})

test('非法端口/空主机各自返回错误,不影响同批其它目标', async () => {
  const { baseUrl, close } = await startApp(async () => [{ address: '192.168.3.1', family: 4 }])
  try {
    const res = await post(baseUrl, {
      targets: [{ server: '', port: 443 }, { server: 'a.com', port: 0 }, { server: 'a.com', port: 443 }],
    })
    const { results } = await res.json()
    assert.equal(results.length, 3)
    assert.equal(results[0].error, 'invalid target')
    assert.equal(results[1].error, 'invalid target')
    assert.equal(results[2].ok, false)
  } finally {
    await close()
  }
})

test('结果与输入顺序一一对应(并发池不得打乱下标)', async () => {
  const { baseUrl, close } = await startApp(async () => [{ address: '192.168.3.1', family: 4 }])
  try {
    const targets = Array.from({ length: 20 }, (_, i) => ({ server: `h${i}.example.com`, port: 443 }))
    targets[7] = { server: '', port: 1 }
    const { results } = await (await post(baseUrl, { targets })).json()
    assert.equal(results.length, 20)
    assert.equal(results[7].error, 'invalid target')
  } finally {
    await close()
  }
})
