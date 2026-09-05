import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { clearRulesetEntriesCache, registerRulesetRoutes } from './rulesets.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'

const paths = createPaths('/opt/open-box')
const DECOMPILED = JSON.stringify({
  version: 1,
  rules: [
    { domain: ['www.google.com'], domain_suffix: ['google.com', 'gstatic.com'] },
    { ip_cidr: ['8.8.8.8/32'] },
    // 只有一个值时内核输出的是裸字符串,不是数组
    { domain_keyword: 'youtube' },
    { invert: true },
  ],
})

// 内核解码那一步用 mock ctx 顶掉:exec 只记录调用,输出文件预先摆在 files 里。
const okCtx = (over = {}) => createMockContext({
  files: {
    [`${paths.rulesetDir}/geosite-google.srs`]: 'binary',
    [`${paths.dataDir}/tmp/geosite-google.json`]: DECOMPILED,
    ...over,
  },
})

const startApp = async (ctx, fetchImpl) => {
  clearRulesetEntriesCache()
  const app = express()
  registerRulesetRoutes(app, { ctx, paths, fetchImpl })
  const server = app.listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test('列出一个分类里的条目,按类型+值摊平', async () => {
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/rulesets/entries?tag=geosite-google`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.total, 5)
    assert.deepEqual(body.entries, [
      { type: 'domain', value: 'www.google.com' },
      { type: 'domain_suffix', value: 'google.com' },
      { type: 'domain_suffix', value: 'gstatic.com' },
      { type: 'ip_cidr', value: '8.8.8.8/32' },
      { type: 'domain_keyword', value: 'youtube' },
    ])
    // 解码交给内核自己:面板不另写一套 .srs 解析
    assert.ok(ctx.calls.some((c) => c.args.includes('decompile')))
  } finally {
    await close()
  }
})

test('搜索与分页只作用在匹配结果上', async () => {
  const { baseUrl, close } = await startApp(okCtx())
  try {
    const res = await fetch(`${baseUrl}/api/openbox/rulesets/entries?tag=geosite-google&q=GOOGLE&offset=1&limit=1`)
    const body = await res.json()
    assert.equal(body.total, 5)
    assert.equal(body.matched, 2) // www.google.com 和 google.com,大小写不敏感
    assert.deepEqual(body.entries, [{ type: 'domain_suffix', value: 'google.com' }])
  } finally {
    await close()
  }
})

test('本地没有的分类现下一份,顺手留在正式目录里', async () => {
  const ctx = createMockContext({ files: { [`${paths.dataDir}/tmp/geosite-openai.json`]: DECOMPILED } })
  let asked = ''
  const fetchImpl = async (url) => {
    asked = url
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('srs').buffer }
  }
  const { baseUrl, close } = await startApp(ctx, fetchImpl)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/rulesets/entries?tag=geosite-openai`)
    assert.equal(res.status, 200)
    assert.match(asked, /meta-rules-dat\/sing\/geo\/geosite\/openai\.srs$/)
    assert.ok(ctx.writes.some((w) => w.path === `${paths.rulesetDir}/geosite-openai.srs`))
  } finally {
    await close()
  }
})

test('名字不合法直接 400——tag 会被拼进下载地址和文件名', async () => {
  const { baseUrl, close } = await startApp(okCtx())
  try {
    for (const tag of ['../../etc/passwd', 'geosite-../x', 'whatever-cn', '']) {
      const res = await fetch(`${baseUrl}/api/openbox/rulesets/entries?tag=${encodeURIComponent(tag)}`)
      assert.equal(res.status, 400, tag)
    }
  } finally {
    await close()
  }
})

