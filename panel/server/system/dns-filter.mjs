import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import fs from 'node:fs/promises'
import { assertPublicUrl, pinnedLookup } from '../api/net-guard.mjs'
import { allowDomainCondition, DNS_FILTER_RUNTIME, filterKey, filterSettings, parseDnsFilter, validateDnsFilter } from '../engine/dns-filter.mjs'
import { fetchRuleList } from './rule-lists.mjs'

export const FILTER_LIST_STATE = 'openbox/dns-filter-lists'
const readRaw = (store, key, fallback = {}) => { try { return JSON.parse(store.getRaw(key) || 'null') || fallback } catch { return fallback } }
export const readFilterArtifact = (store) => readRaw(store, DNS_FILTER_RUNTIME, null)
export const readFilterListState = (store) => readRaw(store, FILTER_LIST_STATE)

export const cleanupDnsFilterCache = async ({ store, ctx, paths }) => {
  const dir = `${paths.dataDir}/dns-filter`
  const ids = new Set(filterSettings(store.getProfile()).lists.map((l) => l.id))
  const state = Object.fromEntries(Object.entries(readFilterListState(store)).filter(([id]) => ids.has(id)))
  store.setRaw(FILTER_LIST_STATE, JSON.stringify(state))
  const keep = new Set(Object.values(state).map((s) => s.path).filter(Boolean))
  for (const set of readFilterArtifact(store)?.sets || []) keep.add(set.path)
  // Include the running configuration even when settings / prepared artifacts are newer.
  try { for (const set of JSON.parse(await ctx.readFile(paths.configPath)).route?.rule_set || []) if (set.path) keep.add(set.path) }
  catch { return }
  let files
  try { files = await fs.readdir(dir) } catch { return }
  for (const name of files) {
    const file = `${dir}/${name}`
    if (/^[A-Za-z0-9_-]+\.(txt|json|srs)$/.test(name) && !keep.has(file)) await fs.rm(file, { force: true })
  }
}

