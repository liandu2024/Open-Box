import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { ensureRuleLists, fetchRuleList, listStatePath } from './rule-lists.mjs'
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

test('第一次部署:拉回来、域名和 IP 各编成一份 .srs、记下时间和形状', async () => {
  const ctx = createMockContext({ files: { [paths.singbox]: 'x' } })
  const r = await ensureRuleLists(ctx, paths, routing([URL_A]), { fetchImpl: okFetch('DOMAIN-SUFFIX,a.com\n1.2.3.0/24\n'), now: () => 1000 })
  assert.equal(r.ok, true)
  assert.deepEqual(r.updated, [TAG_A])
  const compiles = ctx.calls.filter((c) => c.args?.includes('compile'))
  assert.deepEqual(compiles.map((c) => c.args[3]), [`${paths.rulesetDir}/${TAG_A}.srs`, `${paths.rulesetDir}/${TAG_A}-ip.srs`])
  // 域名那份只有域名,IP 那份只有 IP:DNS 规则只能引用不含 IP 的规则集(见 engine/rule-list.mjs)
  const src = (name) => JSON.parse(ctx.writes.find((w) => w.path.endsWith(name)).content).rules
  assert.deepEqual(src(`${TAG_A}.json`), [{ domain_suffix: ['a.com'] }])
  assert.deepEqual(src(`${TAG_A}-ip.json`), [{ ip_cidr: ['1.2.3.0/24'] }])
  const state = JSON.parse(ctx.writes.find((w) => w.path === listStatePath(paths)).content)
  assert.equal(state[TAG_A].url, URL_A)
  assert.equal(state[TAG_A].split, 2)
  // 形状表给生成配置用:两份都有
  assert.deepEqual(r.lists, { [TAG_A]: { domain: true, ip: true } })
})

test('只有域名的名单不出 IP 那份,还要把上次留下的 -ip.srs 删掉;只有 IP 的名单反过来', async () => {
  const ctx = createMockContext({ files: { [paths.singbox]: 'x', [`${paths.rulesetDir}/${TAG_A}-ip.srs`]: 'stale' } })
  const r = await ensureRuleLists(ctx, paths, routing([URL_A]), { fetchImpl: okFetch('a.com\nb.com\n'), now: () => 1000 })
  assert.deepEqual(ctx.calls.filter((c) => c.args?.includes('compile')).map((c) => c.args[3]), [`${paths.rulesetDir}/${TAG_A}.srs`])
  assert.equal(await ctx.exists(`${paths.rulesetDir}/${TAG_A}-ip.srs`), false, '过期的 IP 那份要删')
  assert.deepEqual(r.lists, { [TAG_A]: { domain: true, ip: false } })

  const ctx2 = createMockContext({ files: { [paths.singbox]: 'x' } })
  const r2 = await ensureRuleLists(ctx2, paths, routing([URL_A]), { fetchImpl: okFetch('IP-CIDR,1.2.3.0/24\n10.0.0.1\n'), now: () => 1000 })
  assert.deepEqual(ctx2.calls.filter((c) => c.args?.includes('compile')).map((c) => c.args[3]), [`${paths.rulesetDir}/${TAG_A}-ip.srs`])
  assert.deepEqual(r2.lists, { [TAG_A]: { domain: false, ip: true } })
})

