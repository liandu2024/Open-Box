import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { COUNTRY_CATALOG, FALLBACK_REGION_DICT } from './countries.mjs'
import { matchRegion } from './rename.mjs'

// 服务端的国家目录和前端 src/constant/countries.ts 是同一份数据:这里把前端那份按正则读出来
// 逐条比对,两边谁改了另一边没跟上,这条就红
test('服务端国家目录和前端 src/constant/countries.ts 逐条一致(代码、中文名、关键词)', () => {
  const ts = readFileSync(fileURLToPath(new URL('../../src/constant/countries.ts', import.meta.url)), 'utf8')
  const rows = [...ts.matchAll(/\{ code: '([A-Z]{2})', zh: '([^']+)', tw: '[^']+', en: '[^']+', keywords: \[([^\]]*)\] \}/g)]
    .map((m) => ({ code: m[1], name: m[2], keywords: m[3].split(',').map((k) => k.trim().replace(/^'|'$/g, '')).filter(Boolean) }))
  assert.ok(rows.length >= 50, `前端目录只解析出 ${rows.length} 条,正则可能过时了`)
  assert.deepEqual(COUNTRY_CATALOG.map((c) => ({ code: c.code, name: c.name, keywords: [...c.keywords] })), rows)
})

test('兜底词典去掉了会撞英文单词的短码和泛词,其余关键词照旧', () => {
  const by = Object.fromEntries(FALLBACK_REGION_DICT.map((c) => [c.code, c.keywords]))
  assert.ok(!by.IN.includes('in') && by.IN.includes('india'))
  assert.ok(!by.NZ.includes('new') && by.NZ.includes('new zealand'))
  assert.ok(!by.MY.includes('my') && by.MY.includes('malaysia') && by.MY.includes('马来西亚'))
  assert.ok(by.HK.includes('hk'))
  // 用它去认几个常见的
  assert.equal(matchRegion('🇲🇾 Malaysia 01', FALLBACK_REGION_DICT).code, 'MY')
  assert.equal(matchRegion('IPLC in HK', FALLBACK_REGION_DICT).code, 'HK')
  assert.equal(matchRegion('New York 01', FALLBACK_REGION_DICT), null)
})
