import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerDeployRoutes } from './deploy.mjs'
import { createStore } from '../store/openbox-store.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'

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

// 内核 status 默认视为 running,方便"成功路径"测试;各测试按需通过 over 覆盖具体命令的结果。
const okCtx = (over = {}) => createMockContext({
  execResults: {
    '/etc/init.d/openbox status': { code: 0, stdout: 'running' },
    ...over,
  },
})

// 起一个绑定临时端口的最小 express app,注册待测路由,返回 baseUrl 供 fetch 打真实 HTTP 请求;
// close() 必须在 finally 里调用,防止测试遗留监听中的 server。
const startApp = async (ctx, storeOverride) => {
  const store = storeOverride || memStore()
  const app = express()
  registerDeployRoutes(app, { store, ctx, paths })
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

const BAD_NODE = {
  tag: 'HK-01',
  type: 'shadowsocks',
  server: 'a.example.com',
  server_port: 1,
  fields: { method: 'x', password: 'y' },
}

test('GET /api/openbox/config/preview 返回组装好的配置,不落盘', async () => {
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/config/preview`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.config)
    assert.ok(Array.isArray(body.config.outbounds))
    assert.ok(body.config.outbounds.some((o) => o.tag === 'PROXY'))
    assert.equal(ctx.writes.length, 0) // 仅返回,不落盘
    assert.equal(ctx.calls.length, 0) // 不触碰系统(不调 exec)
  } finally {
    await close()
  }
})

test('GET /api/openbox/config/preview 用 store 中现存节点组装分组', async () => {
  const store = memStore()
  store.setNodes([BAD_NODE])
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx, store)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/config/preview`)
    const body = await res.json()
    assert.ok(body.config.outbounds.some((o) => o.tag === 'HK-01'))
    assert.ok(body.config.outbounds.some((o) => o.tag === 'HK' && o.type === 'urltest'))
  } finally {
    await close()
  }
})

test('POST /api/openbox/deploy 成功路径 → 200,持久化部署态,内核开机自启(enable)', async () => {
  const ctx = okCtx()
  const { baseUrl, store, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/deploy`, { method: 'POST' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.stage, 'running')
    assert.deepEqual(body.badTags, [])

    assert.equal(store.getDeployState().stage, 'running') // 结果已落库

    assert.ok(cmds(ctx).includes('/etc/init.d/openbox enable')) // P3 遗留项:开机自启
  } finally {
    await close()
  }
})

test('POST /api/openbox/deploy 冲突路径 → 409,未写任何文件,不 enable/disable', async () => {
  const ctx = createMockContext({
    files: { '/etc/init.d/openclash': '#!' },
    execResults: { '/etc/init.d/openclash status': { code: 0, stdout: 'running' } },
  })
  const { baseUrl, store, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/deploy`, { method: 'POST' })
    assert.equal(res.status, 409)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.stage, 'conflict')
    assert.match(body.message, /OpenClash/)

    assert.equal(ctx.writes.length, 0) // 未写任何配置
    assert.equal(store.getDeployState().stage, 'conflict')
    assert.ok(!cmds(ctx).some((c) => c.includes('enable') || c.includes('disable')))
  } finally {
    await close()
  }
})