test('没到重下时间、文件还在:不再拉', async () => {
  const ctx = createMockContext({
    files: {
      [paths.singbox]: 'x',
      [`${paths.rulesetDir}/${TAG_A}.srs`]: 'bin',
      [listStatePath(paths)]: JSON.stringify({ [TAG_A]: { url: URL_A, at: 1000, split: 2, counts: { domain_suffix: 3 } } }),
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
  // 形状从状态里读出来,不用重新拉
  assert.deepEqual(r.lists, { [TAG_A]: { domain: true, ip: false } })
})

// 老版式 = 域名 IP 混在一份 list-xxx.srs 里、状态里没有 split 标记(升级前的版本编出来的)
const legacyState = () => JSON.stringify({ [TAG_A]: { url: URL_A, at: 1000, counts: { domain_suffix: 1, ip_cidr: 1 } } })
// mock 的 exec 不会真的产出文件:把「decompile 解出来的源文件」预先放好,模拟内核写了它
const decompiled = { [`${paths.dataDir}/tmp/${TAG_A}.legacy.json`]: JSON.stringify({ version: 3, rules: [{ domain_suffix: 'a.com', ip_cidr: ['1.2.3.0/24'] }] }) }

test('本地是老版式、名单没到重下时间:用内核解开旧文件离线拆成两份,不碰网络', async () => {
  const ctx = createMockContext({ files: { [paths.singbox]: 'x', [`${paths.rulesetDir}/${TAG_A}.srs`]: 'bin', [listStatePath(paths)]: legacyState(), ...decompiled } })
  const r = await ensureRuleLists(ctx, paths, routing([URL_A]), {
    fetchImpl: async () => { throw new Error('不该碰网络') },
    now: () => 1000 + 3600_000,
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.updated, [TAG_A])
  const cmds = ctx.calls.filter((c) => c.cmd === paths.singbox).map((c) => `${c.args[1]} ${c.args[3]}`)
  assert.deepEqual(cmds, [
    `decompile ${paths.dataDir}/tmp/${TAG_A}.legacy.json`,
    `compile ${paths.rulesetDir}/${TAG_A}.srs`,
    `compile ${paths.rulesetDir}/${TAG_A}-ip.srs`,
  ])
  assert.deepEqual(r.lists, { [TAG_A]: { domain: true, ip: true } })
  const state = JSON.parse(ctx.writes.find((w) => w.path === listStatePath(paths)).content)
  assert.equal(state[TAG_A].split, 2)
  assert.equal(state[TAG_A].at, 1000, '离线重编不算重下,时间戳不动')
})

test('老版式又解不开(比如文件坏了):改为重新拉取', async () => {
  const ctx = createMockContext({ files: { [paths.singbox]: 'x', [`${paths.rulesetDir}/${TAG_A}.srs`]: 'bin', [listStatePath(paths)]: legacyState() } })
  const r = await ensureRuleLists(ctx, paths, routing([URL_A]), { fetchImpl: okFetch('a.com\n'), now: () => 1000 + 3600_000 })
  assert.deepEqual(r.updated, [TAG_A])
  assert.deepEqual(r.lists, { [TAG_A]: { domain: true, ip: false } })
})

test('老版式、拉不动但本地有旧的:沿用之余也离线拆一下,形状表就有了', async () => {
  const ctx = createMockContext({ files: { [paths.singbox]: 'x', [`${paths.rulesetDir}/${TAG_A}.srs`]: 'bin', [listStatePath(paths)]: legacyState(), ...decompiled } })
  const r = await ensureRuleLists(ctx, paths, routing([URL_A]), {
    fetchImpl: async () => ({ ok: false, status: 502 }),
    now: () => 1000 + 3 * 86400_000,
  })
  assert.equal(r.ok, true)
  assert.equal(r.failed[0].tag, TAG_A)
  assert.deepEqual(r.lists, { [TAG_A]: { domain: true, ip: true } })
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
  assert.deepEqual(r, { ok: true, updated: [], failed: [], lists: {} })
})

test('链接指向 .mrs:自己解开 zstd,编出来的和文本名单走同一条路', async () => {
  const mrs = readFileSync(new URL('../engine/fixtures/geosite-tesla.mrs', import.meta.url))
  const ctx = createMockContext({ files: { [paths.singbox]: 'x' } })
  const r = await ensureRuleLists(ctx, paths, routing([URL_A]), { fetchImpl: okFetch(mrs), now: () => 1000 })
  assert.equal(r.ok, true)
  const src = JSON.parse(ctx.writes.find((w) => w.path.endsWith(`${TAG_A}.json`)).content)
  assert.equal(src.rules[0].domain_suffix.length, 11)
  assert.ok(src.rules[0].domain_suffix.includes('tesla.com'))
  // 还是那一句 rule-set compile,内核那边完全不知道来源是 .mrs;纯域名的 .mrs 不出 IP 那份
  assert.deepEqual(ctx.calls.filter((c) => c.args?.includes('compile')).map((c) => c.args[3]), [`${paths.rulesetDir}/${TAG_A}.srs`])
  assert.deepEqual(r.lists, { [TAG_A]: { domain: true, ip: false } })
})

// 审查第 4 项:超时和 8MB 上限要管到响应体读完为止
const streamOf = ({ chunk, count, hang = false }) => new ReadableStream({
  sent: 0,
  pull(controller) {
    if (this.sent >= count) {
      if (hang) return new Promise(() => {})   // 头回了、正文一直不结束
      controller.close()
      return undefined
    }
    this.sent++
    controller.enqueue(new Uint8Array(chunk))
    return undefined
  },
})

test('fetchRuleList:响应体流式累计,超过上限立刻断开,不把整份读进内存', async () => {
  let pulled = 0
  const body = new ReadableStream({
    pull(controller) {
      pulled++
      if (pulled > 12) { controller.close(); return }
      controller.enqueue(new Uint8Array(1024 * 1024))   // 每块 1MB,共 12MB
    },
  })
  const fetchImpl = async () => new Response(body, { status: 200 })
  await assert.rejects(() => fetchRuleList(fetchImpl, 'https://example.com/list.txt'), /名单太大/)
  assert.ok(pulled <= 10, `越限后不该继续读,实际读了 ${pulled} 块`)
})

test('fetchRuleList:Content-Length 声明超限直接拒,一个字节都不读', async () => {
  let pulled = 0
  const body = new ReadableStream({ pull(controller) { pulled++; controller.enqueue(new Uint8Array(16)); controller.close() } })
  const fetchImpl = async () => new Response(body, { status: 200, headers: { 'content-length': String(9 * 1024 * 1024) } })
  await assert.rejects(() => fetchRuleList(fetchImpl, 'https://example.com/list.txt'), /名单太大/)
  // ReadableStream 自己会预拉一块填队列(highWaterMark 1),那不是我们读的;再多就是真去读了
  assert.ok(pulled <= 1, `声明超限就不该读正文,实际拉了 ${pulled} 块`)
})

test('fetchRuleList:响应头到了但正文一直不结束 → 总超时照样生效,不再无限等', async () => {
  const fetchImpl = async () => new Response(streamOf({ chunk: 8, count: 2, hang: true }), { status: 200 })
  const t0 = Date.now()
  await assert.rejects(() => fetchRuleList(fetchImpl, 'https://example.com/list.txt', { timeoutMs: 120 }), /下载超时/)
  assert.ok(Date.now() - t0 < 2000)
})

test('fetchRuleList:正常大小的流式响应照常读完;没有流的响应(旧桩)走一次性读', async () => {
  const fetchImpl = async () => new Response(streamOf({ chunk: 3, count: 4 }), { status: 200 })
  const buf = await fetchRuleList(fetchImpl, 'https://example.com/list.txt')
  assert.equal(buf.length, 12)
  const plain = await fetchRuleList(async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('DOMAIN-SUFFIX,a.com\n') }), 'https://example.com/list.txt')
  assert.equal(plain.toString(), 'DOMAIN-SUFFIX,a.com\n')
})
