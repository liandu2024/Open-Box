import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

// P4a round2 复审 Important 3 回归:/api 专用错误中间件此前硬编码 500,把 body-parser
// 自己抛出的 400(畸形 JSON,entity.parse.failed)、413(超大 body,entity.too.large)都
// 降级成了 500——这两种错误对象本身带 err.status,必须原样透传而不是覆盖。同时验证响应
// 是 JSON、不含调用栈(面板对路由器有 root 权限,堆栈不能泄露给客户端)。
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openbox-error-middleware-test-'))
const dbPath = path.join(tempDir, 'zashboard.sqlite')

process.env.ZASHBOARD_DB_PATH = dbPath

const serverModuleUrl = new URL('./../index.mjs?test=error-middleware', import.meta.url)
const { server, shutdownServer } = await import(serverModuleUrl.href)

const listenEphemeral = (srv) =>
  new Promise((resolve, reject) => {
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      resolve(`http://127.0.0.1:${port}`)
    })
  })

const baseUrl = await listenEphemeral(server)

after(async () => {
  await shutdownServer().catch(() => {})
  await fs.rm(tempDir, { recursive: true, force: true })
})

let authCookie = ''

test('setup: 设密并拿到 cookie(后续用例需要通过守卫才能打到 body-parser)', async () => {
  const res = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'error-mw-test-password' }),
  })
  assert.equal(res.status, 200)
  const setCookie = res.headers.get('set-cookie') || ''
  const match = setCookie.match(/openbox_access_session=[^;]+/)
  assert.ok(match, 'setup 应签发 session cookie')
  authCookie = match[0]
})

const assertNoStackTrace = (text) => {
  // 调用栈典型形如 "at foo (file:///...:12:34)" 或 Express 默认错误页里的
  // "<pre>Error: ...\n    at ..." ——只要出现这种形态就说明堆栈泄露了。
  assert.ok(!/at\s.*:\d+:\d+/.test(text), `响应不应包含调用栈,实际: ${text.slice(0, 200)}`)
}

test('PUT /api/storage 畸形 JSON → 400 JSON(而不是被降级成 500),不含堆栈', async () => {
  const res = await fetch(`${baseUrl}/api/storage`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: authCookie },
    body: '{not valid json',
  })
  assert.equal(res.status, 400)
  assert.match(res.headers.get('content-type') || '', /application\/json/)

  const text = await res.text()
  assertNoStackTrace(text)

  const body = JSON.parse(text)
  assert.ok(body.error)
})

test('PUT /api/storage 超出 body 上限(25mb)→ 413 JSON(而不是被降级成 500),不含堆栈', async () => {
  const oversized = 'a'.repeat(26 * 1024 * 1024)
  const res = await fetch(`${baseUrl}/api/storage`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: authCookie },
    body: JSON.stringify({ entries: { big: oversized } }),
  })
  assert.equal(res.status, 413)
  assert.match(res.headers.get('content-type') || '', /application\/json/)

  const text = await res.text()
  assertNoStackTrace(text)

  const body = JSON.parse(text)
  assert.ok(body.error)
})

test('POST /api/auth/setup(2kb 限额)超限 body → 413 JSON,不含堆栈(验证限额按路由前缀各自生效)', async () => {
  const oversized = 'a'.repeat(4 * 1024)
  const res = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: oversized }),
  })
  assert.equal(res.status, 413)
  assert.match(res.headers.get('content-type') || '', /application\/json/)

  const text = await res.text()
  assertNoStackTrace(text)

  const body = JSON.parse(text)
  assert.ok(body.error)
})
