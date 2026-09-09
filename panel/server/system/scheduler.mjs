// 自动更新计划:面板进程自己每分钟看一眼档案里的计划,到点就做;不依赖 cron。
// 两件事:Open-Box 自身升级(先探最新版,有新版才升)、Geo 规则集刷新(同样先探上游
// tag,有新版才下,下完重启内核让新文件生效)。每件事一天最多做一次,记录在
// data/schedule-state.json。
import { fetchSelections, resolveSelections } from '../api/deploy-runner.mjs'
import { readJsonFile, writeJsonFile, readMeta, fetchLatestVersion, compareVersions, startUpdate, refreshRulesets, readUpdateStatus, checkGeoUpdate } from './updater.mjs'
import { serviceStatus } from './service.mjs'
import { refreshSubscriptionById } from '../api/subscriptions.mjs'

const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

export const runScheduledTasks = async ({ store, ctx, paths, fetchImpl = globalThis.fetch, subscriptionFetchImpl, lookup, runDeploy, now = new Date(), log = () => {} }) => {
  // 内核跑着就把各 selector 当前的选择存成快照,给内核停着时的部署用(见 store)
  try {
    if (typeof store.getClashSecret === 'function') {
      resolveSelections(store, await fetchSelections(fetchImpl, store.getClashSecret()))
    }
  } catch { /* 读不到就留着上次的 */ }

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
      const channel = geo.channel || 'auto'
      try {
        const check = await checkGeoUpdate(ctx, paths, { fetchImpl })
        if (!check.hasUpdate) {
          state.geoLastAt = now.toISOString()
          log(`[schedule] geo rulesets up to date (${Object.values(check.latest).join(', ')})`)
        } else {
          const previous = await readJsonFile(ctx, paths.geoUpdateStatePath, {})
          const result = await refreshRulesets(ctx, paths, { fetchImpl, channel, latest: check.latest })
          let restarted = false
          if (result.updated.length && runDeploy && (await serviceStatus(ctx, paths.initd.core)).running) {
            restarted = (await runDeploy({ store, ctx, paths })).ok
          }
          state.geoLastAt = now.toISOString()
          const versions = result.updated.length ? { ...(previous.versions || {}), ...result.versions } : previous.versions || {}
          await writeJsonFile(ctx, paths.geoUpdateStatePath, {
            lastAt: state.geoLastAt, updated: result.updated, failed: result.failed, restarted, trigger: 'schedule', channel, versions, source: result.source,
          })
          log(`[schedule] geo rulesets: ${result.updated.length} updated, ${result.failed.length} failed`)
        }
      } catch (err) {
        log(`[schedule] geo rulesets failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  // Open-Box 自身:和 Geo 一样按「每隔几天」到点探一次,有新版才升;openboxLastAt 记的是
  // 上次真正探过的时间(不管有没有新版),间隔从它算
  const ob = updates.openbox || {}
  if (ob.auto && Number(ob.hour) === hour && state.openboxDay !== today) {
    const days = Math.max(1, Number(ob.days) || 1)
    const last = state.openboxLastAt ? new Date(state.openboxLastAt) : null
    const due = !last || now - last >= (days - 0.5) * 24 * 3600 * 1000
    state.openboxDay = today
    changed = true
    if (due) {
      try {
        const status = await readUpdateStatus(ctx, paths)
        if (!status.running) {
          const meta = await readMeta(ctx, paths)
          const { latest } = await fetchLatestVersion(fetchImpl)
          state.openboxLastAt = now.toISOString()
          if (compareVersions(latest, meta.version) > 0) {
            const r = await startUpdate(ctx, paths, ob.channel || 'auto')
            log(`[schedule] open-box update ${meta.version} -> ${latest}: ${r.ok ? 'started' : r.output}`)
          } else {
            log(`[schedule] open-box up to date (${meta.version})`)
          }
        }
      } catch (err) {
        log(`[schedule] open-box update check failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  // 订阅定期更新:每条订阅自己的「每隔几天、几点」(api/subscriptions.mjs 的 autoUpdate)。
  // 和上面两件事同一套算法:到点、今天没做过、离上次够了 N 天才拉。半夜无人值守,拉完节点
  // 真变了就把内核重启一次——不重启的话更新了也进不了内核;内核没在跑就算了。
  if (typeof store.getSubscriptions === 'function' && typeof store.getNodes === 'function') {
    const subs = store.getSubscriptions()
    const subState = state.subscriptions || {}
    // 删掉的订阅不留记录
    for (const id of Object.keys(subState)) if (!subs.some((s) => s.id === id)) { delete subState[id]; changed = true }
    let poolChanged = false
    for (const sub of subs) {
      // 停用的订阅不拉(GitHub #40)
      if (sub.enabled === false) continue
      const plan = sub.autoUpdate
      if (!plan || plan.enabled !== true || Number(plan.hour) !== hour) continue
      const st = subState[sub.id] || {}
      if (st.day === today) continue
      const days = Math.max(1, Number(plan.days) || 1)
      const last = st.lastAt ? new Date(st.lastAt) : null
      const due = !last || now - last >= (days - 0.5) * 24 * 3600 * 1000
      subState[sub.id] = { ...st, day: today }
      changed = true
      if (!due) continue
      const before = JSON.stringify(store.getNodes())
      try {
        const r = await refreshSubscriptionById(store, sub.id, { fetchImpl: subscriptionFetchImpl || fetchImpl, ...(lookup ? { lookup } : {}) })
        const nodesChanged = JSON.stringify(store.getNodes()) !== before
        if (nodesChanged) poolChanged = true
        subState[sub.id] = { day: today, lastAt: now.toISOString(), result: `ok:${r.nodeCount}` }
        log(`[schedule] subscription ${sub.name}: ${r.nodeCount} nodes, ${nodesChanged ? 'changed' : 'unchanged'}`)
      } catch (err) {
        subState[sub.id] = { day: today, lastAt: st.lastAt, result: `error:${err instanceof Error ? err.message : err}` }
        log(`[schedule] subscription ${sub.name} failed: ${err instanceof Error ? err.message : err}`)
      }
      // 每拉完一条就落一次状态:几条订阅串行要跑一两分钟,中途面板重启(比如赶上自动升级)
      // 的话,拉过的不会在下一分钟再拉一遍、再多重启一次内核
      state.subscriptions = subState
      await writeJsonFile(ctx, paths.scheduleStatePath, state)
    }
    state.subscriptions = subState
    if (poolChanged && runDeploy && (await serviceStatus(ctx, paths.initd.core)).running) {
      const r = await runDeploy({ store, ctx, paths })
      log(`[schedule] subscriptions changed, core ${r.ok ? 'restarted' : `restart failed: ${r.message}`}`)
    }
  }

  if (changed) await writeJsonFile(ctx, paths.scheduleStatePath, state)
}

export const startScheduler = (deps, { intervalMs = 60_000 } = {}) => {
  // 一次 tick 可能跑好几分钟(探版本、下规则集、重新部署),期间下一次 tick 看到的还是
  // 旧的 geoDay,会再跑一遍并发部署——上一轮没结束就跳过这一轮
  let busy = false
  const tick = () => {
    if (busy) return
    busy = true
    runScheduledTasks(deps)
      .catch((err) => deps.log?.(`[schedule] ${err}`))
      .finally(() => { busy = false })
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
