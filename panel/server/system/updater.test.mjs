import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { refreshRulesets } from './updater.mjs'

const paths = createPaths('/opt/open-box')

// 「规则集链接」编出来的 list-* / list-*-ip 与 DNS 过滤运行时生成的 dns-filter-* 不在
// MetaCubeX 上，Geo 更新不该去下它们，更不该把它们记成失败。
test('refreshRulesets 只更新 geoip-/geosite-,非 Geo 本地规则集既不下载也不算失败', async () => {
  const dir = paths.rulesetDir
  const config = {
    route: {
      rule_set: [
        { type: 'local', tag: 'geosite-cn', format: 'binary', path: `${dir}/geosite-cn.srs` },
        { type: 'local', tag: 'list-934d523f', format: 'binary', path: `${dir}/list-934d523f.srs` },
        { type: 'local', tag: 'list-934d523f-ip', format: 'binary', path: `${dir}/list-934d523f-ip.srs` },
        { type: 'local', tag: 'dns-filter-allow-abcd1234', format: 'binary', path: `${dir}/dns-filter-allow-abcd1234.srs` },
        { type: 'local', tag: 'dns-filter-anti-ad-block-efgh5678', format: 'binary', path: `${dir}/dns-filter-anti-ad-block-efgh5678.srs` },
        { type: 'local', tag: 'custom-local-rule', format: 'binary', path: `${dir}/custom-local-rule.srs` },
        { type: 'local', tag: 'geoip-cn', format: 'binary', path: `${dir}/geoip-cn.srs` },
      ],
    },
  }
  const ctx = createMockContext({ files: { [paths.configPath]: JSON.stringify(config) } })
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(String(url))
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
  }
  const r = await refreshRulesets(ctx, paths, { fetchImpl, latest: {} })
  assert.deepEqual(r.failed, [])
  assert.deepEqual(r.updated.sort(), ['geoip-cn', 'geosite-cn'])
  assert.equal(r.total, 2)
  assert.ok(urls.length > 0)
  assert.ok(urls.every((u) => !u.includes('list-') && !u.includes('dns-filter-')), `不该去下非 Geo 规则集:${urls.join(', ')}`)
  // 规则集链接的文件不动,Geo 的写进去了
  assert.equal(await ctx.exists(`${dir}/list-934d523f.srs`), false)
  assert.equal(await ctx.exists(`${dir}/geosite-cn.srs`), true)
})

// GitHub #33:新装机第一次启动时规则集是部署流程自动下载的,以前没记版本,「当前版本」一直「未知」
test('recordGeoVersionsAfterDownload:自动下载后探一次上游版本记进 geo-update.json;探不到就不写', async () => {
  const { recordGeoVersionsAfterDownload } = await import('./updater.mjs')
  const dir = paths.rulesetDir
  const config = { route: { rule_set: [
    { type: 'local', tag: 'geosite-cn', format: 'binary', path: `${dir}/geosite-cn.srs` },
    { type: 'local', tag: 'geoip-cn', format: 'binary', path: `${dir}/geoip-cn.srs` },
  ] } }
  const ctx = createMockContext({ files: { [paths.configPath]: JSON.stringify(config) } })
  const okProbe = async (url) => {
    assert.ok(String(url).includes('api.github.com/repos/MetaCubeX/meta-rules-dat/commits/sing'))
    return { ok: true, status: 200, json: async () => ({ sha: 'abcdef1234567890', commit: { committer: { date: '2026-09-08T10:00:00Z' } } }) }
  }
  const versions = await recordGeoVersionsAfterDownload(ctx, paths, { fetchImpl: okProbe, downloaded: ['geosite-cn', 'geoip-cn'] })
  assert.deepEqual(versions, { geosite: '2026-09-08 abcdef12', geoip: '2026-09-08 abcdef12' })
  const state = JSON.parse(await ctx.readFile(paths.geoUpdateStatePath))
  assert.equal(state.trigger, 'deploy')
  assert.deepEqual(state.updated, ['geosite-cn', 'geoip-cn'])
  assert.equal(state.source, 'metacubex')
  assert.ok(state.lastAt)

  // 探不到上游:不写文件,保持原样
  const ctx2 = createMockContext({ files: { [paths.configPath]: JSON.stringify(config) } })
  const failProbe = async () => { throw new Error('offline') }
  assert.equal(await recordGeoVersionsAfterDownload(ctx2, paths, { fetchImpl: failProbe, downloaded: ['geosite-cn'] }), null)
  assert.equal(await ctx2.exists(paths.geoUpdateStatePath), false)
})
