// 会话密钥必须落库:面板进程一换(升级替换文件、重启面板、路由器重启),浏览器里的
// cookie 不能失效——否则升级到"替换文件"阶段面板重启,用户当场被踢回登录页,升级弹窗
// 也跟着页面一起没了(用户报的问题)。这里用"同一个 db 文件 + 两个独立的 index.mjs 实例"
// 模拟进程重启:实例 A 签发的 cookie,实例 B 必须照样认。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openbox-session-persist-test-'))
process.env.ZASHBOARD_DB_PATH = path.join(tempDir, 'zashboard.sqlite')

const listenEphemeral = (srv) =>
  new Promise((resolve, reject) => {
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`))
  })

const bootInstance = async (tag) => {
  const mod = await import(new URL(`./../index.mjs?test=${tag}`, import.meta.url).href)
  return { ...mod, baseUrl: await listenEphemeral(mod.server) }
}

const first = await bootInstance('session-persist-a')
const second = await bootInstance('session-persist-b')

after(async () => {
  await first.shutdownServer().catch(() => {})
  await second.shutdownServer().catch(() => {})
  await fs.rm(tempDir, { recursive: true, force: true })
})

const postJson = (baseUrl, url, body) =>
  fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

test('面板进程重启后旧 cookie 仍然有效(会话密钥落库),改密后立即失效', async () => {
  // 只清密码相关的键:整表清空会把两个实例启动时读进内存的会话密钥行也删掉,
  // 后面就查不到它了(功能不受影响,但这条断言要验证的正是"它确实落了库")
  first.db.exec("DELETE FROM app_storage WHERE key LIKE 'config/access-%'")

  const setupRes = await postJson(first.baseUrl, '/api/auth/setup', { password: 'correct-horse-battery' })
  assert.equal(setupRes.status, 200)
  const cookie = (setupRes.headers.get('set-cookie') || '').match(/openbox_access_session=[^;]+/)?.[0]
  assert.ok(cookie, 'setup 应签发 session cookie')

  // 同一份数据库、另一个进程实例(= 升级替换文件后重新启动的面板)
  const reused = await fetch(`${second.baseUrl}/api/openbox/profile`, { headers: { cookie } })
  assert.equal(reused.status, 200, '进程重启后旧 cookie 必须仍然有效,不能把用户踢回登录页')

  // 密钥确实存下来了,而且在受保护前缀下(不回显给浏览器、不被设置同步清掉)
  const stored = first.db.prepare('SELECT value FROM app_storage WHERE key = ?').get('openbox/session-secret')
  assert.ok(stored && stored.value.length >= 32)
  assert.ok(first.isProtectedStorageKey('openbox/session-secret'))

  // 改密后旧 cookie 立刻失效:令牌是 HMAC(密钥, 密码),密码变了就对不上
  const changed = await fetch(`${first.baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword: 'correct-horse-battery', newPassword: 'another-good-password' }),
  })
  assert.equal(changed.status, 200)
  const afterChange = await fetch(`${second.baseUrl}/api/openbox/profile`, { headers: { cookie } })
  assert.equal(afterChange.status, 401, '改密后旧 cookie 必须失效')
})