test('解码失败 → 503,把内核的话原样带出去', async () => {
  const ctx = createMockContext({
    files: { [`${paths.rulesetDir}/geosite-google.srs`]: 'binary' },
    execResults: { [`${paths.singbox} rule-set decompile --output ${paths.dataDir}/tmp/geosite-google.json ${paths.rulesetDir}/geosite-google.srs`]: { code: 1, stderr: 'bad magic' } },
  })
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/rulesets/entries?tag=geosite-google`)
    assert.equal(res.status, 503)
    assert.match((await res.json()).message, /bad magic/)
  } finally {
    await close()
  }
})

test('GET /policies/entries:站点集的规则集展开 + 手写条件,分档计数、搜索、分页;兜底返回空', async () => {
  const ctx = okCtx()
  const store = {
    getProfile: () => ({
      routing: {
        fallbackDefault: 'direct',
        policies: [
          { id: 'g', name: 'Google', rulesets: ['geosite-google'], domainSuffix: ['gg.example'], ipCidr: ['1.1.1.0/24'] },
        ],
      },
    }),
  }
  const app = express()
  clearRulesetEntriesCache()
  registerRulesetRoutes(app, { ctx, paths, store })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const all = await (await fetch(`${base}/api/openbox/policies/entries?name=Google`)).json()
    // 规则集 5 条(1 domain + 2 suffix + 1 cidr + 1 keyword)+ 手写 2 条
    assert.equal(all.total, 7)
    assert.deepEqual(all.counts, { all: 7, domain: 5, ip: 2 })
    assert.ok(all.entries.some((e) => e.source === 'custom' && e.content === 'gg.example'))
    assert.ok(all.entries.some((e) => e.source === 'geosite-google' && e.type === 'domain_suffix'))
    const ip = await (await fetch(`${base}/api/openbox/policies/entries?name=Google&tab=ip`)).json()
    assert.equal(ip.matched, 2)
    const q = await (await fetch(`${base}/api/openbox/policies/entries?name=Google&q=gstatic`)).json()
    assert.equal(q.matched, 1)
    const page = await (await fetch(`${base}/api/openbox/policies/entries?name=Google&limit=3`)).json()
    assert.equal(page.entries.length, 3)
    assert.equal(page.hasMore, true)
    const fb = await (await fetch(`${base}/api/openbox/policies/entries?name=${encodeURIComponent('其他')}`)).json()
    assert.equal(fb.fallback, true)
    const nf = await fetch(`${base}/api/openbox/policies/entries?name=Nope`)
    assert.equal(nf.status, 404)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('GET /rulesets/preview:按网址拉回来解析,形状和 /rulesets/entries 一致;非 http(s) 直接 400;拉不动 503', async () => {
  clearRulesetEntriesCache()
  const ctx = createMockContext({})
  const paths = createPaths('/opt/open-box')
  let hits = 0
  const fetchImpl = async (url) => {
    hits += 1
    if (url.includes('bad')) return { ok: false, status: 502 }
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('DOMAIN-SUFFIX,a.com\nb.com\nIP-CIDR,1.2.3.0/24,no-resolve\nMATCH,DIRECT\n') }
  }
  const app = express()
  registerRulesetRoutes(app, { ctx, paths, fetchImpl })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}/api/openbox/rulesets/preview`
  try {
    const ok = await (await fetch(`${base}?url=${encodeURIComponent('https://x.test/Check.list')}&limit=2`)).json()
    assert.equal(ok.total, 3)
    assert.equal(ok.matched, 3)
    assert.deepEqual(ok.entries, [{ type: 'domain_suffix', value: 'a.com' }, { type: 'domain_suffix', value: 'b.com' }])
    // 搜索走同一份缓存,不再拉第二次
    const q = await (await fetch(`${base}?url=${encodeURIComponent('https://x.test/Check.list')}&q=1.2`)).json()
    assert.equal(q.matched, 1)
    assert.equal(hits, 1)
    const bad = await fetch(`${base}?url=${encodeURIComponent('ftp://x.test/a')}`)
    assert.equal(bad.status, 400)
    const down = await fetch(`${base}?url=${encodeURIComponent('https://bad.test/a')}`)
    assert.equal(down.status, 503)
  } finally {
    await new Promise((r) => server.close(r))
  }
})
