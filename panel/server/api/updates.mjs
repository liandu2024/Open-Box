import express from 'express'
import { runDeploy } from './deploy-runner.mjs'
import { serviceStatus } from '../system/service.mjs'
import {
  cancelUpdate, checkGeoUpdate, compareVersions, fetchLatestVersion, readChannel, readJsonFile, readMeta, readUpdateLogTail,
  readUpdateStatus, refreshRulesets, startUpdate, writeJsonFile,
} from '../system/updater.mjs'

const CHANNELS = new Set(['auto', 'direct', 'mirror'])

// 发起升级前探一下最新 tag(直连不通就走镜像,见 fetchLatestVersion);探不到就空着,
// 脚本会自己再试一次直连,再不行退回稳定资产名
const makeLatestTagOrEmpty = (fetchImpl) => async () => {
  try {
    return (await fetchLatestVersion(fetchImpl)).latest
  } catch {
    return ''
  }
}

export const registerUpdateRoutes = (app, { store, ctx, paths, fetchImpl = globalThis.fetch } = {}) => {
  const router = express.Router({ caseSensitive: true })
  const latestTagOrEmpty = makeLatestTagOrEmpty(fetchImpl)
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
    const r = await startUpdate(ctx, paths, channel, { expect: await latestTagOrEmpty() })
    if (!r.ok) return res.status(503).json({ message: r.output || `update.sh exit ${r.code}` })
    res.json({ ok: true, output: r.output })
  })

  router.post('/update/cancel', async (_req, res) => {
    res.json(await cancelUpdate(ctx, paths))
  })

  // GET /api/openbox/rulesets/check?channel= —— 探 Geo 规则集上游有没有新版
  router.get('/rulesets/check', async (req, res) => {
    const channel = String(req.query.channel || 'auto')
    if (!CHANNELS.has(channel)) return res.status(400).json({ message: `channel must be one of ${[...CHANNELS].join(', ')}` })
    try {
      res.json(await checkGeoUpdate(ctx, paths, { fetchImpl }))
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : String(error) })
    }
  })

  // Geo 规则集:立即刷新 {channel}(刷完若内核在跑就重启让它生效)
  router.post('/rulesets/refresh', async (req, res) => {
    const channel = String((req.body || {}).channel || 'auto')
    if (!CHANNELS.has(channel)) return res.status(400).json({ message: `channel must be one of ${[...CHANNELS].join(', ')}` })
    try {
      const previous = await readJsonFile(ctx, paths.geoUpdateStatePath, {})
      const result = await refreshRulesets(ctx, paths, { fetchImpl, channel })
      let restarted = false
      let restartMessage = ''
      if (result.updated.length && (await serviceStatus(ctx, paths.initd.core)).running) {
        const deployed = await runDeploy({ store, ctx, paths })
        restarted = deployed.ok
        if (!deployed.ok) restartMessage = deployed.message || `deploy failed at stage: ${deployed.stage}`
      }
      // 没下到新文件(全失败 / 没配置)就沿用上次记的版本
      const versions = result.updated.length ? { ...(previous.versions || {}), ...result.versions } : previous.versions || {}
      // source 记的是规则集来源(sagernet / metacubex),换来源后旧版本号不再可比;trigger 才是"谁发起的"
      const record = { lastAt: new Date().toISOString(), updated: result.updated, failed: result.failed, restarted, trigger: 'manual', channel, versions, source: result.source }
      await writeJsonFile(ctx, paths.geoUpdateStatePath, record)
      // 一个规则集都没有(新装机内核还没成功部署过、或第一次启动被回滚成了无规则的直连配置):说清楚,别报"已更新 0 个"(GitHub #20)
      const nothing = !result.updated.length && !result.failed.length
      const message = result.message || (nothing ? '当前配置里没有 Geo 规则集:内核还没成功部署过。先启动一次内核,规则集会随第一次成功启动自动下载' : '')
      res.json({ ok: result.failed.length === 0 && !restartMessage, ...result, ...(message ? { message } : {}), nothing, versions, restarted, restartMessage })
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
    res.json({
      count, lastAt: state.lastAt || '', updated: state.updated || [], failed: state.failed || [], restarted: Boolean(state.restarted),
      versions: state.versions || {}, source: state.source || '',
    })
  })

  app.use('/api/openbox', router)
}
