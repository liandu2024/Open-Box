import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { refreshRulesets } from './updater.mjs'

const paths = createPaths('/opt/open-box')

// 审查第 11 项:「规则集链接」编出来的 list-* / list-*-ip 不在 MetaCubeX 上,Geo 更新不该去下它,
// 更不该把它记成失败——以前配置里只要有一条规则集链接,每次 Geo 更新界面就持续报错。
test('refreshRulesets 只更新 geoip-/geosite-,规则集链接的 list-* 既不下载也不算失败、不计入 total', async () => {
  const dir = paths.rulesetDir
  const config = {
    route: {
      rule_set: [
        { type: 'local', tag: 'geosite-cn', format: 'binary', path: `${dir}/geosite-cn.srs` },
        { type: 'local', tag: 'list-934d523f', format: 'binary', path: `${dir}/list-934d523f.srs` },
        { type: 'local', tag: 'list-934d523f-ip', format: 'binary', path: `${dir}/list-934d523f-ip.srs` },
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
  assert.ok(urls.every((u) => !u.includes('list-')), `不该去下规则集链接:${urls.join(', ')}`)
  // 规则集链接的文件不动,Geo 的写进去了
  assert.equal(await ctx.exists(`${dir}/list-934d523f.srs`), false)
  assert.equal(await ctx.exists(`${dir}/geosite-cn.srs`), true)
})
