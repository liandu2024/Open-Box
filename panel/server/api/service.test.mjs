import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerServiceRoutes } from './service.mjs'
import { createStore } from '../store/openbox-store.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'
import { TUN_DEVICE } from '../system/deploy.mjs'

const memStore = () => {
  const m = new Map()
  return createStore({
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => m.set(k, v),
    del: (k) => m.delete(k),
  })
}

const paths = createPaths('/opt/open-box')
const cmds = (ctx) => ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))

// 内核 status 默认视为 running;panel 默认 inactive;detectConflicts 返回空列表
// 启动/重启会走完整条部署流水线,所以这里的 mock 要备齐它依赖的东西:
// sing-box 二进制存在(重启前的预检),status 视为 running(启动后的验证)。
const okCtx = (over = {}) => createMockContext({
  files: { [paths.singbox]: '#!/bin/sh\n', [TUN_DEVICE]: '' },
  execResults: {
    '/etc/init.d/openbox status': { code: 0, stdout: 'running' },
    '/etc/init.d/openbox-panel status': { code: 1, stdout: 'inactive' },
    ...over,
  },
})

const startApp = async (ctx, storeOverride, opts = {}) => {
  const store = storeOverride || memStore()
  const app = express()
  registerServiceRoutes(app, { store, ctx, paths, ...opts })
  const server = app.listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const { port } = server.address()
  return {
    store,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test('GET /api/openbox/service/status → {core:{running,raw}, panel:{running,raw}, conflicts:[]}', async () => {
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/service/status`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.core)
    assert.equal(body.core.running, true)
    assert.ok(body.core.raw)
    assert.ok(body.panel)
    assert.equal(body.panel.running, false)
    assert.ok(body.panel.raw)
    assert.ok(Array.isArray(body.conflicts))
    assert.equal(body.conflicts.length, 0)
    // mock 里没配 enabled 的返回,默认退出码 0 → 视为已开启自启
    assert.equal(body.core.autostart, true)
  } finally {
    await close()
  }
})

test('POST /api/openbox/service/core/start → {ok,code,stderr}', async () => {
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/service/core/start`, { method: 'POST' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(typeof body.code === 'number')
    assert.ok(typeof body.stderr === 'string')
    assert.ok(cmds(ctx).includes('/etc/init.d/openbox restart'))
  } finally {
    await close()
  }
})

// 界面上没有单独的「部署」按钮了:设置页只管保存,启动内核时才生成并应用配置。
// 若启动只是喊一声 init 脚本,起来的还是上一次落盘的旧配置——这条守住那件事。
test('启动内核 = 用当前设置重新生成配置并落盘', async () => {
  const ctx = okCtx()
  const { baseUrl, store, close } = await startApp(ctx)
  try {
    await fetch(`${baseUrl}/api/openbox/service/core/start`, { method: 'POST' })
    const written = ctx.writes.find((w) => w.path === paths.configPath)
    assert.ok(written, '应当写入 config.json')
    const config = JSON.parse(written.content)
    assert.ok(config.outbounds.some((o) => o.tag === '其他' && o.type === 'selector'))
    // 结果落进部署态,内核页那张卡片显示的就是它
    assert.equal(store.getDeployState().stage, 'running')
  } finally {
    await close()
  }
})

test('应用失败时启动不谎报成功,原因原样带出去', async () => {
  // 别的代理插件在跑 → 停在 conflict 阶段,内核根本不会被动到
  const ctx = createMockContext({
    files: { '/etc/init.d/openclash': '#!' },
    execResults: { '/etc/init.d/openclash status': { code: 0, stdout: 'running' } },
  })
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/service/core/start`, { method: 'POST' })
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.match(body.stderr, /OpenClash/)
    assert.equal(ctx.writes.length, 0)
    assert.ok(!cmds(ctx).includes('/etc/init.d/openbox restart'))
  } finally {
    await close()
  }
})

test('POST /api/openbox/service/core/stop → {ok,code,stderr}', async () => {
  const ctx = okCtx({ '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } })
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/service/core/stop`, { method: 'POST' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(cmds(ctx).includes('/etc/init.d/openbox stop'))
    // 停止必须同时关掉开机自启,否则坏配置把网搞断时「停止」扛不过一次重启。
    assert.ok(cmds(ctx).includes('/etc/init.d/openbox disable'))
  } finally {
    await close()
  }
})

test('停止失败时不应关闭自启(内核还在跑,关自启只会让状态更乱)', async () => {
  const ctx = okCtx({ '/etc/init.d/openbox stop': { code: 1, stdout: '', stderr: 'boom' } })
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/service/core/stop`, { method: 'POST' })
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.ok(!cmds(ctx).includes('/etc/init.d/openbox disable'))
  } finally {
    await close()
  }
})

test('停止成功但关自启失败时,如实把原因带回来', async () => {
  const ctx = okCtx({ '/etc/init.d/openbox disable': { code: 1, stdout: '', stderr: 'no rc.d' }, '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } })
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/service/core/stop`, { method: 'POST' })
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.match(body.stderr, /disable autostart failed/)
  } finally {
    await close()
  }
})

