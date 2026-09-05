import express from 'express'
import { loadRuleList } from '../system/rule-lists.mjs'
import { normalizeRouting } from '../engine/routing-model.mjs'
import { downloadRuleset, isSafeRulesetTag } from '../system/rulesets.mjs'

// 「详情」:一个 geosite/geoip 分类里到底有哪些域名/IP。
//
// .srs 是编译过的二进制,面板自己解不开——但内核自带解码器(sing-box rule-set
// decompile),而内核就在旁边。所以这里的做法是:必要时把 .srs 下下来,交给内核转成
// JSON,再按页返回。这样"看到的"和"内核真正会匹配的"是同一份数据,不存在第二套解析
// 逻辑跑偏的可能。
//
// 最大的分类(geosite-cn)解出来 9000 多条、230KB,解码 20ms —— 不值得为它设计什么
// 增量方案;只把最近看的那一个缓存下来,免得每敲一个字母就重解一次。
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_LIMIT = 100
// 最近看过的几个分类(tag → {entries, at});「域名穿透」一个站点集会同时展开三四个规则集,
// 只缓存一个的话每翻一页都要重解其余几个
const CACHE_MAX = 8
const cache = new Map()

// 只有一个值时内核输出的是裸字符串而不是数组("domain_suffix": "adx.36kr.com",
// sing-box 的 Listable 就是这么序列化的),两种都得认——只认数组的话,单条目的分类
// 会显示成空的,而它明明有内容。
const flatten = (json) => {
  const out = []
  for (const rule of (json && json.rules) || []) {
    if (!rule || typeof rule !== 'object') continue
    for (const [type, values] of Object.entries(rule)) {
      for (const value of Array.isArray(values) ? values : [values]) {
        if (typeof value === 'string') out.push({ type, value })
      }
    }
  }
  return out
}

export const loadEntries = async (ctx, paths, tag, fetchImpl) => {
  const hit = cache.get(tag)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.entries

  const srsPath = `${paths.rulesetDir}/${tag}.srs`
  if (!(await ctx.exists(srsPath))) {
    // 没部署过的分类本地不会有,现取一份。取回来就放在正式目录里:下次部署真用到它
    // 时正好省一次下载,而多出来的文件本身也是一个合法的规则集。
    const data = await downloadRuleset(fetchImpl, tag)
    await ctx.mkdirp(paths.rulesetDir)
    await ctx.writeFileBinary(srsPath, data)
  }

  const jsonPath = `${paths.dataDir}/tmp/${tag}.json`
  await ctx.mkdirp(`${paths.dataDir}/tmp`)
  const result = await ctx.exec(paths.singbox, ['rule-set', 'decompile', '--output', jsonPath, srsPath])
  if (result.code !== 0) {
    throw new Error(`解码规则集失败:${(result.stderr || '').trim() || `exit ${result.code}`}`)
  }
  let entries
  try {
    entries = flatten(JSON.parse(await ctx.readFile(jsonPath)))
  } finally {
    await ctx.remove(jsonPath)
  }

  cache.set(tag, { entries, at: Date.now() })
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  return entries
}

// 「域名穿透」:一个站点集到底会命中哪些域名/IP。规则集展开成条目,手写的条件原样列出;
// 每条带来源(哪个规则集 / 自定义),按 全部/域名/IP 分档,可搜索、可排序、分页。
const FAMILY_OF = (type) => (type.startsWith('domain') ? 'domain' : type.startsWith('ip') ? 'ip' : 'other')
const CUSTOM_SOURCE = 'custom'
const buildPolicyEntries = async (ctx, paths, policy, fetchImpl) => {
  const out = []
  const missing = []
  for (const [type, list] of [['domain', policy.domain], ['domain_suffix', policy.domainSuffix], ['domain_keyword', policy.domainKeyword], ['ip_cidr', policy.ipCidr]]) {
    for (const value of list || []) out.push({ type, family: FAMILY_OF(type), content: value, source: CUSTOM_SOURCE })
  }
  for (const tag of policy.rulesets || []) {
    if (!isSafeRulesetTag(tag) || !/^(geosite|geoip)-/.test(tag)) { missing.push(tag); continue }
    try {
      for (const e of await loadEntries(ctx, paths, tag, fetchImpl)) {
        out.push({ type: e.type, family: FAMILY_OF(e.type), content: e.value, source: tag })
      }
    } catch {
      // 某个规则集拉不到/解不开:其余的照样列,把它记在 missing 里让界面提示
      missing.push(tag)
    }
  }
  return { entries: out, missing }
}

const intParam = (raw, fallback, max) => {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n < 0) return fallback
  return max ? Math.min(n, max) : n
}

