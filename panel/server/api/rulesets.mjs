import express from 'express'
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
let cache = null

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

const loadEntries = async (ctx, paths, tag, fetchImpl) => {
  if (cache && cache.tag === tag && Date.now() - cache.at < CACHE_TTL_MS) return cache.entries

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

  cache = { tag, entries, at: Date.now() }
  return entries
}

const intParam = (raw, fallback, max) => {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n < 0) return fallback
  return max ? Math.min(n, max) : n
}

export const registerRulesetRoutes = (app, { ctx, paths, fetchImpl = globalThis.fetch } = {}) => {
  const router = express.Router({ caseSensitive: true })

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
export const clearRulesetEntriesCache = () => { cache = null }
