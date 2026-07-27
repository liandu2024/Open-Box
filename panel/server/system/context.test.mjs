import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'

test('mock exec 返回编排结果并记录调用', async () => {
  const ctx = createMockContext({ execResults: { '/etc/init.d/openbox status': { code: 0, stdout: 'running' } } })
  const r = await ctx.exec('/etc/init.d/openbox', ['status'])
  assert.equal(r.code, 0)
  assert.equal(r.stdout, 'running')
  assert.deepEqual(ctx.calls, [{ cmd: '/etc/init.d/openbox', args: ['status'] }])
})

test('mock exec 未编排时用 defaultExec', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1, stdout: '', stderr: 'boom' } })
  const r = await ctx.exec('anything', [])
  assert.equal(r.code, 1)
  assert.equal(r.stderr, 'boom')
})

test('mock fs 读写与存在性', async () => {
  const ctx = createMockContext({ files: { '/etc/config/dhcp': 'orig' } })
  assert.equal(await ctx.readFile('/etc/config/dhcp'), 'orig')
  assert.equal(await ctx.exists('/etc/config/dhcp'), true)
  assert.equal(await ctx.exists('/nope'), false)
  await ctx.writeFile('/tmp/x.json', '{}')
  assert.equal(ctx.files['/tmp/x.json'], '{}')
  assert.deepEqual(ctx.writes, [{ path: '/tmp/x.json', content: '{}' }])
  await ctx.remove('/tmp/x.json')
  assert.equal(await ctx.exists('/tmp/x.json'), false)
})

test('mock readFile 缺失抛 ENOENT', async () => {
  const ctx = createMockContext()
  await assert.rejects(() => ctx.readFile('/missing'), /ENOENT/)
})
