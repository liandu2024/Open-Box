import assert from 'node:assert/strict'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { curlFetchText } from './curl-fetch.mjs'

const hasCurl = (() => { try { execFileSync('curl', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()
const skip = hasCurl ? false : '系统没有 curl'
const lookup = async (host) => [{ address: host, family: 4 }]
const NODE = 'ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@1.1.1.1:8388#A\n'
const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/sub` }))
})
const stop = (server) => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()) })

test('curl 兜底:完整的 200 响应原样交出正文', { skip }, async () => {
  const body = NODE + NODE
  const { server, url } = await listen((req, res) => { res.writeHead(200, { 'content-length': Buffer.byteLength(body) }); res.end(body) })
  try {
    const r = await curlFetchText(url, { userAgent: 'clash-verge/v2.0.0', lookup, timeoutMs: 5000 })
    assert.equal(r.status, 200)
    assert.equal(r.text, body)
  } finally { await stop(server) }
})

test('F1:HTTP 200 后传到一半断开(curl exit 18)→ 算下载失败,不交出半份正文', { skip }, async () => {
  const body = NODE + NODE
  const { server, url } = await listen((req, res) => {
    res.writeHead(200, { 'content-length': Buffer.byteLength(body) })
    res.write(NODE)
    setTimeout(() => res.socket.destroy(), 50)
  })
  try {
    const r = await curlFetchText(url, { userAgent: 'clash-verge/v2.0.0', lookup, timeoutMs: 5000 })
    assert.equal(r.status, 0, JSON.stringify(r))
    assert.equal(r.httpStatus, 200)
    assert.match(r.error, /退出码 18/)
    assert.equal(r.text, undefined)
  } finally { await stop(server) }
})

test('F1:超时(exit 28)和超过大小上限(exit 63)同样是失败,不交出正文', { skip }, async () => {
  const slow = await listen((req, res) => { res.writeHead(200, { 'content-length': 100 }); res.write('x') /* 剩下的永远不发 */ })
  try {
    const r = await curlFetchText(slow.url, { userAgent: 'u', lookup, timeoutMs: 1000 })
    assert.equal(r.status, 0, JSON.stringify(r))
    assert.match(r.error, /退出码 28|被终止/)
    assert.equal(r.text, undefined)
  } finally { await stop(slow.server) }
  const big = 'y'.repeat(2000)
  const large = await listen((req, res) => { res.writeHead(200, { 'content-length': big.length }); res.end(big) })
  try {
    const r = await curlFetchText(large.url, { userAgent: 'u', lookup, timeoutMs: 5000, maxBytes: 500 })
    assert.equal(r.status, 0, JSON.stringify(r))
    assert.match(r.error, /退出码 63/)
    assert.equal(r.text, undefined)
  } finally { await stop(large.server) }
})

test('curl 兜底:4xx 由上层判(status 照交);重定向逐跳跟、到链路本地地址拒绝', { skip }, async () => {
  const { server, url } = await listen((req, res) => {
    if (req.url === '/sub') { res.writeHead(302, { location: '/real' }); res.end(); return }
    if (req.url === '/real') { res.writeHead(200, { 'content-length': Buffer.byteLength(NODE) }); res.end(NODE); return }
    if (req.url === '/evil') { res.writeHead(302, { location: 'http://169.254.1.1/x' }); res.end(); return }
    res.writeHead(403); res.end('no')
  })
  try {
    const ok = await curlFetchText(url, { userAgent: 'u', lookup, timeoutMs: 5000 })
    assert.equal(ok.status, 200)
    assert.equal(ok.text, NODE)
    const denied = await curlFetchText(url.replace('/sub', '/nope'), { userAgent: 'u', lookup, timeoutMs: 5000 })
    assert.equal(denied.status, 403)
    await assert.rejects(() => curlFetchText(url.replace('/sub', '/evil'), { userAgent: 'u', lookup, timeoutMs: 5000 }), /unroutable/)
  } finally { await stop(server) }
})
