import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadStorageDefaults, seedDefaultStorage } from './seed-defaults.mjs'

const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-defaults-'))
  fs.writeFileSync(path.join(dir, 'storage-defaults.json'), JSON.stringify({
    'config/theme-mode': 'light', 'config/access-password': 'nope', 'openbox/profile': '{}', 'config/x': 1,
  }))
  fs.writeFileSync(path.join(dir, 'background-image.txt'), 'data:image/jpeg;base64,AAAA\n')
  return dir
}

test('loadStorageDefaults:只收 config/*(排除 access-*)的字符串值;背景必须是 data:image', () => {
  const { entries, background } = loadStorageDefaults(tmpDir())
  assert.deepEqual(entries, { 'config/theme-mode': 'light' })
  assert.equal(background, 'data:image/jpeg;base64,AAAA')
  assert.deepEqual(loadStorageDefaults('/nonexistent'), { entries: {}, background: '' })
})

test('seedDefaultStorage:全新安装写入默认值和背景;已有 config/* 时不动', () => {
  const dir = tmpDir()
  const rows = {}
  const r = seedDefaultStorage({ countConfigEntries: () => 0, insert: (k, v) => { rows[k] = v }, dir })
  assert.equal(r.seeded, 2)
  assert.equal(rows['config/theme-mode'], 'light')
  assert.equal(rows.__background_image__, 'data:image/jpeg;base64,AAAA')
  const rows2 = {}
  assert.deepEqual(seedDefaultStorage({ countConfigEntries: () => 5, insert: (k, v) => { rows2[k] = v }, dir }), { seeded: 0 })
  assert.deepEqual(rows2, {})
})

test('随包的默认值文件本身合法:有主题等关键项,背景是 data:image', () => {
  const { entries, background } = loadStorageDefaults()
  assert.equal(entries['config/theme-mode'], 'light')
  assert.ok(entries['config/global-radius'])
  assert.ok(!Object.keys(entries).some((k) => k.startsWith('config/access-')))
  assert.ok(background.startsWith('data:image/'))
})
