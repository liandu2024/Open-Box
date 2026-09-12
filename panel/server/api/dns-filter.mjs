import express from 'express'
import { filterKey, filterSettings, validateDnsFilter } from '../engine/dns-filter.mjs'
import { cleanupDnsFilterCache, readFilterListState } from '../system/dns-filter.mjs'
import { runDeploy, runExclusive } from './deploy-runner.mjs'
import { createDnsFilterPreview } from '../system/dns-filter-preview.mjs'

export const registerDnsFilterRoutes = (app, { store, ctx, paths, data, observer, deploy = runDeploy, previewFetch }) => {
  const router = express.Router()
  const preview = createDnsFilterPreview({ store, ctx, fetchImpl: previewFetch })
  router.use(express.json({ limit: '128kb' }))
  let busy = false
  const status = async () => {
    let applied = null
    try { applied = JSON.parse(await ctx.readFile(`${paths.etc}/config.meta.json`)).dnsFilter || null } catch { /* not deployed */ }
    const settings = filterSettings(store.getProfile())
    return { settings, lists: readFilterListState(store), applied, pending: applied ? applied.key !== filterKey(settings) : settings.enabled, busy, ...observer.status() }
  }
  router.get('/', async (_req, res) => res.json(await status()))
  router.put('/', (req, res) => {
    if (busy) return res.status(409).json({ error: '名单正在更新,请稍后保存' })
    const settings = req.body
    const error = validateDnsFilter(settings)
    if (error) return res.status(400).json({ error })
    store.setProfile({ dns: { filter: settings } })
    res.json({ settings: filterSettings(store.getProfile()) })
  })
  const apply = async (force, listId = '') => {
    if (busy) throw new Error('DNS 设置正在应用,请稍后重试')
    busy = true
    try {
      const result = await deploy({ store, ctx, paths, refreshDnsFilter: force ? (listId || true) : false })
      if (!result.ok) throw new Error(result.message || 'DNS 设置应用失败')
      await runExclusive(store, () => cleanupDnsFilterCache({ store, ctx, paths })).catch(() => {})
      await observer.tick()
      return result
    } finally { busy = false }
  }
  router.post('/apply', async (req, res) => {
    const listId = typeof req.body?.listId === 'string' ? req.body.listId.trim() : ''
    if (listId && !filterSettings(store.getProfile()).lists.some((l) => l.id === listId && l.enabled)) return res.status(400).json({ error: '只能更新已启用的过滤名单' })
    try { res.json({ result: await apply(req.body?.update === true, listId), ...await status() }) }
    catch (error) { res.status(400).json({ error: error.message }) }
  })
  router.get('/summary', (_req, res) => res.json({ enabled: filterSettings(store.getProfile()).enabled, ...observer.status(), ...data.summary() }))
  router.get('/records', (req, res) => res.json(data.records(req.query)))
  router.get('/preview', async (req, res) => {
    try { res.json(await preview(req.query)) }
    catch (error) { res.status(400).json({ error: error.message }) }
  })
  app.use('/api/openbox/dns-filter', router)
  // 名单自动更新和 Open-Box / Geo 使用同一套计划算法:到点、今天只处理一次、按间隔天数判断。
  // 状态写入统一的 schedule-state.json,面板重启后不会重复下载;失败保留上次有效名单。
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  return {
    updateIfDue: async () => {
      if (busy) return
      const settings = filterSettings(store.getProfile())
      const plan = settings.autoUpdate || {}
      if (!settings.enabled || plan.enabled !== true) return
      const now = new Date()
      if (Number(plan.hour) !== now.getHours()) return
      let schedule
      const schedulePath = paths.dnsFilterScheduleStatePath || paths.scheduleStatePath
      try { schedule = JSON.parse(await ctx.readFile(schedulePath)) || {} } catch { schedule = {} }
      const today = dayKey(now)
      if (schedule.dnsFilterDay === today) return
      schedule.dnsFilterDay = today
      const days = Math.max(1, Number(plan.days) || 1)
      const last = schedule.dnsFilterLastAt ? new Date(schedule.dnsFilterLastAt) : null
      const due = !last || now - last >= (days - 0.5) * 24 * 3600 * 1000
      try { await ctx.writeFile(schedulePath, JSON.stringify(schedule, null, 2)) } catch { /* next tick can retry */ }
      if (!due) return
      const current = await status()
      if (current.pending || !current.applied?.enabled) return
      schedule.dnsFilterLastAt = now.toISOString()
      try { await ctx.writeFile(schedulePath, JSON.stringify(schedule, null, 2)) } catch { /* update still runs */ }
      await apply(true)
    },
  }
}