test('重启不得关闭自启(init 的 restart 内部就是 stop+start,不能顺手把自启关了)', async () => {
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx)
  try {
    await fetch(`${baseUrl}/api/openbox/service/core/restart`, { method: 'POST' })
    assert.ok(!cmds(ctx).includes('/etc/init.d/openbox disable'))
  } finally {
    await close()
  }
})

test('POST /api/openbox/service/core/restart → {ok,code,stderr}', async () => {
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/service/core/restart`, { method: 'POST' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(cmds(ctx).includes('/etc/init.d/openbox restart'))
  } finally {
    await close()
  }
})

test('POST /api/openbox/service/core/enable → {ok,code,stderr}', async () => {
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/service/core/enable`, { method: 'POST' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(cmds(ctx).includes('/etc/init.d/openbox enable'))
  } finally {
    await close()
  }
})

test('POST /api/openbox/service/core/disable → {ok,code,stderr}', async () => {
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/service/core/disable`, { method: 'POST' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(cmds(ctx).includes('/etc/init.d/openbox disable'))
  } finally {
    await close()
  }
})

test('POST /api/openbox/service/core/invalid → 400 WITHOUT executing anything', async () => {
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/service/core/invalid`, { method: 'POST' })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.message)
    // Critical: no exec should have been called for invalid action
    assert.equal(ctx.calls.length, 0)
  } finally {
    await close()
  }
})

test('GET /api/openbox/kernel/version → exec paths.singbox version, parse first line', async () => {
  const ctx = okCtx({
    [`${paths.singbox} version`]: { code: 0, stdout: 'sing-box 1.9.4\nBuild version: abc123', stderr: '' },
  })
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/kernel/version`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.version, 'sing-box 1.9.4')
    assert.equal(body.ok, true)
    assert.ok(body.raw)
    assert.ok(cmds(ctx).includes(`${paths.singbox} version`))
  } finally {
    await close()
  }
})

test('GET /api/openbox/kernel/version handles missing singbox gracefully', async () => {
  const ctx = okCtx({
    [`${paths.singbox} version`]: { code: 1, stdout: '', stderr: 'command not found' },
  })
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/kernel/version`)
    assert.equal(res.status, 200)
    const body = await res.json()
    // 读不到版本时必须明确说读不到,而不是给一个看起来正常的空版本
    assert.equal(body.ok, false)
    assert.equal(body.version, '')
    assert.match(body.raw, /command not found/)
  } finally {
    await close()
  }
})

test('GET /service/status:init 脚本 enabled 退出码非 0 → core.autostart=false', async () => {
  const ctx = okCtx({ '/etc/init.d/openbox enabled': { code: 1 } })
  const { baseUrl, close } = await startApp(ctx)
  try {
    const body = await (await fetch(`${baseUrl}/api/openbox/service/status`)).json()
    assert.equal(body.core.autostart, false)
    assert.equal(body.core.running, true)
  } finally {
    await close()
  }
})

