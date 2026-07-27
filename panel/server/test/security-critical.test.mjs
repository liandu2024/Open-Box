import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

// P4a 终审 Critical 1 + Critical 2 的回归测试:两者都由评审在本分支上实测复现过,
// 必须用真实监听端口 + 真实 HTTP 往返来验证,不能只测内部函数(否则测不出路由挂载层面
// 的绕过/污染)。

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openbox-security-critical-test-'))
const dbPath = path.join(tempDir, 'zashboard.sqlite')

process.env.ZASHBOARD_DB_PATH = dbPath

const serverModuleUrl = new URL('./../index.mjs?test=security-critical', import.meta.url)
const { isProtectedStorageKey, server, shutdownServer, storeForTesting } = await import(serverModuleUrl.href)

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

const TEST_PASSWORD = 'critical-regression-password'
let authCookie = ''
let setupDone = false

// 所有用例共用同一个已设密的 server 实例(设密只能成功一次),用一个幂等的 setup 帮手
// 保证不论用例执行顺序如何,后面的用例都能拿到有效的 authCookie。
const ensurePasswordConfigured = async () => {
  if (setupDone) return
  const res = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  })
  assert.equal(res.status, 200)
  const setCookie = res.headers.get('set-cookie') || ''
  const match = setCookie.match(/openbox_access_session=[^;]+/)
  assert.ok(match, 'setup 应签发 session cookie')
  authCookie = match[0]
  setupDone = true
}

// ==================== Critical 1:/API 大小写绕过认证守卫 ====================
// 评审实测:已设密状态下,GET /API/openbox/profile(大写)不进守卫、却仍匹配路由,
// 未认证客户端可读到 /API/storage 里的明文密码、可跑 POST /api/openbox/deploy 真实部署。
// 修复后这四种变体在"已设密 + 未带 cookie"时都必须被守卫拦在 401,而不是命中真实 handler。

test('Critical 1 回归:已设密未带 cookie 时 GET /API/openbox/profile(全大写)必须是 401,不能是 200', async () => {
  await ensurePasswordConfigured()
  const res = await fetch(`${baseUrl}/API/openbox/profile`)
  assert.notEqual(res.status, 200)
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.equal(body.code, 'ACCESS_PASSWORD_REQUIRED')
})

test('Critical 1 回归:已设密未带 cookie 时 GET /Api/OpenBox/Profile(混合大小写)必须是 401,不能是 200', async () => {
  await ensurePasswordConfigured()
  const res = await fetch(`${baseUrl}/Api/OpenBox/Profile`)
  assert.notEqual(res.status, 200)
  assert.equal(res.status, 401)
})

test('Critical 1 回归:已设密未带 cookie 时 GET /API/storage(大写)必须是 401,不能是 200(此前会泄露明文密码)', async () => {
  await ensurePasswordConfigured()
  const res = await fetch(`${baseUrl}/API/storage`)
  assert.notEqual(res.status, 200)
  assert.equal(res.status, 401)
})

test('Critical 1 回归:已设密未带 cookie 时 GET //api/openbox/profile(双斜杠)必须是 401,不能是 200', async () => {
  await ensurePasswordConfigured()
  const res = await fetch(`${baseUrl}//api/openbox/profile`)
  assert.notEqual(res.status, 200)
  assert.equal(res.status, 401)
})

test('Critical 1 回归:已设密未带 cookie 时 POST /API/openbox/deploy(大写)不得真正触发部署', async () => {
  await ensurePasswordConfigured()
  const before = storeForTesting.getDeployState()

  const res = await fetch(`${baseUrl}/API/openbox/deploy`, { method: 'POST' })
  assert.notEqual(res.status, 200)
  assert.equal(res.status, 401)

  // 部署态必须原封不动——真正的 handler 没被打到。
  assert.deepEqual(storeForTesting.getDeployState(), before)
})

test('健全性检查:小写 + 正确 cookie 的 GET /api/openbox/profile 仍然是 200(未过度拦截)', async () => {
  await ensurePasswordConfigured()
  const res = await fetch(`${baseUrl}/api/openbox/profile`, { headers: { cookie: authCookie } })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(body.profile)
})

// ==================== Critical 2:PUT /api/storage 抹掉 Open-Box 状态与密码 ====================

test('isProtectedStorageKey:openbox/*、config/access-*、背景图 sentinel 判定为受保护', () => {
  assert.equal(isProtectedStorageKey('openbox/profile'), true)
  assert.equal(isProtectedStorageKey('openbox/clash-secret'), true)
  assert.equal(isProtectedStorageKey('config/access-password'), true)
  assert.equal(isProtectedStorageKey('config/access-password-enabled'), true)
  assert.equal(isProtectedStorageKey('__background_image__'), true)
  assert.equal(isProtectedStorageKey('theme'), false)
  assert.equal(isProtectedStorageKey('language'), false)
})

test('Critical 2 回归:PUT /api/storage 传入不含 openbox/* 的快照,已存 profile/订阅/clash-secret 仍在且值不变', async () => {
  await ensurePasswordConfigured()

  storeForTesting.setProfile({ region: 'JP' })
  storeForTesting.setSubscriptions([{ id: 'sub-1', name: 'Regression Sub' }])
  const secretBefore = storeForTesting.getClashSecret()

  const res = await fetch(`${baseUrl}/api/storage`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: authCookie },
    body: JSON.stringify({ entries: { theme: 'dark', language: 'zh-CN' } }),
  })
  assert.equal(res.status, 200)

  assert.equal(storeForTesting.getProfile().region, 'JP')
  assert.deepEqual(storeForTesting.getSubscriptions(), [{ id: 'sub-1', name: 'Regression Sub' }])
  assert.equal(storeForTesting.getClashSecret(), secretBefore)
})

test('Critical 2 回归:GET /api/storage 的返回不含任何 config/access-password* 与 openbox/* 键', async () => {
  await ensurePasswordConfigured()
  storeForTesting.setProfile({ region: 'US' }) // 确保 openbox/profile 键确实存在于表里

  const res = await fetch(`${baseUrl}/api/storage`, { headers: { cookie: authCookie } })
  assert.equal(res.status, 200)
  const body = await res.json()
  const keys = Object.keys(body.entries)

  assert.ok(!keys.some((k) => k.startsWith('openbox/')), `不应含 openbox/* 键,实际: ${keys.join(',')}`)
  assert.ok(!keys.some((k) => k.startsWith('config/access-')), `不应含 config/access-* 键,实际: ${keys.join(',')}`)
})

test('Critical 2 回归:PUT /api/storage 试图写 config/access-password → 密码实际值不变(不能借此改密/接管)', async () => {
  await ensurePasswordConfigured()

  const res = await fetch(`${baseUrl}/api/storage`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: authCookie },
    body: JSON.stringify({ entries: { 'config/access-password': 'attacker-controlled-password' } }),
  })
  assert.equal(res.status, 200)

  // 用原密码仍能登录 → 证明密码没有被客户端写入的值覆盖。
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  })
  assert.equal(loginRes.status, 200)
})

test('Critical 2 回归:PUT /api/storage 试图写 openbox/profile → 被服务端忽略,真实 profile 不受影响', async () => {
  await ensurePasswordConfigured()
  storeForTesting.setProfile({ region: 'US' })

  const res = await fetch(`${baseUrl}/api/storage`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: authCookie },
    body: JSON.stringify({ entries: { 'openbox/profile': JSON.stringify({ region: 'EVIL' }) } }),
  })
  assert.equal(res.status, 200)
  assert.equal(storeForTesting.getProfile().region, 'US')
})
