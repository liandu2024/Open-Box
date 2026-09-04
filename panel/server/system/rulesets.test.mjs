import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureRulesets, rulesetUrls, rulesetKind, RULESET_MIRRORS, SOURCE_MARKER } from './rulesets.mjs'
import { createMockContext } from './context.mjs'

const configWith = (tags) => ({
  route: {
    rule_set: tags.map((tag) => ({
      type: 'local', tag, format: 'binary', path: `/opt/open-box/data/rulesets/${tag}.srs`,
    })),
  },
})

const okFetch = (body = Buffer.from('SRS-FAKE-BINARY')) => {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    return { ok: true, status: 200, arrayBuffer: async () => body }
  }
  return { impl, calls }
}

test('tag 前缀决定去哪个官方仓库取', () => {
  assert.equal(rulesetKind('geoip-cn'), 'geoip')
  assert.equal(rulesetKind('geosite-cn'), 'geosite')
  assert.equal(rulesetKind('whatever'), null)
})

test('每个 tag 都给出直连 + 三个加速站共四个候选来源', () => {
  const urls = rulesetUrls('geosite-cn')
  assert.equal(urls.length, RULESET_MIRRORS.length)
  assert.equal(urls[0], 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/cn.srs')
  assert.ok(urls.slice(1).every((u) => u.endsWith('/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/cn.srs')))
})

test('geosite-geolocation-!cn 的感叹号原样进 URL(raw.githubusercontent 接受)', () => {
  assert.ok(rulesetUrls('geosite-geolocation-!cn')[0].endsWith('geosite/geolocation-!cn.srs'))
})

test('缺失的规则集会被下载,并且是按二进制写入', async () => {
  const ctx = createMockContext()
  const { impl, calls } = okFetch()
  const result = await ensureRulesets(ctx, configWith(['geosite-cn', 'geoip-cn']), { fetchImpl: impl })
  assert.equal(result.ok, true)
  assert.deepEqual(result.downloaded, ['geosite-cn', 'geoip-cn'])
  assert.equal(calls.length, 2, '每个规则集首选来源就成功时只应请求一次')
  // 必须走 writeFileBinary:utf8 写入会悄悄破坏 .srs
  assert.ok(Buffer.isBuffer(ctx.files['/opt/open-box/data/rulesets/geosite-cn.srs']))
})

test('已存在的规则集不重新下载(部署不该每次都依赖外网)', async () => {
  const ctx = createMockContext({
    // 目录标记说明这些文件就是现在这个来源下的;没有标记的老目录会走迁移重下(另有用例)
    files: { '/opt/open-box/data/rulesets/geosite-cn.srs': Buffer.from('already-here'), '/opt/open-box/data/rulesets/.source': 'metacubex\n' },
  })
  const { impl, calls } = okFetch()
  const result = await ensureRulesets(ctx, configWith(['geosite-cn']), { fetchImpl: impl })
  assert.equal(result.ok, true)
  assert.deepEqual(result.downloaded, [])
  assert.equal(calls.length, 0)
})

test('首选来源失败时依次退到加速站', async () => {
  const ctx = createMockContext()
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    if (!url.startsWith('https://ghfast.top/')) return { ok: false, status: 403 }
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('SRS') }
  }
  const result = await ensureRulesets(ctx, configWith(['geosite-cn']), { fetchImpl: impl })
  assert.equal(result.ok, true)
  assert.deepEqual(result.downloaded, ['geosite-cn'])
  assert.equal(calls.length, 2)
})

test('加速站返回 200 但空响应体要当失败,不能写出一个"存在但必炸"的空文件', async () => {
  const ctx = createMockContext()
  const impl = async (url) =>
    url.startsWith('https://gh-proxy.com/')
      ? { ok: true, status: 200, arrayBuffer: async () => Buffer.from('SRS') }
      : { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(0) }
  const result = await ensureRulesets(ctx, configWith(['geosite-cn']), { fetchImpl: impl })
  assert.equal(result.ok, true)
  assert.equal(ctx.files['/opt/open-box/data/rulesets/geosite-cn.srs'].length, 3)
})

