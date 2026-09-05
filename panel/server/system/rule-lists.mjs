// 规则集链接:把站点集里引用的那些网址下回来,编成内核能用的 .srs。
//
// 和 system/rulesets.mjs 的分工:那边是 geosite / geoip,名字固定、上游固定、已经是编好的
// .srs,只管缺了就下;这边是用户自己填的任意网址,拿到的是一份文本名单(Clash 的
// DOMAIN-SUFFIX,xxx 那种,或者一行一个域名),要先解析成条件、写成源格式、再调
// `sing-box rule-set compile` 编成二进制。解析在 engine/rule-list.mjs,那部分是纯函数。
//
// 失败的处理分两种:
//   · 本地已经有编好的那份 —— 拉不动就用旧的,记一条日志。名单在别人服务器上,不该
//     因为对方今天抽风就让整次部署失败(用户可能只是改了个节点)。
//   · 本地没有 —— 那这个站点集的规则在内核里就是空的,必须让部署停下来说清楚,
//     否则内核会在校验阶段报 "open .../list-xxxxxxxx.srs: no such file or directory"。
import { collectRuleListUrls } from '../engine/routing-model.mjs'
import { parseRuleList, ruleListIsEmpty, ruleListToSource } from '../engine/rule-list.mjs'

const FETCH_TIMEOUT_MS = 30000
// 一份名单撑死几百 KB;给 8MB 挡住"拿到一个几百 MB 的东西把路由器内存吃光"
const MAX_BYTES = 8 * 1024 * 1024
// 多久重下一次。名单是别人维护的,会变;但也不该每次部署都去拉一遍——
// 部署是个本来纯本地的操作,不该动不动依赖外网。
const REFRESH_MS = 24 * 60 * 60 * 1000

export const listStatePath = (paths) => `${paths.dataDir}/rule-lists.json`

const readState = async (ctx, paths) => {
  try {
    const raw = JSON.parse(await ctx.readFile(listStatePath(paths)))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export const fetchRuleList = async (fetchImpl, url) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let res
  try {
    res = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timer)
  }
  if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : '无响应'}`)
  const text = await res.text()
  if (text.length > MAX_BYTES) throw new Error(`名单太大(${Math.round(text.length / 1024)}KB)`)
  return text
}

// 一个链接 → 一份 .srs。写临时源文件、编译、删临时文件。
const compileOne = async (ctx, paths, { url, tag }, fetchImpl) => {
  const text = await fetchRuleList(fetchImpl, url)
  const parsed = parseRuleList(text)
  if (ruleListIsEmpty(parsed)) throw new Error('这份名单里没有解析出任何域名或 IP')
  const counts = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]))

  const srcPath = `${paths.dataDir}/tmp/${tag}.json`
  const outPath = `${paths.rulesetDir}/${tag}.srs`
  await ctx.mkdirp(`${paths.dataDir}/tmp`)
  await ctx.mkdirp(paths.rulesetDir)
  await ctx.writeFile(srcPath, JSON.stringify(ruleListToSource(parsed)))
  try {
    const r = await ctx.exec(paths.singbox, ['rule-set', 'compile', '--output', outPath, srcPath])
    if (r.code !== 0) throw new Error(`编译规则集失败:${(r.stderr || '').trim() || `exit ${r.code}`}`)
  } finally {
    await ctx.remove(srcPath)
  }
  return counts
}

// 部署前调一次:把档案里引用到的规则集链接补齐。
// 已经有、且没到重下时间的跳过;拉不动但本地有旧的就用旧的。
export const ensureRuleLists = async (
  ctx,
  paths,
  routing,
  { fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {} } = {},
) => {
  const wanted = collectRuleListUrls(routing)
  if (!wanted.length) return { ok: true, updated: [], failed: [] }

  const state = await readState(ctx, paths)
  const next = {}
  const updated = []
  const failed = []
  for (const item of wanted) {
    const prev = state[item.tag]
    const exists = await ctx.exists(`${paths.rulesetDir}/${item.tag}.srs`)
    const fresh = exists && prev && prev.url === item.url && now() - Number(prev.at || 0) < REFRESH_MS
    if (fresh) {
      next[item.tag] = prev
      continue
    }
    try {
      const counts = await compileOne(ctx, paths, item, fetchImpl)
      next[item.tag] = { url: item.url, at: now(), counts }
      updated.push(item.tag)
      log(`[rule-list] ${item.url} → ${item.tag}.srs(${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ tag: item.tag, url: item.url, message })
      if (exists) {
        // 有旧的就接着用:名单在别人服务器上,不该因为对方今天抽风就让部署失败
        next[item.tag] = prev || { url: item.url, at: 0 }
        log(`[rule-list] ${item.url} 拉取失败(${message}),沿用本地已有的那份`)
      } else {
        return { ok: false, updated, failed, message: `规则集链接拉取失败:${item.url} —— ${message}` }
      }
    }
  }
  await ctx.writeFile(listStatePath(paths), JSON.stringify(next, null, 2))
  return { ok: true, updated, failed }
}
