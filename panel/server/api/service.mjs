import express from 'express'
import { serviceStatus, startService, stopService, restartService, enableService, disableService } from '../system/service.mjs'
import { detectConflicts } from '../system/conflicts.mjs'

export const registerServiceRoutes = (app, { ctx, paths } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '1mb' }))

  // GET /api/openbox/service/status
  router.get('/service/status', async (_req, res) => {
    const core = await serviceStatus(ctx, paths.initd.core)
    const panel = await serviceStatus(ctx, paths.initd.panel)
    const { conflicts } = await detectConflicts(ctx)
    res.json({ core, panel, conflicts })
  })

  // POST /api/openbox/service/core/:action
  router.post('/service/core/:action', async (req, res) => {
    const { action } = req.params
    const validActions = ['start', 'stop', 'restart', 'enable', 'disable']

    if (!validActions.includes(action)) {
      return res.status(400).json({ message: `Invalid action: ${action}` })
    }

    let result
    if (action === 'start') {
      result = await startService(ctx, paths.initd.core)
    } else if (action === 'stop') {
      result = await stopService(ctx, paths.initd.core)
    } else if (action === 'restart') {
      result = await restartService(ctx, paths.initd.core)
    } else if (action === 'enable') {
      result = await enableService(ctx, paths.initd.core)
    } else if (action === 'disable') {
      result = await disableService(ctx, paths.initd.core)
    }

    res.json({ ok: result.ok, code: result.code, stderr: result.stderr })
  })

  // GET /api/openbox/kernel/version
  router.get('/kernel/version', async (_req, res) => {
    const { code, stdout, stderr } = await ctx.exec(paths.singbox, ['version'])
    const raw = `${stdout}${stderr}`
    // 退出码非 0 表示没读到版本(二进制缺失/无法执行),此时 version 为空,
    // ok:false 让调用方能区分「版本是空的」与「根本没读到」。
    const ok = code === 0
    const version = ok ? (stdout.split('\n')[0] || '').trim() : ''
    res.json({ version, raw, ok })
  })

  app.use('/api/openbox', router)
}
