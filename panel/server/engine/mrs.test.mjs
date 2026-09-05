import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { decodeMrs, looksLikeMrs, looksLikeZstd } from './mrs.mjs'

// 用的是 meta-rules-dat 上真的 .mrs(挑了最小的两个,一共 336 字节)。
// 自己造一份的话,造的人和解的人对格式的理解是同一个,错了也测不出来。
const fixture = (name) =>
  zstdDecompressSync(readFileSync(new URL(`./fixtures/${name}.mrs`, import.meta.url)))

test('domain 类型:+.x 归后缀,只写精确名的归 domain', () => {
  const { behavior, count, parsed } = decodeMrs(fixture('geosite-tesla'))
  assert.equal(behavior, 0)
  // 头里的条数就是原始规则条数,解出来的应该正好对得上
  assert.equal(count, 11)
  assert.equal(Object.values(parsed).reduce((a, b) => a + b.length, 0), 11)
  assert.deepEqual(parsed.domain, [])
  for (const d of ['tesla.com', 'tesla.cn', 'teslamotors.com.cn', 'ts.la']) {
    assert.ok(parsed.domain_suffix.includes(d), `应包含 ${d}`)
  }
})

test('ipcidr 类型:起止地址还原成 CIDR,v4 v6 都要对', () => {
  const { behavior, count, parsed } = decodeMrs(fixture('geoip-telegram'))
  assert.equal(behavior, 1)
  assert.equal(count, 12)
  assert.equal(parsed.ip_cidr.length, 12)
  assert.ok(parsed.ip_cidr.includes('149.154.160.0/20'))
  assert.ok(parsed.ip_cidr.includes('91.108.4.0/22'))
  // v6 要用压缩写法,不能写成 2001:0:0:… 或者 ::ffff: 映射形式
  assert.ok(parsed.ip_cidr.includes('2a0a:f280::/32'))
  assert.equal(parsed.domain_suffix.length, 0)
})

test('认得出 zstd 和 MRS 的魔数', () => {
  const raw = readFileSync(new URL('./fixtures/geosite-tesla.mrs', import.meta.url))
  assert.equal(looksLikeZstd(raw), true)
  assert.equal(looksLikeMrs(raw), false, '压缩着的时候还不是 MRS')
  assert.equal(looksLikeMrs(zstdDecompressSync(raw)), true)
  assert.equal(looksLikeZstd(Buffer.from('DOMAIN,a.com\n')), false)
})

test('不是 .mrs、或者是 classical 的,报错说清楚', () => {
  assert.throws(() => decodeMrs(Buffer.from('# 一份普通文本名单\n')), /不是 \.mrs/)
  const classical = Buffer.concat([Buffer.from([0x4d, 0x52, 0x53, 0x01, 2]), Buffer.alloc(16)])
  assert.throws(() => decodeMrs(classical), /classical/)
})

test('文件被截断时报错,不吐出半份名单', () => {
  const full = fixture('geosite-tesla')
  assert.throws(() => decodeMrs(full.subarray(0, full.length - 20)), /不完整/)
})