// Same address policy as subscriptions, with normal TLS verification and pinned DNS per hop.
const guardedFetch = async (input, init) => {
  let url = input
  for (let hop = 0; hop <= 3; hop++) {
    const target = await assertPublicUrl(url, { allowPrivate: true })
    if (target.username || target.password) throw new Error('名单重定向不能包含用户名或密码')
    const response = await new Promise((resolve, reject) => {
      const req = (target.protocol === 'https:' ? https : http).get(target, {
        signal: init.signal, lookup: pinnedLookup(target.validatedRecords),
        headers: { 'user-agent': 'Open-Box DNS Filter', 'accept-encoding': 'identity' },
      }, (res) => {
        const body = [204, 205, 304].includes(res.statusCode) ? null : Readable.toWeb(res)
        if (!body) res.resume()
        try { resolve(new Response(body, { status: res.statusCode, headers: Object.fromEntries(Object.entries(res.headers).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) })) }
        catch (error) { res.destroy(); reject(error) }
      })
      req.on('error', reject)
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (!location) throw new Error('名单重定向缺少地址')
    url = new URL(location, target).href
  }
  throw new Error('名单重定向次数过多')
}

export const fetchDnsFilterList = async (url, fetchImpl = guardedFetch) =>
  (await fetchRuleList(fetchImpl, url)).toString('utf8')

// Content-addressed files: a failed download / compile never changes a running rule set.
export const prepareDnsFilter = async ({ store, ctx, paths, force = false, fetchImpl = guardedFetch, now = Date.now }) => {
  const settings = filterSettings(store.getProfile())
  if (!settings.enabled && !force) return null
  const error = validateDnsFilter(settings)
  if (error) throw new Error(error)
  const previous = readFilterArtifact(store)
  if (!force && previous?.key === filterKey(settings) && (await Promise.all(previous.sets.map((s) => ctx.exists(s.path)))).every(Boolean)) return previous
  const state = readFilterListState(store)
  const dir = `${paths.dataDir}/dns-filter`
  await ctx.mkdirp(dir)
  const parsed = []
  let total = 0
  for (const list of settings.lists.filter((l) => l.enabled)) {
    let entry = state[list.id]
    let body
    try {
      if (!force && entry?.url === list.url && await ctx.exists(entry.path)) body = await ctx.readFile(entry.path)
      else body = (await fetchRuleList(fetchImpl, list.url)).toString('utf8')
      const result = parseDnsFilter(body)
      if (!result.count) throw new Error('名单没有可用的 DNS 规则(不接受网页或空正文)')
      total += result.count
      if (total > 400000) throw new Error('过滤规则总数超过 40 万条,请减少名单')
      const hash = filterKey(body)
      // Validate all regular expressions with the actual core before accepting the new cache.
      const validationRules = Object.values(result.rules).flat()
      const sourcePath = `${dir}/${list.id}-${hash}.json`
      const binaryPath = `${dir}/${list.id}-${hash}.srs`
      await ctx.writeFile(sourcePath, JSON.stringify({ version: 4, rules: validationRules }))
      const check = await ctx.exec(paths.singbox, ['rule-set', 'compile', '--output', binaryPath, sourcePath])
      await ctx.remove(sourcePath)
      if (check.code !== 0) throw new Error(`名单规则无效: ${(check.stderr || '').slice(0, 250)}`)
      // compile serializes regex strings; match actually instantiates the RE2 matchers.
      const validate = await ctx.exec(paths.singbox, ['rule-set', 'match', '--format', 'binary', binaryPath, ''])
      await ctx.remove(binaryPath)
      if (validate.code !== 0) throw new Error(`名单正则无效: ${(validate.stderr || '').slice(0, 250)}`)
      const path = `${dir}/${list.id}-${hash}.txt`
      await ctx.writeFile(path, body)
      entry = { url: list.url, path, hash, count: result.count, unsupported: result.unsupported, unsupportedExamples: result.unsupportedExamples, updatedAt: !force && entry?.hash === hash ? entry.updatedAt : now(), error: '' }
      state[list.id] = entry
      parsed.push({ list, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state[list.id] = { ...entry, error: message }
      store.setRaw(FILTER_LIST_STATE, JSON.stringify(state))
      // Keep the last known good data. First enable with no valid list fails before deployment.
      if (entry?.url !== list.url || !entry.path || !(await ctx.exists(entry.path))) throw new Error(`${list.name}: ${message}`)
      const result = parseDnsFilter(await ctx.readFile(entry.path))
      parsed.push({ list, result })
    }
  }
  if (parsed.reduce((sum, p) => sum + p.result.count, 0) > 400000) throw new Error('过滤规则总数超过 40 万条,请减少名单')
  const artifact = { key: filterKey(settings), sets: [], blocks: [], allow: [], allowImportant: [], userAllow: [], builtAt: now() }
  const compile = async (label, rules) => {
    if (!rules.length) return null
    const source = JSON.stringify({ version: 4, rules })
    const tag = `dns-filter-${label}-${filterKey(source)}`
    const path = `${dir}/${tag}.srs`
    if (!(await ctx.exists(path))) {
      const tmp = `${dir}/${tag}.json`
      await ctx.writeFile(tmp, source)
      const compiled = await ctx.exec(paths.singbox, ['rule-set', 'compile', '--output', path, tmp])
      await ctx.remove(tmp)
      if (compiled.code !== 0) { await ctx.remove(path).catch(() => {}); throw new Error(`过滤规则编译失败: ${(compiled.stderr || '').slice(0, 300)}`) }
    }
    artifact.sets.push({ type: 'local', tag, format: 'binary', path })
    return tag
  }
  for (const kind of ['allow', 'allowImportant']) {
    const tag = await compile(kind, parsed.flatMap((p) => p.result.rules[kind]))
    if (tag) artifact[kind].push(tag)
  }
  const userAllow = await compile('user-allow', settings.allowDomains.map(allowDomainCondition))
  if (userAllow) artifact.userAllow.push(userAllow)
  for (const { list, result } of parsed) for (const important of [true, false]) {
    const tag = await compile(`${list.id}-${important ? 'important' : 'block'}`, result.rules[important ? 'blockImportant' : 'block'])
    if (tag) artifact.blocks.push({ tag, listId: list.id, name: list.name, important })
  }
  store.setRaw(FILTER_LIST_STATE, JSON.stringify(state))
  store.setRaw(DNS_FILTER_RUNTIME, JSON.stringify(artifact))
  return artifact
}
