// 规则集链接:把站点集里引用的那些网址下回来,编成内核能用的 .srs。
//
// 和 system/rulesets.mjs 的分工:那边是 geosite / geoip,名字固定、上游固定、已经是编好的
// .srs,只管缺了就下;这边是用户自己填的任意网址,要先解析成条件、写成源格式、再调
// `sing-box rule-set compile` 编成二进制。两种来源都收:
//   · 文本名单 —— Clash 的 DOMAIN-SUFFIX,xxx 那种,或者一行一个域名(engine/rule-list.mjs)
//   · mihomo 的 .mrs —— 整份 zstd,里面是二进制的域名树 / IP 区间(engine/mrs.mjs)。
//     内核自己不认这个格式(`sing-box rule-set convert` 只会转 adguard),所以在这里解开。
// 两条路解析出来的形状一样,后面编译、引用、部署完全共用。
//
// 失败的处理分两种:
//   · 本地已经有编好的那份 —— 拉不动就用旧的,记一条日志。名单在别人服务器上,不该
//     因为对方今天抽风就让整次部署失败(用户可能只是改了个节点)。
//   · 本地没有 —— 那这个站点集的规则在内核里就是空的,必须让部署停下来说清楚,
//     否则内核会在校验阶段报 "open .../list-xxxxxxxx.srs: no such file or directory"。
import { zstdDecompressSync } from 'node:zlib'
import { collectRuleListUrls } from '../engine/routing-model.mjs'
import { decodeMrs, looksLikeZstd } from '../engine/mrs.mjs'
import { parseRuleList, ruleListIsEmpty, ruleListShape, ruleListToSource, ruleListIpTag, splitRuleList } from '../engine/rule-list.mjs'

const FETCH_TIMEOUT_MS = 30000
// 一份名单撑死几百 KB;给 8MB 挡住"拿到一个几百 MB 的东西把路由器内存吃光"
const MAX_BYTES = 8 * 1024 * 1024
// .mrs 是压缩的,解压后还要再挡一道:8MB 的 zstd 能炸出几个 G,路由器只有 1GB 内存。
// geosite 里最大的 cn 也就解出 900KB,32MB 已经很宽松了。
const MAX_DECOMPRESSED = 32 * 1024 * 1024
// 多久重下一次。名单是别人维护的,会变;但也不该每次部署都去拉一遍——
// 部署是个本来纯本地的操作,不该动不动依赖外网。
const REFRESH_MS = 24 * 60 * 60 * 1000
// 编译产物的版式。2 = 域名 / IP 拆成两份 .srs(见 engine/rule-list.mjs 的 splitRuleList)。
// 状态里记的版式不是这个数,说明本地那份是老版式(域名 IP 混在一个文件里),要重编——
// 老版式的文件被 DNS 规则引用时,就是那个"每个域名先查一遍再扔掉"的毛病。
const SPLIT_VERSION = 2

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
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new Error(`名单太大(${Math.round(buf.length / 1024)}KB)`)
  return buf
}

// 下回来的东西 → 结构化条件。两种:
//   · 文本名单(Clash 规则行 / 一行一个域名),交给 engine/rule-list.mjs
//   · mihomo 的 .mrs(整份 zstd,里面是二进制),先解压再交给 engine/mrs.mjs
// 认的是内容开头的魔数不是网址后缀:网址可能带一堆查询参数,也可能经过代理改名。
export const parseRuleListBody = (buf) => {
  if (!looksLikeZstd(buf)) return parseRuleList(buf.toString('utf8'))
  if (typeof zstdDecompressSync !== 'function') {
    throw new Error('当前 Node 不支持 zstd,解不开 .mrs 规则集')
  }
  const payload = zstdDecompressSync(buf, { maxOutputLength: MAX_DECOMPRESSED })
  return decodeMrs(payload).parsed
}

export const loadRuleList = async (fetchImpl, url) => parseRuleListBody(await fetchRuleList(fetchImpl, url))

// 一份源格式 → 一份 .srs。写临时源文件、编译、删临时文件。
const compileSrs = async (ctx, paths, tag, parsed) => {
  const srcPath = `${paths.dataDir}/tmp/${tag}.json`
  const outPath = `${paths.rulesetDir}/${tag}.srs`
  await ctx.writeFile(srcPath, JSON.stringify(ruleListToSource(parsed)))
  try {
    const r = await ctx.exec(paths.singbox, ['rule-set', 'compile', '--output', outPath, srcPath])
    if (r.code !== 0) throw new Error(`编译规则集失败:${(r.stderr || '').trim() || `exit ${r.code}`}`)
  } finally {
    await ctx.remove(srcPath)
  }
}

const removeIfExists = async (ctx, path) => {
  if (await ctx.exists(path)) await ctx.remove(path)
}

// 解析好的名单 → 域名一份 list-xxx.srs、IP 一份 list-xxx-ip.srs(哪边没有内容就不出那份文件,
// 上次留下的同名旧文件也删掉,免得配置里引用不到它却还躺在磁盘上)。返回每类条数。
const compileParsed = async (ctx, paths, tag, parsed) => {
  if (ruleListIsEmpty(parsed)) throw new Error('这份名单里没有解析出任何域名或 IP')
  const counts = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]))
  const { domains, ips } = splitRuleList(parsed)
  const shape = ruleListShape(counts)

  await ctx.mkdirp(`${paths.dataDir}/tmp`)
  await ctx.mkdirp(paths.rulesetDir)
  if (shape.domain) await compileSrs(ctx, paths, tag, domains)
  else await removeIfExists(ctx, `${paths.rulesetDir}/${tag}.srs`)
  if (shape.ip) await compileSrs(ctx, paths, ruleListIpTag(tag), ips)
  else await removeIfExists(ctx, `${paths.rulesetDir}/${ruleListIpTag(tag)}.srs`)
  return counts
}

