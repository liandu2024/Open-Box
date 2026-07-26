import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { detectConflicts, CONFLICT_SERVICES } from './conflicts.mjs'

test('清单覆盖六个已知插件', () => {
  assert.deepEqual(CONFLICT_SERVICES.map((s) => s.id).sort(),
    ['homeproxy', 'nikki', 'openclash', 'passwall', 'passwall2', 'shadowsocksr'])
  for (const s of CONFLICT_SERVICES) assert.ok(s.initd.startsWith('/etc/init.d/'))
})

test('未安装 → 无冲突', async () => {
  const ctx = createMockContext()
  const r = await detectConflicts(ctx)
  assert.equal(r.hasRunning, false)
  assert.deepEqual(r.conflicts, [])
})

test('装了但没运行 → 不算冲突', async () => {
  const ctx = createMockContext({
    files: { '/etc/init.d/openclash': '#!/bin/sh' },
    execResults: { '/etc/init.d/openclash status': { code: 1, stdout: 'inactive' } },
  })
  const r = await detectConflicts(ctx)
  assert.equal(r.hasRunning, false)
})

test('运行中 → 报冲突并带 label', async () => {
  const ctx = createMockContext({
    files: { '/etc/init.d/openclash': '#!/bin/sh', '/etc/init.d/nikki': '#!/bin/sh' },
    execResults: {
      '/etc/init.d/openclash status': { code: 0, stdout: 'running' },
      '/etc/init.d/nikki status': { code: 1, stdout: '' },
    },
  })
  const r = await detectConflicts(ctx)
  assert.equal(r.hasRunning, true)
  assert.deepEqual(r.conflicts.map((c) => c.id), ['openclash'])
  assert.equal(r.conflicts[0].label, 'OpenClash')
})
