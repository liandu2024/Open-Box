import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { startService, stopService, restartService, enableService, disableService, serviceStatus } from './service.mjs'

test('createPaths 默认根与派生路径', () => {
  const p = createPaths()
  assert.equal(p.root, '/opt/open-box')
  assert.equal(p.singbox, '/opt/open-box/bin/sing-box')
  assert.equal(p.configPath, '/opt/open-box/etc/config.json')
  assert.equal(p.rulesetDir, '/opt/open-box/data/rulesets')
  assert.equal(p.initd.core, '/etc/init.d/openbox')
  assert.equal(p.initd.panel, '/etc/init.d/openbox-panel')
})

test('createPaths 可注入根(测试用)', () => {
  const p = createPaths('/tmp/ob')
  assert.equal(p.configPath, '/tmp/ob/etc/config.json')
})

test('服务动作发出正确命令', async () => {
  const ctx = createMockContext()
  const p = createPaths()
  await startService(ctx, p.initd.core)
  await stopService(ctx, p.initd.core)
  await restartService(ctx, p.initd.core)
  await enableService(ctx, p.initd.panel)
  await disableService(ctx, p.initd.panel)
  assert.deepEqual(ctx.calls, [
    { cmd: '/etc/init.d/openbox', args: ['start'] },
    { cmd: '/etc/init.d/openbox', args: ['stop'] },
    { cmd: '/etc/init.d/openbox', args: ['restart'] },
    { cmd: '/etc/init.d/openbox-panel', args: ['enable'] },
    { cmd: '/etc/init.d/openbox-panel', args: ['disable'] },
  ])
})

test('失败返回 ok:false 与 stderr', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1, stderr: 'no such service' } })
  const r = await startService(ctx, '/etc/init.d/openbox')
  assert.equal(r.ok, false)
  assert.equal(r.stderr, 'no such service')
})

test('serviceStatus 判定 running', async () => {
  const yes = createMockContext({ execResults: { '/etc/init.d/openbox status': { code: 0, stdout: 'running' } } })
  assert.equal((await serviceStatus(yes, '/etc/init.d/openbox')).running, true)
  const no = createMockContext({ execResults: { '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } } })
  assert.equal((await serviceStatus(no, '/etc/init.d/openbox')).running, false)
})

test('procd "active with no instances"(已注册但零进程)不算 running', async () => {
  const ctx = createMockContext({ execResults: { '/etc/init.d/openbox status': { code: 0, stdout: 'active with no instances' } } })
  const r = await serviceStatus(ctx, '/etc/init.d/openbox')
  assert.equal(r.running, false)
})