export const registerRulesetRoutes = (app, { ctx, paths, store, fetchImpl = globalThis.fetch } = {}) => {
  const router = express.Router({ caseSensitive: true })

  // GET /api/openbox/policies/entries?name=AI&tab=all|domain|ip&q=&sort=type|content|source&dir=asc|desc&offset=0&limit=100
  router.get('/policies/entries', async (req, res) => {
    const name = String(req.query.name || '').trim()
    if (!name) return res.status(400).json({ message: 'name is required' })
    const conf = normalizeRouting(store?.getProfile?.()?.routing)
    const tab = ['domain', 'ip'].includes(String(req.query.tab)) ? String(req.query.tab) : 'all'
    const q = String(req.query.q || '').trim().toLowerCase()
    const sort = ['type', 'content', 'source'].includes(String(req.query.sort)) ? String(req.query.sort) : ''
    const dir = String(req.query.dir) === 'desc' ? -1 : 1
    const offset = intParam(req.query.offset, 0)
    const limit = intParam(req.query.limit, 100, MAX_LIMIT) || 100

    if (name === conf.fallback.name) {
      // 兜底没有自己的规则:上面都没命中的流量走它
      return res.json({ name, fallback: true, counts: { all: 0, domain: 0, ip: 0 }, total: 0, matched: 0, offset, limit, hasMore: false, entries: [], missing: [] })
    }
    const policy = conf.policies.find((p) => p.name === name)
    if (!policy) return res.status(404).json({ message: `站点集不存在:${name}` })

    try {
      const { entries, missing } = await buildPolicyEntries(ctx, paths, policy, fetchImpl)
      const counts = { all: entries.length, domain: 0, ip: 0 }
      for (const e of entries) if (e.family === 'domain') counts.domain++; else if (e.family === 'ip') counts.ip++
      let list = tab === 'all' ? entries : entries.filter((e) => e.family === tab)
      if (q) list = list.filter((e) => e.content.toLowerCase().includes(q) || e.source.toLowerCase().includes(q) || e.type.includes(q))
      if (sort) list = [...list].sort((a, b) => dir * String(a[sort]).localeCompare(String(b[sort])))
      res.json({
        name, fallback: false, counts, total: entries.length, matched: list.length, offset, limit,
        hasMore: offset + limit < list.length,
        entries: list.slice(offset, offset + limit),
        missing,
      })
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : String(error) })
    }
  })

  // GET /api/openbox/rulesets/preview?url=https://…/Check.list&q=&offset=0&limit=50
  // 「规则集链接」还没保存、没部署时就要能看:直接把网址拉回来解析,不经过编译那一步。
  // 形状和 /rulesets/entries 一样,前端同一个弹窗两边都能用。
  router.get('/rulesets/preview', async (req, res) => {
    const url = String(req.query.url || '').trim()
    if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 2048) {
      return res.status(400).json({ message: '规则集链接必须是 http(s) 网址' })
    }
    const q = String(req.query.q || '').trim().toLowerCase()
    const offset = intParam(req.query.offset, 0)
    const limit = intParam(req.query.limit, 50, MAX_LIMIT) || 50
    try {
      const key = `url:${url}`
      const hit = cache.get(key)
      let entries
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        entries = hit.entries
      } else {
        const parsed = await loadRuleList(fetchImpl, url)
        entries = []
        for (const [type, values] of Object.entries(parsed)) for (const value of values) entries.push({ type, value })
        cache.set(key, { entries, at: Date.now() })
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
      }
      const matched = q ? entries.filter((e) => e.value.toLowerCase().includes(q)) : entries
      res.json({ url, total: entries.length, matched: matched.length, offset, limit, entries: matched.slice(offset, offset + limit) })
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : String(error) })
    }
  })

  // GET /api/openbox/rulesets/entries?tag=geosite-cn&q=&offset=0&limit=50
  router.get('/rulesets/entries', async (req, res) => {
    const tag = String(req.query.tag || '')
    // 只认官方那两个前缀:tag 会被拼成下载地址和本地文件名,这里是它进系统的入口
    if (!isSafeRulesetTag(tag) || !/^(geosite|geoip)-/.test(tag)) {
      return res.status(400).json({ message: `不合法的规则集名:${tag}` })
    }
    const q = String(req.query.q || '').trim().toLowerCase()
    const offset = intParam(req.query.offset, 0)
    const limit = intParam(req.query.limit, 50, MAX_LIMIT) || 50

    try {
      const entries = await loadEntries(ctx, paths, tag, fetchImpl)
      const matched = q ? entries.filter((e) => e.value.toLowerCase().includes(q)) : entries
      res.json({
        tag,
        total: entries.length,
        matched: matched.length,
        offset,
        limit,
        entries: matched.slice(offset, offset + limit),
      })
    } catch (error) {
      // 拉不到/解不开都是外部依赖不可用(GitHub 连不上、内核二进制缺失),不是请求本身有问题
      res.status(503).json({ message: error instanceof Error ? error.message : String(error) })
    }
  })

  app.use('/api/openbox', router)
}

// 测试用:清掉那一个分类的缓存
export const clearRulesetEntriesCache = () => { cache.clear() }
