import { filterSettings, parseDnsFilter, validateDnsFilter } from '../engine/dns-filter.mjs'
import { fetchDnsFilterList, readFilterListState } from './dns-filter.mjs'

// Read-only: reuse downloaded content and the real filter parser. Draft URLs use the same
// guarded, size/time-limited downloader, without saving a list or applying DNS settings.
export const createDnsFilterPreview = ({ store, ctx, fetchImpl, ttlMs = 60000 }) => {
  let cache = null, pending = null, timer = null
  const load = async (url, saved, key) => {
    const body = saved ? await ctx.readFile(saved.path) : await fetchDnsFilterList(url, fetchImpl)
    const { entries, count, unsupported, unsupportedExamples } = parseDnsFilter(String(body), { collectEntries: true })
    const value = { entries, ruleCount: count, unsupported, unsupportedExamples, source: saved ? 'downloaded' : 'url', updatedAt: saved?.updatedAt || null }
    cache = { key, value }
    clearTimeout(timer)
    timer = setTimeout(() => { cache = null }, ttlMs)
    timer.unref?.()
    return value
  }
  return async ({ url, search = '', action = 'all', page = 1, pageSize = 20 } = {}) => {
    if (!['all', 'allow', 'block'].includes(action)) throw new Error('无效的规则筛选类型')
    if (typeof url !== 'string') throw new Error('请填写名单网址')
    url = url.trim()
    const error = validateDnsFilter({ enabled: false, lists: [{ id: 'preview', name: 'Preview', enabled: false, url }], allowDomains: [] })
    if (error) throw new Error(error)
    // Only registered lists may reference persisted files; a draft cannot supply a path.
    const list = filterSettings(store.getProfile()).lists.find((item) => item.url === url)
    const state = list && readFilterListState(store)[list.id]
    const saved = state?.url === url && state.path && await ctx.exists(state.path) ? state : null
    const key = JSON.stringify([url, saved?.path, saved?.hash, saved?.updatedAt])
    let result
    if (cache?.key === key) result = cache.value
    else {
      if (pending && pending.key !== key) throw new Error('正在加载另一份过滤名单,请稍后重试')
      if (!pending) {
        cache = null
        pending = { key, promise: load(url, saved, key).finally(() => { pending = null }) }
      }
      result = await pending.promise
    }
    const query = String(search).trim().toLowerCase().slice(0, 253)
    const matched = query || action !== 'all'
      ? result.entries.filter((entry) => (action === 'all' || entry.action === action)
        && (!query || entry.value.toLowerCase().includes(query) || entry.rule.toLowerCase().includes(query)))
      : result.entries
    const size = Number.isFinite(Number(pageSize)) && Number(pageSize) >= 1 ? Math.min(1000, Math.trunc(Number(pageSize))) : 20
    const last = Math.max(1, Math.ceil(matched.length / size))
    const current = Number.isFinite(Number(page)) && Number(page) >= 1 ? Math.min(last, Math.trunc(Number(page))) : 1
    const { entries, ...meta } = result
    return { ...meta, count: entries.length, total: matched.length, page: current, pageSize: size, rows: matched.slice((current - 1) * size, current * size) }
  }
}
