import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after, beforeEach } from 'node:test'
import { WebSocket } from 'ws'

// 独立临时 DB + 独立 express app 实例(真实监听端口,走真实 HTTP/WS),
// 每个 test 前用 replaceSnapshot({}) 清空 KV,保证"未设密"场景不被前序用例污染。
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openbox-auth-setup-test-'))
const dbPath = path.join(tempDir, 'zashboard.sqlite')

process.env.ZASHBOARD_DB_PATH = dbPath

const serverModuleUrl = new URL('./../index.mjs?test=auth-setup', import.meta.url)
const { server, replaceSnapshot, shutdownServer } = await import(serverModuleUrl.href)

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

beforeEach(() => {
  replaceSnapshot({})
})

const postSetup = (password) =>
  fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })

const extractCookie = (res) => {
  const setCookie = res.headers.get('set-cookie') || ''
  const match = setCookie.match(/openbox_access_session=[^;]+/)
  return match ? match[0] : ''
}

test('未设密时:GET /api/openbox/profile(受守卫的普通路由)得 403 PASSWORD_SETUP_REQUIRED', async () => {
  const res = await fetch(`${baseUrl}/api/openbox/profile`)
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.equal(body.error, 'PASSWORD_SETUP_REQUIRED')
})

test('未设密时:/api/health、/api/auth/status、/api/auth/setup 不受守卫拦截', async () => {
  const healthRes = await fetch(`${baseUrl}/api/health`)
  assert.equal(healthRes.status, 200)

  const statusRes = await fetch(`${baseUrl}/api/auth/status`)
  assert.equal(statusRes.status, 200)

  // setup 用短密码触发的是路由自身的 400,而不是守卫的 403 —— 证明守卫放行了这条路径。
  const setupRes = await postSetup('short')
  assert.equal(setupRes.status, 400)
})

test('未设密时:/api/auth/login、/api/auth/logout 也在守卫之下,得 403 PASSWORD_SETUP_REQUIRED', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'anything' }),
  })
  assert.equal(loginRes.status, 403)
  const loginBody = await loginRes.json()
  assert.equal(loginBody.error, 'PASSWORD_SETUP_REQUIRED')

  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' })
  assert.equal(logoutRes.status, 403)
})

test('GET /api/auth/status 的 passwordSet 字段随设密前后切换', async () => {
  const before = await (await fetch(`${baseUrl}/api/auth/status`)).json()
  assert.equal(before.passwordSet, false)

  const setupRes = await postSetup('correct-horse-battery')
  assert.equal(setupRes.status, 200)

  const after1 = await (await fetch(`${baseUrl}/api/auth/status`)).json()
  assert.equal(after1.passwordSet, true)
})

test('POST /api/auth/setup 密码 < 8 位 → 400,且未落库(passwordSet 仍为 false)', async () => {
  const res = await postSetup('short')
  assert.equal(res.status, 400)

  const statusBody = await (await fetch(`${baseUrl}/api/auth/status`)).json()
  assert.equal(statusBody.passwordSet, false)
})

test('POST /api/auth/setup 成功:设密 + 启用认证 + 签发 cookie,同一 cookie 可访问受保护路由', async () => {
  const setupRes = await postSetup('first-secret-pw')
  assert.equal(setupRes.status, 200)
  const setupBody = await setupRes.json()
  assert.equal(setupBody.enabled, true)
  assert.equal(setupBody.authenticated, true)

  const cookie = extractCookie(setupRes)
  assert.ok(cookie, 'setup 应该签发 openbox_access_session cookie')

  // 没带 cookie 访问受保护路由 → 401(已设密 + 已启用鉴权,但未认证)
  const withoutCookie = await fetch(`${baseUrl}/api/storage`)
  assert.equal(withoutCookie.status, 401)

  // 带同一 cookie → 通过守卫,拿到 200
  const withCookie = await fetch(`${baseUrl}/api/storage`, { headers: { cookie } })
  assert.equal(withCookie.status, 200)
})

test('POST /api/auth/setup 已设密时重复调用 → 409', async () => {
  const first = await postSetup('already-set-password')
  assert.equal(first.status, 200)

  const second = await postSetup('another-password-value')
  assert.equal(second.status, 409)
})

test('未设密时:/api/controller-ws 升级请求被拒绝(403,不是正常 101 升级)', async () => {
  const wsUrl = baseUrl.replace('http://', 'ws://') + '/api/controller-ws/foo'
  const client = new WebSocket(wsUrl)

  const outcome = await new Promise((resolve) => {
    client.once('open', () => resolve('open'))
    client.once('unexpected-response', (_req, res) => resolve(res.statusCode))
    client.once('error', () => resolve('error'))
  })

  assert.equal(outcome, 403)
})
