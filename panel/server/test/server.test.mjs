import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ange-clashboard-test-'))
const dbPath = path.join(tempDir, 'zashboard.sqlite')

process.env.ZASHBOARD_DB_PATH = dbPath

const serverModuleUrl = new URL(`./../index.mjs?test=${Date.now()}`, import.meta.url)
const {
  createAccessSessionTokenForTesting,
  db,
  getRequestAccessAuthStatusForTesting,
  shutdownServer,
} = await import(serverModuleUrl.href)

after(async () => {
  await shutdownServer().catch(() => {})
  await fs.rm(tempDir, { recursive: true, force: true })
})

// 密码/enabled 属于受保护键(Critical 2 修复后),replaceSnapshot 会拒绝客户端写入它们——
// 这里直接走底层 db 写入来模拟"已持久化的设置",而不是通过现在已加固的 replaceSnapshot。
const seedStorage = (key, value) => {
  db.prepare(
    `INSERT INTO app_storage (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).run(key, value)
}

test('service auth state is enforced from persisted settings', () => {
  seedStorage('config/access-password-enabled', 'true')
  seedStorage('config/access-password', 'test-secret')

  assert.deepEqual(
    getRequestAccessAuthStatusForTesting({
      headers: {},
    }),
    {
      enabled: true,
      authenticated: false,
    },
  )

  assert.deepEqual(
    getRequestAccessAuthStatusForTesting({
      headers: {
        cookie: `openbox_access_session=${createAccessSessionTokenForTesting('test-secret')}`,
      },
    }),
    {
      enabled: true,
      authenticated: true,
    },
  )
})
