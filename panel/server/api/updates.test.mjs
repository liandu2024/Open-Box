import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerUpdateRoutes } from './updates.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'
import { compareVersions, fetchLatestVersion, parseKeyValues } from '../system/updater.mjs'
import { runScheduledTasks } from '../system/scheduler.mjs'
import { createStore } from '../store/openbox-store.mjs'

const paths = createPaths('/opt/open-box')

const startApp = async (ctx, store, fetchImpl) => {
  const app = express()
  registerUpdateRoutes(app, { store, ctx, paths, fetchImpl })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

test('版本比较:只看前三段;git describe 的开发版和同号 tag 相等', () => {
  assert.ok(compareVersions('v0.2.0', 'v0.1.55-112-gbffc3d5') > 0)
  assert.equal(compareVersions('v0.1.55', 'v0.1.55-112-gbffc3d5'), 0)
  assert.ok(compareVersions('v0.1.54', 'v0.1.55') < 0)
  assert.deepEqual(parseKeyValues('pid=12\nstage=downloading\nbytes=10\nmessage=a=b'), { pid: '12', stage: 'downloading', bytes: '10', message: 'a=b' })
})

test('fetchLatestVersion:从 releases/latest 的 302 跳转里取 tag,直连失败退到镜像', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.startsWith('https://github.com/')) throw new Error('offline')
    return { status: 302, headers: new Map([['location', 'https://github.com/liandu2024/Open-Box/releases/tag/v0.2.3']]), url: '' }
  }
  const r = await fetchLatestVersion(fetchImpl, { mirrors: ['https://mirror.test/'] })
  assert.equal(r.latest, 'v0.2.3')
  assert.equal(r.via, 'https://mirror.test/')
  assert.equal(calls.length, 2)
})

test('GET /update/status + POST /update/run:读 meta/通道/状态文件,发起时调 update.sh --detach --mirror', async () => {
  const ctx = createMockContext({
    files: {
      [paths.metaPath]: JSON.stringify({ version: 'v0.1.55', singboxVersion: '1.13.14' }),
      [paths.channelPath]: 'mirror\nhttps://ghfast.top/\n',
      [paths.updateStatusPath]: 'pid=9\nstage=done\nbytes=\ntotal=\nmessage=ok\n',
      [paths.updateScript]: '#!/bin/sh\n',
    },
  })
  // 探最新 tag 的 fetch:第一次 offline(不带 --expect),第二次给 302(带 --expect)
  let online = false
  const fetchImpl = async () => {
    if (!online) throw new Error('offline')
    return { status: 302, headers: new Map([['location', 'https://github.com/liandu2024/Open-Box/releases/tag/v0.2.3']]), url: '' }
  }
  const { base, close } = await startApp(ctx, { getProfile: () => ({}) }, fetchImpl)
  try {
    const st = await (await fetch(`${base}/api/openbox/update/status`)).json()
    assert.equal(st.version, 'v0.1.55')
    assert.deepEqual(st.channel, { mode: 'mirror', prefix: 'https://ghfast.top/' })
    assert.equal(st.status.stage, 'done')
    assert.equal(st.status.running, false)
    const run = await fetch(`${base}/api/openbox/update/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'mirror' }) })
    assert.equal(run.status, 200)
    const call = ctx.calls.find((c) => c.cmd === 'sh')
    assert.deepEqual(call.args, [paths.updateScript, '--detach', '--mirror'])
    online = true
    ctx.calls.length = 0
    await fetch(`${base}/api/openbox/update/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'direct' }) })
    assert.deepEqual(ctx.calls.find((c) => c.cmd === 'sh').args, [paths.updateScript, '--detach', '--direct', '--expect', 'v0.2.3'])
    const bad = await fetch(`${base}/api/openbox/update/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'x' }) })
    assert.equal(bad.status, 400)
  } finally {
    await close()
  }
})

test('POST /update/run:已有更新在跑 → 409', async () => {
  const ctx = createMockContext({ files: { [paths.updateStatusPath]: 'stage=downloading\n', [paths.updateScript]: '' } })
  const { base, close } = await startApp(ctx, { getProfile: () => ({}) })
  try {
    const r = await fetch(`${base}/api/openbox/update/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(r.status, 409)
  } finally {
    await close()
  }
})

