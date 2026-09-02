import express from 'express'
import { runDeploy } from './deploy-runner.mjs'
import { serviceStatus } from '../system/service.mjs'
import {
  cancelUpdate, compareVersions, fetchLatestVersion, readChannel, readJsonFile, readMeta, readUpdateLogTail,
  readUpdateStatus, refreshRulesets, startUpdate, writeJsonFile,
} from '../system/updater.mjs'

const CHANNELS = new Set(['auto', 'direct', 'mirror'])

export const registerUpdateRoutes = (app, { store, ctx, paths, fetchImpl = globalThis.fetch } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '64kb' }))

  // GET /api/openbox/update/status —— 本地信息,不出网
  router.get('/update/status', async (_req, res) => {
    const [meta, channel, status, logTail] = await Promise.all([
      readMeta(ctx, paths), readChannel(ctx, paths), readUpdateStatus(ctx, paths), readUpdateLogTail(ctx, paths),
    ])
    res.json({ version: meta.version || '', singboxVersion: meta.singboxVersion || '', builtAt: meta.builtAt || '', channel, status, logTail })
  })

  // GET /api/openbox/update/check —— 探最新版
  router.get('/update/check', async (_req, res) => {
    try {
      const meta = await readMeta(ctx, paths)
      const { latest, via } = await fetchLatestVersion(fetchImpl)
      res.json({ current: meta.version || '', latest, via, hasUpdate: compareVersions(latest, meta.version) > 0 })
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : String(error) })
    }
  })

  // POST /api/openbox/update/run {channel}
  router.post('/update/run', async (req, res) => {
    const channel = String((req.body || {}).channel || 'auto')
    if (!CHANNELS.has(channel)) return res.status(400).json({ message: `channel must be one of ${[...CHANNELS].join(', ')}` })
    const status = await readUpdateStatus(ctx, paths)
    if (status.running) return res.status(409).json({ message: '已有一次更新在进行中' })
    if (!(await ctx.exists(paths.updateScript))) return res.status(503).json({ message: `找不到升级脚本:${paths.updateScript}` })
    const r = await startUpdate(ctx, paths, channel)
    if (!r.ok) return res.status(503).json({ message: r.output || `update.sh exit ${r.code}` })
    res.json({ ok: true, output: r.output })
  })

  router.post('/update/cancel', async (_req, res) => {
    res.json(await cancelUpdate(ctx, paths))
  })

  // Geo 规则集:立即刷新(刷完若内核在跑就重启让它生效)
  router.post('/rulesets/refresh', async (_req, res) => {
    try {
      const result = await refreshRulesets(ctx, paths, { fetchImpl })
      let restarted = false
      let restartMessage = ''
      if (result.updated.length && (await serviceStatus(ctx, paths.initd.core)).running) {
        const deployed = await runDeploy({ store, ctx, paths })
        restarted = deployed.ok
        if (!deployed.ok) restartMessage = deployed.message || `deploy failed at stage: ${deployed.stage}`
      }
      const record = { lastAt: new Date().toISOString(), updated: result.updated, failed: result.failed, restarted, source: 'manual' }
      await writeJsonFile(ctx, paths.geoUpdateStatePath, record)
      res.json({ ok: result.failed.length === 0 && !restartMessage, ...result, restarted, restartMessage })
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : String(error) })
    }
  })

  router.get('/rulesets/refresh/status', async (_req, res) => {
    const state = await readJsonFile(ctx, paths.geoUpdateStatePath, {})
    let count = 0
    try {
      const config = JSON.parse(await ctx.readFile(paths.configPath))
      count = ((config.route && config.route.rule_set) || []).filter((e) => e && e.type === 'local').length
    } catch { /* 没生成过配置 */ }
    res.json({ count, lastAt: state.lastAt || '', updated: state.updated || [], failed: state.failed || [], restarted: Boolean(state.restarted) })
  })

  app.use('/api/openbox', router)
}
