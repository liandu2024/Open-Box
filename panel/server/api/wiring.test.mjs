import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

// 独立临时 DB + 真实监听端口,验证 Task 10 把五个 Open-Box 路由模块真正装配进了
// panel/server/index.mjs:既要在守卫之下(未设密时 403),也要在设密之后真正打到
// 各 handler(非 404、契约字段吻合)——只测前者不足以证明路由确实注册了,因为守卫
// 对整个 /api/* 前缀无差别拦截,不论下游是否存在匹配的路由。
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openbox-wiring-test-'))
const dbPath = path.join(tempDir, 'zashboard.sqlite')

process.env.ZASHBOARD_DB_PATH = dbPath

const serverModuleUrl = new URL('./../index.mjs?test=wiring', import.meta.url)
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

const OPENBOX_ROUTES = [
  { method: 'GET', path: '/api/openbox/subscriptions' },
  { method: 'GET', path: '/api/openbox/profile' },
  { method: 'GET', path: '/api/openbox/config/preview' },
  { method: 'GET', path: '/api/openbox/service/status' },
  { method: 'GET', path: '/api/openbox/kernel/version' },
  { method: 'POST', path: '/api/openbox/penetration' },
]

test('未设密时:每条 Open-Box 路由都是 403 PASSWORD_SETUP_REQUIRED', async () => {
  for (const route of OPENBOX_ROUTES) {
    const res = await fetch(`${baseUrl}${route.path}`, { method: route.method })
    assert.equal(res.status, 403, `${route.method} ${route.path} 应为 403`)
    const body = await res.json()
    assert.equal(body.error, 'PASSWORD_SETUP_REQUIRED')
  }
})

test('/api/health 不受守卫影响,始终 200', async () => {
  const res = await fetch(`${baseUrl}/api/health`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
})

let authCookie = ''

test('设密后携带 cookie:各 Open-Box 路由真正打到 handler(非 404,契约字段吻合)', async () => {
  const setupRes = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'wiring-smoke-test-pw' }),
  })
  assert.equal(setupRes.status, 200)
  const setCookie = setupRes.headers.get('set-cookie') || ''
  const match = setCookie.match(/openbox_access_session=[^;]+/)
  assert.ok(match, 'setup 应签发 session cookie')
  authCookie = match[0]

  const headers = { cookie: authCookie }

  const subsRes = await fetch(`${baseUrl}/api/openbox/subscriptions`, { headers })
  assert.equal(subsRes.status, 200)
  const subsBody = await subsRes.json()
  assert.ok(Array.isArray(subsBody.subscriptions))

  const profileRes = await fetch(`${baseUrl}/api/openbox/profile`, { headers })
  assert.equal(profileRes.status, 200)
  const profileBody = await profileRes.json()
  assert.ok(profileBody.profile)
  assert.equal(profileBody.profile.region, 'CN')

  const previewRes = await fetch(`${baseUrl}/api/openbox/config/preview`, { headers })
  assert.equal(previewRes.status, 200)
  const previewBody = await previewRes.json()
  assert.ok(previewBody.config)
  assert.ok(Array.isArray(previewBody.config.outbounds))

  const statusRes = await fetch(`${baseUrl}/api/openbox/service/status`, { headers })
  assert.equal(statusRes.status, 200)
  const statusBody = await statusRes.json()
  assert.ok('core' in statusBody)
  assert.ok('panel' in statusBody)
  assert.ok(Array.isArray(statusBody.conflicts))

  const versionRes = await fetch(`${baseUrl}/api/openbox/kernel/version`, { headers })
  assert.equal(versionRes.status, 200)
  const versionBody = await versionRes.json()
  assert.ok('version' in versionBody)

  // penetration 缺 target 应 400(而非 404)——证明路由确实被打到,而不是掉进 SPA fallback。
  const penRes = await fetch(`${baseUrl}/api/openbox/penetration`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(penRes.status, 400)
  const penBody = await penRes.json()
  assert.ok(penBody.message)
})

test('SPA fallback 对非 /api 路径仍生效', async () => {
  const res = await fetch(`${baseUrl}/some/spa/route`)
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.ok(text.includes('<'))
})