test('POST /rulesets/refresh:配置里一个 Geo 规则集都没有(新装机内核没成功部署过)→ nothing + 说明,不报"已更新 0 个"(GitHub #20)', async () => {
  const ctx = createMockContext({
    files: { [paths.configPath]: JSON.stringify({ route: { rule_set: [] } }) },
    execResults: { '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } },
  })
  const { base, close } = await startApp(ctx, { getProfile: () => ({}) }, async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1]).buffer }))
  try {
    const r = await (await fetch(`${base}/api/openbox/rulesets/refresh`, { method: 'POST' })).json()
    assert.equal(r.ok, true)
    assert.equal(r.nothing, true)
    assert.deepEqual(r.updated, [])
    assert.match(r.message, /没有 Geo 规则集/)
  } finally {
    await close()
  }
})

test('POST /rulesets/refresh:按配置里的本地规则集重新下载,记录到 geo-update.json', async () => {
  const config = { route: { rule_set: [
    { type: 'local', tag: 'geosite-cn', path: `${paths.rulesetDir}/geosite-cn.srs` },
    { type: 'local', tag: 'geoip-cn', path: `${paths.rulesetDir}/geoip-cn.srs` },
  ] } }
  const ctx = createMockContext({
    files: { [paths.configPath]: JSON.stringify(config) },
    execResults: { '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } },
  })
  const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })
  const { base, close } = await startApp(ctx, { getProfile: () => ({}) }, fetchImpl)
  try {
    const r = await (await fetch(`${base}/api/openbox/rulesets/refresh`, { method: 'POST' })).json()
    assert.equal(r.ok, true)
    assert.deepEqual(r.updated, ['geosite-cn', 'geoip-cn'])
    assert.equal(r.restarted, false)
    const st = await (await fetch(`${base}/api/openbox/rulesets/refresh/status`)).json()
    assert.equal(st.count, 2)
    assert.deepEqual(st.updated, ['geosite-cn', 'geoip-cn'])
    assert.ok(st.lastAt)
  } finally {
    await close()
  }
})

// Geo 上游:HEAD releases/latest 给 302 + tag;.srs 下载给字节。记下所有 GET 过的地址
// 规则集只有 MetaCubeX 一个来源:版本 = sing 分支最近一次提交(日期 + 短 sha),走 api.github.com;
// 文件走 raw.githubusercontent.com(镜像加前缀)
const META_VERSION = '2026-09-04 8d48edb4'
const geoFetch = (commit = { sha: '8d48edb493bc1234', date: '2026-09-04T00:16:34Z' }, urls = []) => async (url) => {
  if (url.startsWith('https://api.github.com/repos/MetaCubeX/meta-rules-dat/commits/sing')) {
    if (!commit) throw new Error('offline')
    return { ok: true, status: 200, json: async () => ({ sha: commit.sha, commit: { committer: { date: commit.date } } }) }
  }
  urls.push(url)
  return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
}

test('GET /rulesets/check:本地没记过版本 → 有新版;记过且相同 → 已是最新;只看配置用到的仓库', async () => {
  const config = { route: { rule_set: [{ type: 'local', tag: 'geosite-cn', path: `${paths.rulesetDir}/geosite-cn.srs` }] } }
  const ctx = createMockContext({ files: { [paths.configPath]: JSON.stringify(config) } })
  const { base, close } = await startApp(ctx, { getProfile: () => ({}) }, geoFetch())
  try {
    let r = await (await fetch(`${base}/api/openbox/rulesets/check`)).json()
    assert.equal(r.hasUpdate, true)
    assert.deepEqual(r.latest, { geosite: META_VERSION })
    assert.deepEqual(r.used, ['geosite'])
    await ctx.writeFile(paths.geoUpdateStatePath, JSON.stringify({ source: 'metacubex', versions: { geosite: META_VERSION } }))
    r = await (await fetch(`${base}/api/openbox/rulesets/check`)).json()
    assert.equal(r.hasUpdate, false)
    assert.deepEqual(r.current, { geosite: META_VERSION })
    const bad = await fetch(`${base}/api/openbox/rulesets/check?channel=x`)
    assert.equal(bad.status, 400)
  } finally {
    await close()
  }
})