test('POST /api/openbox/deploy 校验失败 → 409,给 badTags,不写正式配置、不重启', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1, stderr: 'FATAL: unknown method: x' } })
  const store = memStore()
  store.setNodes([BAD_NODE])
  const { baseUrl, close } = await startApp(ctx, store)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/deploy`, { method: 'POST' })
    assert.equal(res.status, 409)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.stage, 'validate')
    assert.deepEqual(body.badTags, ['HK-01'])

    assert.ok(!ctx.writes.some((w) => w.path === paths.configPath)) // 未写正式配置
    assert.ok(!cmds(ctx).some((c) => c.includes('/etc/init.d/openbox restart')))
    assert.ok(!cmds(ctx).some((c) => c.includes('enable') || c.includes('disable')))
    assert.equal(store.getDeployState().stage, 'validate')
  } finally {
    await close()
  }
})

test('POST /api/openbox/deploy 重启失败 → 500,回滚命令出现,disable 内核开机自启', async () => {
  const ctx = createMockContext({
    execResults: {
      '/etc/init.d/openbox restart': { code: 1, stderr: 'start failed' },
    },
  })
  const { baseUrl, store, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/deploy`, { method: 'POST' })
    assert.equal(res.status, 500)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.stage, 'start')

    const c = cmds(ctx)
    assert.ok(c.includes('/etc/init.d/openbox stop')) // 回滚:停服务
    assert.ok(c.includes('uci -q delete firewall.openbox_panel')) // 回滚:撤防火墙规则
    assert.ok(c.includes('/etc/init.d/openbox disable')) // P3 遗留项:回滚后关闭开机自启

    assert.equal(store.getDeployState().stage, 'start')
  } finally {
    await close()
  }
})

test('POST /api/openbox/deploy 启动后未 running(verify 阶段)→ 500,同样 disable', async () => {
  const ctx = createMockContext({
    execResults: { '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } },
  })
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/deploy`, { method: 'POST' })
    assert.equal(res.status, 500)
    const body = await res.json()
    assert.equal(body.stage, 'verify')
    assert.ok(cmds(ctx).includes('/etc/init.d/openbox disable'))
  } finally {
    await close()
  }
})

test('POST /api/openbox/deploy 落盘前步骤(mkdirp)抛出异常 → 500 JSON(不是默认 HTML 错误页),部署态标记 error', async () => {
  const ctx = okCtx()
  // mkdirp 在 deployConfig 里排在"冲突检测"之后、"落盘"之前——这一段目前没有被
  // deployConfig 内部的 try/catch 覆盖(那段只包住落盘之后的步骤),异常会直接冒泡。
  ctx.mkdirp = async () => {
    throw new Error('mkdirp failed: disk full')
  }
  const { baseUrl, store, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/deploy`, { method: 'POST' })
    assert.equal(res.status, 500)
    assert.match(res.headers.get('content-type') || '', /application\/json/)

    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.stage, 'error')
    assert.match(body.message, /mkdirp failed: disk full/)

    assert.equal(store.getDeployState().stage, 'error') // setDeployState 确实执行了,不是停留在旧状态

    const stateRes = await fetch(`${baseUrl}/api/openbox/deploy/state`)
    const stateBody = await stateRes.json()
    assert.equal(stateBody.state.stage, 'error')
  } finally {
    await close()
  }
})

test('GET /api/openbox/deploy/state 返回最近一次部署结果', async () => {
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx)
  try {
    const before = await (await fetch(`${baseUrl}/api/openbox/deploy/state`)).json()
    assert.equal(before.state.stage, 'idle') // 默认态

    await fetch(`${baseUrl}/api/openbox/deploy`, { method: 'POST' })

    const after = await (await fetch(`${baseUrl}/api/openbox/deploy/state`)).json()
    assert.equal(after.state.stage, 'running')
  } finally {
    await close()
  }
})

test('POST /api/openbox/rollback → 恢复直连并 disable 内核开机自启', async () => {
  const ctx = createMockContext({ defaultExec: { code: 0 } })
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/rollback`, { method: 'POST' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(body.actions.includes('stop-core'))
    assert.ok(body.actions.includes('restore-dns'))
    assert.ok(body.actions.includes('remove-firewall'))

    assert.ok(cmds(ctx).includes('/etc/init.d/openbox disable'))
  } finally {
    await close()
  }
})

test('POST /api/openbox/rollback 即使命令全失败也不抛(尽力而为),仍返回 ok:true', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1 } })
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/rollback`, { method: 'POST' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
  } finally {
    await close()
  }
})
