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
  getRequestAccessAuthStatusForTesting,
  replaceSnapshot,
  shutdownServer,
} = await import(serverModuleUrl.href)

after(async () => {
  await shutdownServer().catch(() => {})
  await fs.rm(tempDir, { recursive: true, force: true })
})

test('service auth state is enforced from persisted settings', () => {
  replaceSnapshot({
    'config/access-password-enabled': 'true',
    'config/access-password': 'test-secret',
  })

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