test('POST /rulesets/refresh {channel:mirror}:只走镜像下载,并把上游 tag 记成当前版本', async () => {
  const config = { route: { rule_set: [
    { type: 'local', tag: 'geosite-cn', path: `${paths.rulesetDir}/geosite-cn.srs` },
    { type: 'local', tag: 'geoip-cn', path: `${paths.rulesetDir}/geoip-cn.srs` },
  ] } }
  const ctx = createMockContext({
    files: { [paths.configPath]: JSON.stringify(config), [paths.channelPath]: 'mirror\nhttps://gh-proxy.com/\n' },
    execResults: { '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } },
  })
  const urls = []
  const { base, close } = await startApp(ctx, { getProfile: () => ({}) }, geoFetch(undefined, urls))
  try {
    const r = await (await fetch(`${base}/api/openbox/rulesets/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'mirror' }) })).json()
    assert.equal(r.ok, true)
    assert.deepEqual(r.updated, ['geosite-cn', 'geoip-cn'])
    assert.deepEqual(r.versions, { geosite: META_VERSION, geoip: META_VERSION })
    // 安装时用的镜像排最前,且没有直连
    assert.ok(urls.every((u) => u.startsWith('https://gh-proxy.com/https://raw.githubusercontent.com/')), urls.join('\n'))
    const st = await (await fetch(`${base}/api/openbox/rulesets/refresh/status`)).json()
    assert.deepEqual(st.versions, { geosite: META_VERSION, geoip: META_VERSION })
    const check = await (await fetch(`${base}/api/openbox/rulesets/check`)).json()
    assert.equal(check.hasUpdate, false)
  } finally {
    await close()
  }
})

test('定时器:到点且未做过 → 先探上游,有新版才下并记录;同一天不重复;已是最新就不下', async () => {
  const config = { route: { rule_set: [{ type: 'local', tag: 'geosite-cn', path: `${paths.rulesetDir}/geosite-cn.srs` }] } }
  const ctx = createMockContext({
    files: { [paths.configPath]: JSON.stringify(config) },
    execResults: { '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } },
  })
  const urls = []
  const fetchImpl = geoFetch(undefined, urls)
  const store = { getProfile: () => ({ updates: { geo: { auto: true, hour: 4, days: 7, channel: 'direct' }, openbox: { auto: false } } }) }
  const now = new Date(2026, 8, 3, 4, 5)
  await runScheduledTasks({ store, ctx, paths, fetchImpl, now })
  await runScheduledTasks({ store, ctx, paths, fetchImpl, now })
  assert.equal(urls.length, 1)
  assert.ok(urls[0].startsWith('https://raw.githubusercontent.com/'))
  const state = JSON.parse(await ctx.readFile(paths.scheduleStatePath))
  assert.ok(state.geoLastAt)
  const geo = JSON.parse(await ctx.readFile(paths.geoUpdateStatePath))
  assert.deepEqual(geo.versions, { geosite: META_VERSION })
  // 8 天后再到点:上游没变 → 不下载,但 lastAt 前移
  const later = new Date(2026, 8, 11, 4, 5)
  await runScheduledTasks({ store, ctx, paths, fetchImpl, now: later })
  assert.equal(urls.length, 1)
  assert.equal(JSON.parse(await ctx.readFile(paths.scheduleStatePath)).geoLastAt, later.toISOString())
})

test('定时器:Open-Box 自身更新按「每隔几天」探,间隔内不重复探;到期探到已是最新也记 lastAt', async () => {
  const ctx = createMockContext({ files: { [paths.metaPath]: JSON.stringify({ version: 'v0.1.60' }), [paths.updateScript]: '' } })
  let probes = 0
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'HEAD') { probes++; return { status: 302, headers: new Map([['location', 'https://github.com/liandu2024/Open-Box/releases/tag/v0.1.60']]), url: '' } }
    throw new Error('unexpected')
  }
  const store = { getProfile: () => ({ updates: { geo: { auto: false }, openbox: { auto: true, hour: 4, days: 7, channel: 'auto' } } }) }
  await runScheduledTasks({ store, ctx, paths, fetchImpl, now: new Date(2026, 8, 3, 4, 5) })
  assert.equal(probes, 1)
  const state = JSON.parse(await ctx.readFile(paths.scheduleStatePath))
  assert.ok(state.openboxLastAt)
  // 第 3 天到点:未到 7 天间隔,不探
  await runScheduledTasks({ store, ctx, paths, fetchImpl, now: new Date(2026, 8, 6, 4, 5) })
  assert.equal(probes, 1)
  // 第 8 天到点:再探
  await runScheduledTasks({ store, ctx, paths, fetchImpl, now: new Date(2026, 8, 11, 4, 5) })
  assert.equal(probes, 2)
})

test('上次记的是以前官方来源的版本号(没有 source 字段)→ 不可比,当作有新版;刷新后记下来源与提交版本', async () => {
  const config = { route: { rule_set: [
    { type: 'local', tag: 'geosite-gfw', path: `${paths.rulesetDir}/geosite-gfw.srs` },
    { type: 'local', tag: 'geoip-cn', path: `${paths.rulesetDir}/geoip-cn.srs` },
  ] } }
  const ctx = createMockContext({ files: {
    [paths.configPath]: JSON.stringify(config),
    [paths.geoUpdateStatePath]: JSON.stringify({ versions: { geosite: '20260831141734', geoip: '20260812' } }),
  } })
  const urls = []
  const { base, close } = await startApp(ctx, { getProfile: () => ({}) }, geoFetch(undefined, urls))
  try {
    const check = await (await fetch(`${base}/api/openbox/rulesets/check`)).json()
    assert.equal(check.source, 'metacubex')
    assert.equal(check.hasUpdate, true)
    assert.deepEqual(check.current, {}, '官方来源记的版本不能拿来比')
    assert.deepEqual(check.latest, { geosite: META_VERSION, geoip: META_VERSION })

    const refresh = await (await fetch(`${base}/api/openbox/rulesets/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'direct' }) })).json()
    assert.equal(refresh.ok, true)
    assert.deepEqual(refresh.updated, ['geosite-gfw', 'geoip-cn'])
    assert.ok(urls.includes('https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/gfw.srs'))
    assert.ok(urls.includes('https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geoip/cn.srs'))
    const state = JSON.parse(ctx.files[paths.geoUpdateStatePath])
    assert.equal(state.source, 'metacubex')
    assert.deepEqual(state.versions, { geosite: META_VERSION, geoip: META_VERSION })
    assert.equal((ctx.files[`${paths.rulesetDir}/.source`] || '').trim(), 'metacubex')
    const again = await (await fetch(`${base}/api/openbox/rulesets/check`)).json()
    assert.equal(again.hasUpdate, false)
  } finally {
    await close()
  }
})

