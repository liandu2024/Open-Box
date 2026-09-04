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
  assert.deepEqual(seedDefaultStorage({ countConfigEntries: () => 5, insert: (k, v) => { rows2[k] = v }, dir }), { seeded: 0, profile: false })
  assert.deepEqual(rows2, {})
})

test('随包的默认值文件本身合法:有主题等关键项,背景是 data:image', () => {
  const { entries, background } = loadStorageDefaults()
  assert.equal(entries['config/theme-mode'], 'light')
  assert.ok(entries['config/global-radius'])
  assert.ok(!Object.keys(entries).some((k) => k.startsWith('config/access-')))
  assert.ok(background.startsWith('data:image/'))
})

test('全新安装同时写入默认档案(目标分流);已有 openbox/profile 或已有 config/* 时不动', async () => {
  const { loadProfileDefaults, PROFILE_KEY } = await import('./seed-defaults.mjs')
  const defaults = loadProfileDefaults()
  assert.ok(defaults && defaults.routing && defaults.routing.policies.length >= 5, '随包的 profile-defaults.json 要有一套站点集')
  const names = defaults.routing.policies.map((p) => p.name)
  for (const n of ['AI', 'Youtube', 'Google', 'Microsoft', 'Apple', 'Games', '国内']) assert.ok(names.includes(n), n)
  assert.equal(defaults.routing.fallbackName, '其他')
  // 不带任何个人域名
  // 默认档案取自作者自己的路由器,发出去之前必须把个人域名摘干净
  const PERSONAL = /angeworld|opendoor|superdoor|wanhouse|wan\.family|ok1248/
  for (const p of defaults.routing.policies)
    for (const d of [...(p.domain || []), ...(p.domainSuffix || []), ...(p.domainKeyword || [])])
      assert.ok(!PERSONAL.test(d), d)
  // 全新:写入
  const fresh = new Map()
  const r1 = seedDefaultStorage({ countConfigEntries: () => 0, insert: (k, v) => fresh.set(k, v), hasKey: (k) => fresh.has(k) })
  assert.equal(r1.profile, true)
  assert.deepEqual(JSON.parse(fresh.get(PROFILE_KEY)).routing.policies.map((p) => p.name), names)
  // 已有档案:不覆盖
  const withProfile = new Map([[PROFILE_KEY, '{"routing":{"policies":[]}}']])
  const r2 = seedDefaultStorage({ countConfigEntries: () => 0, insert: (k, v) => withProfile.set(k, v), hasKey: (k) => withProfile.has(k) })
  assert.equal(r2.profile, false)
  assert.equal(withProfile.get(PROFILE_KEY), '{"routing":{"policies":[]}}')
  // 老安装(有 config/*):什么都不写
  const old = new Map()
  const r3 = seedDefaultStorage({ countConfigEntries: () => 5, insert: (k, v) => old.set(k, v), hasKey: (k) => old.has(k) })
  assert.equal(r3.profile, false)
  assert.equal(old.size, 0)
})
