// 自动更新计划:面板进程自己每分钟看一眼档案里的计划,到点就做;不依赖 cron。
// 两件事:Open-Box 自身升级(先探最新版,有新版才升)、Geo 规则集刷新(刷完重启内核
// 让新文件生效)。每件事一天最多做一次,记录在 data/schedule-state.json。
import { readJsonFile, writeJsonFile, readMeta, fetchLatestVersion, compareVersions, startUpdate, refreshRulesets, readUpdateStatus } from './updater.mjs'
import { serviceStatus } from './service.mjs'

const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

export const runScheduledTasks = async ({ store, ctx, paths, fetchImpl = globalThis.fetch, runDeploy, now = new Date(), log = () => {} }) => {
  const updates = (store.getProfile() || {}).updates || {}
  const state = await readJsonFile(ctx, paths.scheduleStatePath, {})
  const hour = now.getHours()
  const today = dayKey(now)
  let changed = false

  // Geo 规则集
  const geo = updates.geo || {}
  if (geo.auto && Number(geo.hour) === hour && state.geoDay !== today) {
    const days = Math.max(1, Number(geo.days) || 7)
    const last = state.geoLastAt ? new Date(state.geoLastAt) : null
    const due = !last || now - last >= (days - 0.5) * 24 * 3600 * 1000
    state.geoDay = today
    changed = true
    if (due) {
      try {
        const result = await refreshRulesets(ctx, paths, { fetchImpl })
        let restarted = false
        if (result.updated.length && runDeploy && (await serviceStatus(ctx, paths.initd.core)).running) {
          restarted = (await runDeploy({ store, ctx, paths })).ok
        }
        state.geoLastAt = now.toISOString()
        await writeJsonFile(ctx, paths.geoUpdateStatePath, { lastAt: state.geoLastAt, updated: result.updated, failed: result.failed, restarted, source: 'schedule' })
        log(`[schedule] geo rulesets: ${result.updated.length} updated, ${result.failed.length} failed`)
      } catch (err) {
        log(`[schedule] geo rulesets failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  // Open-Box 自身
  const ob = updates.openbox || {}
  if (ob.auto && Number(ob.hour) === hour && state.openboxDay !== today) {
    state.openboxDay = today
    changed = true
    try {
      const status = await readUpdateStatus(ctx, paths)
      if (!status.running) {
        const meta = await readMeta(ctx, paths)
        const { latest } = await fetchLatestVersion(fetchImpl)
        if (compareVersions(latest, meta.version) > 0) {
          const r = await startUpdate(ctx, paths, ob.channel || 'auto')
          log(`[schedule] open-box update ${meta.version} -> ${latest}: ${r.ok ? 'started' : r.output}`)
          state.openboxLastAt = now.toISOString()
        } else {
          log(`[schedule] open-box up to date (${meta.version})`)
        }
      }
    } catch (err) {
      log(`[schedule] open-box update check failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  if (changed) await writeJsonFile(ctx, paths.scheduleStatePath, state)
}

export const startScheduler = (deps, { intervalMs = 60_000 } = {}) => {
  const tick = () => { runScheduledTasks(deps).catch((err) => deps.log?.(`[schedule] ${err}`)) }
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