test('探不到上游提交(api.github.com 不通)→ 当作有新版,让用户能更一次', async () => {
  const config = { route: { rule_set: [{ type: 'local', tag: 'geosite-cn', path: `${paths.rulesetDir}/geosite-cn.srs` }] } }
  const ctx = createMockContext({ files: { [paths.configPath]: JSON.stringify(config) } })
  const { base, close } = await startApp(ctx, { getProfile: () => ({}) }, geoFetch(null))
  try {
    const r = await (await fetch(`${base}/api/openbox/rulesets/check`)).json()
    assert.equal(r.hasUpdate, true)
    assert.equal(r.via, 'unknown')
  } finally {
    await close()
  }
})

test('定时器:订阅到点自动重拉;同一天不重复、没到 N 天不拉;节点变了且内核在跑才重启一次', async () => {
  const m = new Map()
  const store = createStore({ get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), del: (k) => m.delete(k) })
  store.setProfile({ updates: { geo: { auto: false }, openbox: { auto: false } } })
  store.setSubscriptions([{ id: 's1', name: 'A', url: 'http://a', urls: ['http://a'], format: 'sharelink', nodeCount: 0, renameOptions: {}, autoUpdate: { enabled: true, days: 3, hour: 4 }, createdAt: 1, updatedAt: 1 }])
  store.setNodes([])
  const ctx = createMockContext({ execResults: { '/etc/init.d/openbox status': { code: 0, stdout: 'running' } } })
  let fetched = 0
  const subscriptionFetchImpl = async () => { fetched += 1; return { ok: true, status: 200, text: async () => 'ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388#HK-01' } }
  const deploys = []
  const runDeploy = async () => { deploys.push(1); return { ok: true, stage: 'running' } }
  const lookup = async () => [{ address: '8.8.8.8', family: 4 }]
  const base = { store, ctx, paths, fetchImpl: async () => { throw new Error('不该用系统 fetch 拉订阅') }, subscriptionFetchImpl, runDeploy, lookup }

  await runScheduledTasks({ ...base, now: new Date(2026, 8, 5, 3, 30) })
  assert.equal(fetched, 0, '没到点')
  await runScheduledTasks({ ...base, now: new Date(2026, 8, 5, 4, 2) })
  assert.equal(fetched, 1)
  assert.equal(store.getSubscriptions()[0].nodeCount, 1)
  assert.equal(deploys.length, 1, '节点从 0 变 1,重启一次')
  await runScheduledTasks({ ...base, now: new Date(2026, 8, 5, 4, 40) })
  assert.equal(fetched, 1, '同一天不重复')
  await runScheduledTasks({ ...base, now: new Date(2026, 8, 6, 4, 1) })
  assert.equal(fetched, 1, '每 3 天一次,第二天不拉')
  await runScheduledTasks({ ...base, now: new Date(2026, 8, 8, 4, 1) })
  assert.equal(fetched, 2, '第 3 天到点再拉')
  assert.equal(deploys.length, 1, '节点没变就不重启')
  const state = JSON.parse(await ctx.readFile(paths.scheduleStatePath))
  assert.ok(state.subscriptions.s1.lastAt)
})
