import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

// 独立临时 DB + 真实监听端口,验证 Task 10 把五个 Open-Box 路由模块真正装配进了
// panel/server/index.mjs:既要在守卫之下(未设密时 403),也要在设密之后真正打到
// 各 handler(非 404、契约字段吻合)——只测前者不足以证明路由确实注册了,因为守卫
// 对整个 /api/* 前缀无差别拦截,不论下游是否存在匹配的路由。
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openbox-wiring-test-'))
const dbPath = path.join(tempDir, 'zashboard.sqlite')

process.env.ZASHBOARD_DB_PATH = dbPath

// index.mjs 在模块加载时就用 fs.existsSync(distDir) 决定要不要挂静态资源与 SPA
// fallback,所以「有没有前端构建产物」必须在 import 之前就确定下来。此前这里什么也
// 不做,于是本文件的 SPA fallback 用例实际取决于「这台机器上之前有没有人跑过构建」:
// 本地留着旧的 panel/dist 就过,CI 里测试跑在构建之前就 404。测试自己把前置条件准备
// 好,结果才是确定的。dist/ 已在 .gitignore 里,真正的构建会覆盖这个占位文件。
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist')
const distIndex = path.join(distDir, 'index.html')
let createdDistPlaceholder = false
if (!existsSync(distIndex)) {
  mkdirSync(distDir, { recursive: true })
  writeFileSync(distIndex, '<!doctype html><title>openbox test placeholder</title>')
  createdDistPlaceholder = true
}

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
  // 只清理本测试自己造的占位 dist,不碰真实构建产物。
  if (createdDistPlaceholder) {
    rmSync(distDir, { recursive: true, force: true })
  }
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

// -------- P4a round2 复审 Minor 4:子路由未设 caseSensitive --------
// app 本身开了 case-sensitive routing(Critical 1 修复的一部分),但 express.Router() 默认
// 大小写不敏感——mount 前缀本身按 app 的设置精确匹配(全大写会在守卫层面被拦住,这是
// Critical 1 已经验证过的),可一旦匹配上 mount 前缀、进入子路由内部,子路由自己的路由
// 匹配此前仍是大小写不敏感的,导致 /api/openbox/deploy/STATE 这类变体在"已认证"状态下
// 仍会命中真实 handler(只是没有构成认证绕过,因为守卫已经放行了这次请求)。
test('已认证下:GET /api/openbox/deploy/STATE(大写路径段)应为 404,而不是命中 /deploy/state handler', async () => {
  const res = await fetch(`${baseUrl}/api/openbox/deploy/STATE`, { headers: { cookie: authCookie } })
  assert.equal(res.status, 404)
})

test('已认证下:GET /api/openbox/service/STATUS(大写路径段)应为 404,而不是命中 /service/status handler', async () => {
  const res = await fetch(`${baseUrl}/api/openbox/service/STATUS`, { headers: { cookie: authCookie } })
  assert.equal(res.status, 404)
})

test('已认证下:POST /api/openbox/subscriptions/PREVIEW(大写路径段)应为 404,而不是命中 /preview handler', async () => {
  // 注意用 POST(该路由实际注册的方法):若误用 GET,不管 caseSensitive 与否都会因为
  // "方法不存在"而 404,测不出案例真正要验证的东西。
  const res = await fetch(`${baseUrl}/api/openbox/subscriptions/PREVIEW`, {
    method: 'POST',
    headers: { cookie: authCookie, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(res.status, 404)
})
