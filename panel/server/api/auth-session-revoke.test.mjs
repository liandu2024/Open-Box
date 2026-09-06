import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

// 审查第 8 项:令牌以前是 HMAC(密钥, 密码),同一密码下恒定,退出登录只删浏览器 cookie、服务端
// 也不看过期。现在每次登录签发随机会话 id 落库,服务端按记录判有效期,退出即撤销。
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openbox-session-revoke-test-'))
process.env.ZASHBOARD_DB_PATH = path.join(tempDir, 'zashboard.sqlite')

const listenEphemeral = (srv) =>
  new Promise((resolve, reject) => {
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`))
  })

const mod = await import(new URL('./../index.mjs?test=session-revoke', import.meta.url).href)
const baseUrl = await listenEphemeral(mod.server)

after(async () => {
  await mod.shutdownServer().catch(() => {})
  await fs.rm(tempDir, { recursive: true, force: true })
})

const postJson = (url, body, headers = {}) =>
  fetch(`${baseUrl}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const cookieOf = (res) => (res.headers.get('set-cookie') || '').match(/openbox_access_session=[^;]+/)?.[0]
const profileStatus = async (cookie) => (await fetch(`${baseUrl}/api/openbox/profile`, { headers: { cookie } })).status

test('每次登录签发不同的随机会话;退出登录后该会话在服务端被撤销,拷走的 cookie 不再可用;别的会话不受影响', async () => {
  mod.db.exec("DELETE FROM app_storage WHERE key LIKE 'config/access-%' OR key = 'openbox/sessions'")
  const setup = await postJson('/api/auth/setup', { password: 'correct-horse-battery' })
  assert.equal(setup.status, 200)
  const a = cookieOf(setup)
  const login = await postJson('/api/auth/login', { password: 'correct-horse-battery' })
  assert.equal(login.status, 200)
  const b = cookieOf(login)
  assert.ok(a && b && a !== b, '两次登录必须是不同的随机会话')
  assert.equal(await profileStatus(a), 200)
  assert.equal(await profileStatus(b), 200)

  const logout = await postJson('/api/auth/logout', {}, { cookie: a })
  assert.equal(logout.status, 200)
  assert.notEqual(await profileStatus(a), 200, '退出后旧 cookie 必须失效')
  assert.equal(await profileStatus(b), 200, '另一个会话不受影响')

  // 会话记录在受保护的 openbox/ 前缀下,不会被 /api/storage 回显或覆盖
  assert.ok(mod.isProtectedStorageKey('openbox/sessions'))
  const stored = JSON.parse(mod.db.prepare('SELECT value FROM app_storage WHERE key = ?').get('openbox/sessions').value)
  assert.equal(Object.keys(stored).length, 1)
})

test('服务端自己看过期:把记录里的 expiresAt 改到过去,cookie 还在也不认', async () => {
  const login = await postJson('/api/auth/login', { password: 'correct-horse-battery' })
  const cookie = cookieOf(login)
  assert.equal(await profileStatus(cookie), 200)
  const id = cookie.split('=')[1]
  const row = mod.db.prepare('SELECT value FROM app_storage WHERE key = ?').get('openbox/sessions')
  const sessions = JSON.parse(row.value)
  sessions[id].expiresAt = Date.now() - 1000
  mod.db.prepare('UPDATE app_storage SET value = ? WHERE key = ?').run(JSON.stringify(sessions), 'openbox/sessions')
  assert.notEqual(await profileStatus(cookie), 200)
})
