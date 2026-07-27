import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after, beforeEach } from 'node:test'

// P4a round2 复审 Important 2(连带损伤回归):C2 修复把 config/access-password 变成
// PUT /api/storage 的受保护键之后,面板密码曾经变得永久不可改——服务端只有
// setup(已设密则 409)/login/logout,完全没有改密端点,而前端设置页仍绑定这个 key、
// 写入后照常提示"已保存"。这里验证新增的 POST /api/auth/change-password 端点本身可用,
// 且改密后已经登录的当前会话不会因为"密码变了、旧 token 失效"而被顺带踢下线。
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openbox-auth-change-password-test-'))
const dbPath = path.join(tempDir, 'zashboard.sqlite')

process.env.ZASHBOARD_DB_PATH = dbPath

const serverModuleUrl = new URL('./../index.mjs?test=auth-change-password', import.meta.url)
const { db, server, shutdownServer } = await import(serverModuleUrl.href)

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
  db.exec('DELETE FROM app_storage')
})

const postJson = (routePath, body) =>
  fetch(`${baseUrl}${routePath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const extractCookie = (res) => {
  const setCookie = res.headers.get('set-cookie') || ''
  const match = setCookie.match(/openbox_access_session=[^;]+/)
  return match ? match[0] : ''
}

test('未设密时:POST /api/auth/change-password → 409(不是通用守卫的 403)', async () => {
  const res = await postJson('/api/auth/change-password', {
    currentPassword: 'whatever',
    newPassword: 'new-secret-1',
  })
  assert.equal(res.status, 409)
  const body = await res.json()
  assert.ok(body.error)
})

test('currentPassword 不匹配 → 401,密码未被更改', async () => {
  await postJson('/api/auth/setup', { password: 'original-password-1' })

  const res = await postJson('/api/auth/change-password', {
    currentPassword: 'totally-wrong-password',
    newPassword: 'new-secret-1',
  })
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.ok(body.message || body.code)

  const loginRes = await postJson('/api/auth/login', { password: 'original-password-1' })
  assert.equal(loginRes.status, 200) // 原密码仍然有效
})

test('newPassword 长度 < 8 → 400,密码未被更改', async () => {
  await postJson('/api/auth/setup', { password: 'original-password-1' })

  const res = await postJson('/api/auth/change-password', {
    currentPassword: 'original-password-1',
    newPassword: 'short',
  })
  assert.equal(res.status, 400)

  const loginRes = await postJson('/api/auth/login', { password: 'original-password-1' })
  assert.equal(loginRes.status, 200)
})

test('改密成功:旧密码登录失败、新密码登录成功、当前会话续上(重新签发 cookie)', async () => {
  const setupRes = await postJson('/api/auth/setup', { password: 'original-password-1' })
  const oldCookie = extractCookie(setupRes)
  assert.ok(oldCookie, 'setup 应签发 cookie')

  const changeRes = await postJson('/api/auth/change-password', {
    currentPassword: 'original-password-1',
    newPassword: 'brand-new-password-2',
  })
  assert.equal(changeRes.status, 200)
  const changeBody = await changeRes.json()
  assert.equal(changeBody.ok, true)

  const newCookie = extractCookie(changeRes)
  assert.ok(newCookie, '改密应重新签发 cookie')
  assert.notEqual(newCookie, oldCookie)

  // 旧密码登录失败
  const oldLoginRes = await postJson('/api/auth/login', { password: 'original-password-1' })
  assert.equal(oldLoginRes.status, 401)

  // 新密码登录成功
  const newLoginRes = await postJson('/api/auth/login', { password: 'brand-new-password-2' })
  assert.equal(newLoginRes.status, 200)

  // 旧 cookie(基于旧密码派生的 token)现在应当失效
  const oldCookieCheck = await fetch(`${baseUrl}/api/storage`, { headers: { cookie: oldCookie } })
  assert.equal(oldCookieCheck.status, 401)

  // 改密响应里带的新 cookie 可以直接访问受保护路由——当前会话续上了,不需要重新登录
  const newCookieCheck = await fetch(`${baseUrl}/api/storage`, { headers: { cookie: newCookie } })
  assert.equal(newCookieCheck.status, 200)
})