test('所有来源都失败 → ok:false 且带上原因,不写任何文件', async () => {
  const ctx = createMockContext()
  const impl = async () => { throw new Error('ECONNREFUSED') }
  const result = await ensureRulesets(ctx, configWith(['geosite-cn']), { fetchImpl: impl })
  assert.equal(result.ok, false)
  assert.match(result.message, /geosite-cn/)
  assert.equal(Object.keys(ctx.files).length, 0)
})

test('不认识的规则集名给出明确错误,而不是去拼一个不存在的 URL', async () => {
  const ctx = createMockContext()
  const { impl, calls } = okFetch()
  const result = await ensureRulesets(ctx, configWith(['my-custom-list']), { fetchImpl: impl })
  assert.equal(result.ok, false)
  assert.match(result.message, /geoip-\/geosite-/)
  assert.equal(calls.length, 0)
})

test('配置里没有 local 规则集时什么都不做', async () => {
  const ctx = createMockContext()
  const { impl, calls } = okFetch()
  const result = await ensureRulesets(ctx, { route: {} }, { fetchImpl: impl })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 0)
})

test('带路径穿越的 tag 直接拒绝:这个模块会按 tag 拼出的路径写文件', async () => {
  const ctx = createMockContext()
  const { impl, calls } = okFetch()
  const evil = 'geosite-../../../tmp/pwned'
  assert.equal(rulesetKind(evil), null)
  const result = await ensureRulesets(
    ctx,
    { route: { rule_set: [{ type: 'local', tag: evil, format: 'binary', path: '/tmp/pwned.srs' }] } },
    { fetchImpl: impl },
  )
  assert.equal(result.ok, false)
  assert.equal(calls.length, 0, '不合法的 tag 连请求都不该发出')
  assert.equal(Object.keys(ctx.files).length, 0, '不得写出任何文件')
})

test('规则集路径:sing 分支的 geo/<kind>/<名字>.srs,文件名不带前缀;镜像照样加前缀', () => {
  const urls = rulesetUrls('geosite-gfw', ['', 'https://ghfast.top/'])
  assert.deepEqual(urls, [
    'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/gfw.srs',
    'https://ghfast.top/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/gfw.srs',
  ])
  assert.equal(rulesetUrls('geoip-cn', [''])[0], 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geoip/cn.srs')
})

test('老安装迁移:目录里没有来源标记(以前是 SagerNet 官方的文件)→ 配置用到的规则集整体重下并写标记;之后按标记跳过', async () => {
  const { createMockContext } = await import('./context.mjs')
  const dir = '/opt/open-box/data/rulesets'
  const config = { route: { rule_set: [
    { type: 'local', tag: 'geosite-cn', path: `${dir}/geosite-cn.srs` },
    { type: 'local', tag: 'geoip-cn', path: `${dir}/geoip-cn.srs` },
  ] } }
  const fetched = []
  const fetchImpl = async (url) => { fetched.push(url); return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } }
  const ctx = createMockContext({ files: { [`${dir}/geosite-cn.srs`]: 'old-sagernet', [`${dir}/geoip-cn.srs`]: 'old-sagernet' } })
  const r1 = await ensureRulesets(ctx, config, { fetchImpl })
  assert.deepEqual(r1.downloaded, ['geosite-cn', 'geoip-cn'])
  assert.equal(r1.switched, true)
  assert.ok(fetched.every((u) => u.includes('MetaCubeX/meta-rules-dat/sing/')))
  assert.equal((ctx.files[`${dir}/${SOURCE_MARKER}`] || '').trim(), 'metacubex')
  fetched.length = 0
  const r2 = await ensureRulesets(ctx, config, { fetchImpl })
  assert.deepEqual(r2.downloaded, [])
  assert.equal(fetched.length, 0)
})
