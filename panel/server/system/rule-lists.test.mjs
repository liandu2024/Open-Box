import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { ensureRuleLists, listStatePath } from './rule-lists.mjs'
import { listTagForUrl } from '../engine/rule-list.mjs'

const paths = createPaths('/opt/open-box')
const URL_A = 'https://example.com/list/Check.list'
const TAG_A = listTagForUrl(URL_A)
const routing = (urls) => ({ policies: [{ id: 'p1', name: '测试', ruleUrls: urls, default: 'direct' }] })
const okFetch = (body) => async () => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => (typeof body === 'string' ? Buffer.from(body) : body),
})

test('第一次部署:拉回来、编成 .srs、记下时间', async () => {
  const ctx = createMockContext({ files: { [paths.singbox]: 'x' } })
  const r = await ensureRuleLists(ctx, paths, routing([URL_A]), { fetchImpl: okFetch('DOMAIN-SUFFIX,a.com\n1.2.3.0/24\n'), now: () => 1000 })
  assert.equal(r.ok, true)
  assert.deepEqual(r.updated, [TAG_A])
  const compile = ctx.calls.find((c) => c.args?.includes('compile'))
  assert.ok(compile, '要调 sing-box rule-set compile')
  assert.deepEqual(compile.args.slice(0, 4), ['rule-set', 'compile', '--output', `${paths.rulesetDir}/${TAG_A}.srs`])
  // 源文件写过又删掉,只留 .srs
  const src = ctx.writes.find((w) => w.path.endsWith(`${TAG_A}.json`))
  assert.deepEqual(JSON.parse(src.content).rules, [{ domain_suffix: ['a.com'], ip_cidr: ['1.2.3.0/24'] }])
  const state = JSON.parse(ctx.writes.find((w) => w.path === listStatePath(paths)).content)
  assert.equal(state[TAG_A].url, URL_A)
})

test('没到重下时间、文件还在:不再拉', async () => {
  const ctx = createMockContext({
    files: {
      [paths.singbox]: 'x',
      [`${paths.rulesetDir}/${TAG_A}.srs`]: 'bin',
      [listStatePath(paths)]: JSON.stringify({ [TAG_A]: { url: URL_A, at: 1000 } }),
    },
  })
  let fetched = 0
  const r = await ensureRuleLists(ctx, paths, routing([URL_A]), {
    fetchImpl: async () => { fetched += 1; return okFetch('a.com')() },
    now: () => 1000 + 3600_000,
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.updated, [])
  assert.equal(fetched, 0)
})

test('拉不动:本地有旧的就沿用,没有就让部署停下来', async () => {
  const withOld = createMockContext({
    files: { [paths.singbox]: 'x', [`${paths.rulesetDir}/${TAG_A}.srs`]: 'bin' },
  })
  const r1 = await ensureRuleLists(withOld, paths, routing([URL_A]), { fetchImpl: async () => ({ ok: false, status: 502 }) })
  assert.equal(r1.ok, true)
  assert.equal(r1.failed[0].tag, TAG_A)

  const fresh = createMockContext({ files: { [paths.singbox]: 'x' } })
  const r2 = await ensureRuleLists(fresh, paths, routing([URL_A]), { fetchImpl: async () => ({ ok: false, status: 502 }) })
  assert.equal(r2.ok, false)
  assert.match(r2.message, /规则集链接拉取失败/)
})

test('名单里一条都解析不出来:当作失败,别编出一个空规则集', async () => {
  const ctx = createMockContext({ files: { [paths.singbox]: 'x' } })
  const r = await ensureRuleLists(ctx, paths, routing([URL_A]), { fetchImpl: okFetch('# 只有注释\n') })
  assert.equal(r.ok, false)
  assert.match(r.message, /没有解析出/)
})

test('没有引用任何链接时什么都不做', async () => {
  const ctx = createMockContext({})
  const r = await ensureRuleLists(ctx, paths, routing([]), { fetchImpl: async () => { throw new Error('不该被调用') } })
  assert.deepEqual(r, { ok: true, updated: [], failed: [] })
})

test('链接指向 .mrs:自己解开 zstd,编出来的和文本名单走同一条路', async () => {
  const mrs = readFileSync(new URL('../engine/fixtures/geosite-tesla.mrs', import.meta.url))
  const ctx = createMockContext({ files: { [paths.singbox]: 'x' } })
  const r = await ensureRuleLists(ctx, paths, routing([URL_A]), { fetchImpl: okFetch(mrs), now: () => 1000 })
  assert.equal(r.ok, true)
  const src = JSON.parse(ctx.writes.find((w) => w.path.endsWith(`${TAG_A}.json`)).content)
  assert.equal(src.rules[0].domain_suffix.length, 11)
  assert.ok(src.rules[0].domain_suffix.includes('tesla.com'))
  // 还是那一句 rule-set compile,内核那边完全不知道来源是 .mrs
  assert.ok(ctx.calls.find((c) => c.args?.includes('compile')))
})