// 一个链接 → 拉回来、解析、编译
const compileOne = async (ctx, paths, { url, tag }, fetchImpl) =>
  compileParsed(ctx, paths, tag, await loadRuleList(fetchImpl, url))

// 老版式的本地文件(域名 IP 混在一份 list-xxx.srs 里)不用重新下:用内核解回源格式,再拆成
// 两份编译。这样升级后第一次部署就能拿到拆好的文件,不依赖外网(路由器拉 GitHub 未必通);
// 名单本身到了重下时间照常重下。
const resplitLegacy = async (ctx, paths, tag) => {
  const legacyPath = `${paths.rulesetDir}/${tag}.srs`
  const tmp = `${paths.dataDir}/tmp/${tag}.legacy.json`
  await ctx.mkdirp(`${paths.dataDir}/tmp`)
  const r = await ctx.exec(paths.singbox, ['rule-set', 'decompile', '--output', tmp, legacyPath])
  if (r.code !== 0) throw new Error(`解开旧规则集失败:${(r.stderr || '').trim() || `exit ${r.code}`}`)
  let source
  try {
    source = JSON.parse(await ctx.readFile(tmp))
  } finally {
    await removeIfExists(ctx, tmp)
  }
  const parsed = { domain: [], domain_suffix: [], domain_keyword: [], domain_regex: [], ip_cidr: [] }
  for (const rule of Array.isArray(source?.rules) ? source.rules : []) {
    // 解回来的字段单个值时是字符串,多个是数组
    for (const k of Object.keys(parsed)) if (rule && rule[k] != null) parsed[k].push(...[].concat(rule[k]))
  }
  return compileParsed(ctx, paths, tag, parsed)
}

// 部署前、生成配置之前调一次:把档案里引用到的规则集链接补齐。
// 已经有、且没到重下时间的跳过;拉不动但本地有旧的就用旧的。
// 返回的 lists 是形状表 { [tag]: { domain, ip } }:每条链接编成了哪几份 .srs,生成配置时
// 路由规则 / DNS 规则凭它决定引用哪几份(见 engine/routing-model.mjs)。只有老版式、
// 又拉不动的那种才会缺形状——生成配置时就按老样子引用一份。
export const ensureRuleLists = async (
  ctx,
  paths,
  routing,
  { fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {} } = {},
) => {
  const wanted = collectRuleListUrls(routing)
  if (!wanted.length) return { ok: true, updated: [], failed: [], lists: {} }

  const state = await readState(ctx, paths)
  const next = {}
  const updated = []
  const failed = []
  const errText = (error) => (error instanceof Error ? error.message : String(error))
  for (const item of wanted) {
    const prev = state[item.tag]
    const exists = (await ctx.exists(`${paths.rulesetDir}/${item.tag}.srs`))
      || (await ctx.exists(`${paths.rulesetDir}/${ruleListIpTag(item.tag)}.srs`))
    const upToDate = exists && prev && prev.url === item.url && now() - Number(prev.at || 0) < REFRESH_MS
    if (upToDate && prev.split === SPLIT_VERSION) {
      next[item.tag] = prev
      continue
    }
    if (upToDate) {
      // 名单不旧、只是老版式:离线重编,不碰网络
      try {
        const counts = await resplitLegacy(ctx, paths, item.tag)
        next[item.tag] = { ...prev, counts, split: SPLIT_VERSION }
        updated.push(item.tag)
        log(`[rule-list] ${item.tag} 由老版式重编为域名 / IP 两份`)
        continue
      } catch (error) {
        log(`[rule-list] ${item.tag} 老版式重编失败(${errText(error)}),改为重新拉取`)
      }
    }
    try {
      const counts = await compileOne(ctx, paths, item, fetchImpl)
      next[item.tag] = { url: item.url, at: now(), counts, split: SPLIT_VERSION }
      updated.push(item.tag)
      log(`[rule-list] ${item.url} → ${item.tag}(${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`)
    } catch (error) {
      const message = errText(error)
      failed.push({ tag: item.tag, url: item.url, message })
      if (!exists) {
        return { ok: false, updated, failed, message: `规则集链接拉取失败:${item.url} —— ${message}` }
      }
      // 有旧的就接着用:名单在别人服务器上,不该因为对方今天抽风就让部署失败。
      // 旧的是老版式就顺手离线拆一下,DNS 规则才引用得到纯域名那份。
      let entry = prev || { url: item.url, at: 0 }
      if (entry.split !== SPLIT_VERSION) {
        try {
          entry = { ...entry, counts: await resplitLegacy(ctx, paths, item.tag), split: SPLIT_VERSION }
          log(`[rule-list] ${item.tag} 由老版式重编为域名 / IP 两份`)
        } catch (e2) {
          log(`[rule-list] ${item.tag} 老版式重编失败(${errText(e2)})`)
        }
      }
      next[item.tag] = entry
      log(`[rule-list] ${item.url} 拉取失败(${message}),沿用本地已有的那份`)
    }
  }
  await ctx.writeFile(listStatePath(paths), JSON.stringify(next, null, 2))
  const lists = {}
  for (const [tag, entry] of Object.entries(next)) {
    // 老版式(没有 split 标记)的本地文件是域名 IP 混在一起的一份,形状说不清,不填
    if (entry && entry.split === SPLIT_VERSION && entry.counts) lists[tag] = ruleListShape(entry.counts)
  }
  return { ok: true, updated, failed, lists }
}