test('GET /service/status:内核在跑时带 uptimeSeconds(pidof + /proc/<pid>/stat + /proc/uptime)', async () => {
  const ctx = okCtx({ 'pidof sing-box': { code: 0, stdout: '4321\n' } })
  // starttime = 100000 滴答 = 1000s;系统开机 4600s → 运行 3600s
  ctx.files['/proc/4321/stat'] = '4321 (sing-box) S 1 4321 4321 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 9 0 100000 1296640 15000 18446744073709551615 1 1 0 0 0 0 0 0 0 0 0 0 17 1 0 0 0 0 0 0 0 0 0 0 0 0 0'
  ctx.files['/proc/uptime'] = '4600.12 9000.00\n'
  const { baseUrl, close } = await startApp(ctx)
  try {
    const body = await (await fetch(`${baseUrl}/api/openbox/service/status`)).json()
    assert.equal(body.core.uptimeSeconds, 3600)
  } finally {
    await close()
  }
})

test('GET /service/status:pidof 失败时 uptimeSeconds 为 null,接口不报错', async () => {
  const ctx = okCtx({ 'pidof sing-box': { code: 1, stdout: '' } })
  const { baseUrl, close } = await startApp(ctx)
  try {
    const body = await (await fetch(`${baseUrl}/api/openbox/service/status`)).json()
    assert.equal(body.core.running, true)
    assert.equal(body.core.uptimeSeconds, null)
  } finally {
    await close()
  }
})

test('停止后内核迟迟不退出 → ok:false 并说明,不再谎报已停止', async () => {
  // status 一直 running(okCtx 默认),等待窗口给 300ms 让用例跑得快
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx, undefined, { stopWaitMs: 300 })
  try {
    const res = await fetch(`${baseUrl}/api/openbox/service/core/stop`, { method: 'POST' })
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.match(body.stderr, /没有退出/)
    assert.ok(!cmds(ctx).includes('/etc/init.d/openbox disable'))
    assert.ok(cmds(ctx).filter((c) => c === '/etc/init.d/openbox status').length >= 2, '应该轮询过 status')
  } finally {
    await close()
  }
})

// 审查第 2 项:部署跑到一半(内核已起、正在验证)时点了停止——停止要排在部署后面执行,部署要
// 认出自己被取消(不报成功、不开自启),最终状态是停止的、自启关着,和用户最后一个动作一致
test('部署途中点停止:部署被标成取消(不 enable),停止随后执行并 disable,最终状态跟最后一个动作走', async () => {
  let releaseVerify
  const verifyGate = new Promise((r) => { releaseVerify = r })
  let stopped = false
  const ctx = okCtx({
    '/etc/init.d/openbox status': () => (stopped ? { code: 1, stdout: 'inactive' } : { code: 0, stdout: 'running' }),
    '/etc/init.d/openbox stop': () => { stopped = true; return { code: 0 } },
  })
  // deployConfig 验证阶段会 sleep 几秒再看第二眼:借这个 sleep 把部署挂住
  ctx.sleep = () => verifyGate
  const { baseUrl, close } = await startApp(ctx)
  try {
    const starting = fetch(`${baseUrl}/api/openbox/service/core/start`, { method: 'POST' })
    // 等部署走到重启内核之后(挂在验证的 sleep 里)
    for (let i = 0; i < 200 && !cmds(ctx).includes('/etc/init.d/openbox restart'); i++) await new Promise((r) => setTimeout(r, 5))
    assert.ok(cmds(ctx).includes('/etc/init.d/openbox restart'))
    const stopping = fetch(`${baseUrl}/api/openbox/service/core/stop`, { method: 'POST' })
    await new Promise((r) => setTimeout(r, 20))
    // 停止在排队,还没执行
    assert.ok(!cmds(ctx).includes('/etc/init.d/openbox stop'))
    releaseVerify()
    const startBody = await (await starting).json()
    const stopBody = await (await stopping).json()
    assert.equal(startBody.ok, false)
    assert.match(startBody.stderr, /取消/)
    assert.equal(stopBody.ok, true)
    const c = cmds(ctx)
    assert.ok(c.indexOf('/etc/init.d/openbox restart') < c.indexOf('/etc/init.d/openbox stop'), '停止必须排在部署之后执行')
    assert.ok(!c.includes('/etc/init.d/openbox enable'), '被取消的部署不能把自启打开')
    assert.ok(c.includes('/etc/init.d/openbox disable'))
  } finally {
    await close()
  }
})
