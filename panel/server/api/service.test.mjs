import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerServiceRoutes } from './service.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'

const paths = createPaths('/opt/open-box')
const cmds = (ctx) => ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))

// 内核 status 默认视为 running;panel 默认 inactive;detectConflicts 返回空列表
const okCtx = (over = {}) => createMockContext({
  execResults: {
    '/etc/init.d/openbox status': { code: 0, stdout: 'running' },
    '/etc/init.d/openbox-panel status': { code: 1, stdout: 'inactive' },
    ...over,
  },
})

const startApp = async (ctx) => {
  const app = express()
  registerServiceRoutes(app, { ctx, paths })
  const server = app.listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const { port } = server.address()
  return {
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
    assert.ok(cmds(ctx).includes('/etc/init.d/openbox start'))
  } finally {
    await close()
  }
})

test('POST /api/openbox/service/core/stop → {ok,code,stderr}', async () => {
  const ctx = okCtx()
  const { baseUrl, close } = await startApp(ctx)
  try {
    const res = await fetch(`${baseUrl}/api/openbox/service/core/stop`, { method: 'POST' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(cmds(ctx).includes('/etc/init.d/openbox stop'))
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
    assert.ok(body.version !== undefined)
    assert.ok(body.raw !== undefined)
  } finally {
    await close()
  }
})
