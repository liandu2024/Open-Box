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
  const apply = async (force) => {
    if (busy) throw new Error('DNS 设置正在应用,请稍后重试')
    busy = true
    try {
      const result = await deploy({ store, ctx, paths, refreshDnsFilter: force })
      if (!result.ok) throw new Error(result.message || 'DNS 设置应用失败')
      await runExclusive(store, () => cleanupDnsFilterCache({ store, ctx, paths })).catch(() => {})
      await observer.tick()
      return result
    } finally { busy = false }
  }
  router.post('/apply', async (req, res) => {
    try { res.json({ result: await apply(req.body?.update === true), ...await status() }) }
    catch (error) { res.status(400).json({ error: error.message }) }
  })
  router.get('/summary', (_req, res) => res.json({ enabled: filterSettings(store.getProfile()).enabled, ...observer.status(), ...data.summary() }))
  router.get('/records', (req, res) => res.json(data.records(req.query)))
  router.get('/preview', async (req, res) => {
    try { res.json(await preview(req.query)) }
    catch (error) { res.status(400).json({ error: error.message }) }
  })
  app.use('/api/openbox/dns-filter', router)
  // Existing lists update once per day while enabled. Failures retain the cached list and wait
  // before retrying; disabled installations do not download anything.
  let lastAttempt = Date.now()
  return {
    updateIfDue: async () => {
      if (busy || Date.now() - lastAttempt < 3600000) return
      const settings = filterSettings(store.getProfile())
      if (!settings.enabled) return
      const state = readFilterListState(store)
      const active = settings.lists.filter((l) => l.enabled)
      if (!active.some((l) => !state[l.id]?.updatedAt || Date.now() - state[l.id].updatedAt > 86400000)) return
      lastAttempt = Date.now()
      const current = await status()
      if (current.pending || !current.applied?.enabled) return
      await apply(true)
    },
  }
}
