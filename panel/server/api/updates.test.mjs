import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerUpdateRoutes } from './updates.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'
import { compareVersions, fetchLatestVersion, parseKeyValues } from '../system/updater.mjs'
import { runScheduledTasks } from '../system/scheduler.mjs'

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
  const { base, close } = await startApp(ctx, { getProfile: () => ({}) })
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

test('定时器:到点且未做过 → 刷新规则集并记录;同一天不重复', async () => {
  const config = { route: { rule_set: [{ type: 'local', tag: 'geosite-cn', path: `${paths.rulesetDir}/geosite-cn.srs` }] } }
  const ctx = createMockContext({
    files: { [paths.configPath]: JSON.stringify(config) },
    execResults: { '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } },
  })
  let downloads = 0
  const fetchImpl = async () => { downloads++; return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1]).buffer } }
  const store = { getProfile: () => ({ updates: { geo: { auto: true, hour: 4, days: 7 }, openbox: { auto: false } } }) }
  const now = new Date(2026, 8, 3, 4, 5)
  await runScheduledTasks({ store, ctx, paths, fetchImpl, now })
  await runScheduledTasks({ store, ctx, paths, fetchImpl, now })
  assert.equal(downloads, 1)
  const state = JSON.parse(await ctx.readFile(paths.scheduleStatePath))
  assert.ok(state.geoLastAt)
})
