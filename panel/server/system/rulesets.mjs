// 规则集(.srs)供给。
//
// 生成的配置里每条 rule_set 都是 `type: "local"` + 一个 `${rulesetDir}/<tag>.srs` 路径,
// 但此前全项目没有任何地方去创建那些文件——安装脚本没有、更新脚本没有、部署流程也没有。
// 结果是默认档案(直连规则用 geosite-cn / geoip-cn)永远部署不成功,内核在校验阶段就
// FATAL:`parse rule-set[0]: open .../geosite-cn.srs: no such file or directory`(真机
// 192.168.3.35 上实测到的原始报错)。这个模块负责在部署前把缺失的规则集补齐。
//
// 只补缺失的,不做定期更新:已经存在的文件一律不动。规则集会随上游变化,但"每次部署都
// 去 GitHub 拉一遍"会让一个本来纯本地的操作变成依赖外网——机场能连上、GitHub 连不上的
// 场景在国内非常普通,那种情况下部署不该失败。更新规则集是另一件事,应当由用户显式触发。

// 规则集唯一来源:MetaCubeX/meta-rules-dat 的 sing 分支——和 sing-box 官方仓库同一批上游
// (v2fly 社区域名表)再合并 Loyalsoldier 的 gfw / greatfire 等名单,国内 IP 用 ipip.net 的表
// (比官方的 MaxMind 多 1700 多段),.srs 已经编好、每天更新。路径 geo/<kind>/<名字>.srs,
// 文件名不带 geosite-/geoip- 前缀。以前用的是 SagerNet 官方仓库(没有 gfw);两家同名分类
// 内容不同(cn 尤其),所以老安装第一次部署时按目录里的来源标记把规则集整体重下。
import { isRuleListTag } from '../engine/rule-list.mjs'

export const RULESET_SOURCE = 'metacubex'
const KIND_BY_PREFIX = [
  { prefix: 'geoip-', kind: 'geoip' },
  { prefix: 'geosite-', kind: 'geosite' },
]
const RULESET_BASE = 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo'

// 下载来源,依次尝试。空前缀是直连 GitHub;其余三个是 LuCI 升级页同款的加速站——
// 实测三者返回的文件与直连字节完全一致(55506 bytes 的 geosite-cn 逐一比对过)。
export const RULESET_MIRRORS = Object.freeze([
  '',
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://gh.llkk.cc/',
])

const RULESET_FETCH_TIMEOUT_MS = 30000
// 单个规则集的大小上限。目前最大的 geosite-geolocation-!cn 约 164KB,给到 16MB 足够
// 覆盖上游增长,同时挡住"拿到一个几百 MB 的东西把路由器内存吃光"。
const MAX_RULESET_BYTES = 16 * 1024 * 1024

// 独立于 api/profile.mjs 的那道校验再拦一次。档案接口已经用 /^[A-Za-z0-9._-]+$/ 挡住了
// 路径穿越,但这里的性质变了:这个模块会**按 tag 拼出的路径写文件**,一个形如
// `geosite-../../etc/xxx` 的 tag 就是任意文件写入。写盘这件事的安全性不该依赖调用方
// 上游某处校验过——就地再判一次,几乎不要钱。
const SAFE_TAG = /^[A-Za-z0-9._!@-]+$/
export const isSafeRulesetTag = (tag) =>
  typeof tag === 'string' && SAFE_TAG.test(tag) && !tag.includes('..')

// geoip / geosite:tag 前缀决定去哪个目录取
export const rulesetKind = (tag) => {
  if (!isSafeRulesetTag(tag)) return null
  const hit = KIND_BY_PREFIX.find((entry) => tag.startsWith(entry.prefix))
  return hit ? hit.kind : null
}

// tag 里可能含 `!`(如 geosite-geolocation-!cn)。它在 URL 路径里是合法的 sub-delim,
// raw.githubusercontent.com 对原样和 %21 两种形式都返回 200(实测),这里原样传。
// mirrors:来源前缀列表,按顺序试;空串是直连。默认全部来源,更新时按用户选的通道传入
export const rulesetUrls = (tag, mirrors = RULESET_MIRRORS) => {
  const kind = rulesetKind(tag)
  if (!kind) return []
  const path = `${RULESET_BASE}/${kind}/${tag.slice(kind.length + 1)}.srs`
  return mirrors.map((mirror) => (mirror ? `${mirror}${path}` : path))
}

// 把响应体读进内存,但上限要在读之前、读的过程中就卡住:来源里有三个第三方加速站,任一
// 被劫持 / 回源异常吐几百 MB,1GB 内存的路由器在"先整段读完再比大小"时就已经 OOM 了。
// 先看 content-length,再按块累加,超了立刻断开。测试里的假响应只有 arrayBuffer,照旧兼容。
const readBodyLimited = async (res, limit, tag) => {
  const declared = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : 0)
  if (Number.isFinite(declared) && declared > limit) {
    throw new Error(`规则集 ${tag} 超过 ${limit} 字节上限(content-length ${declared})`)
  }
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    const chunks = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        try { await reader.cancel() } catch { /* 断开就行 */ }
        throw new Error(`规则集 ${tag} 超过 ${limit} 字节上限`)
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks, total)
  }
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length > limit) throw new Error(`规则集 ${tag} 超过 ${limit} 字节上限`)
  return data
}

// 单个规则集的下载(多来源依次重试)。除了部署时补齐,「详情」也要用它:用户可能
// 想看一个还没部署过、本地根本没有的分类里有什么。
export const downloadRuleset = async (fetchImpl, tag, { mirrors = RULESET_MIRRORS } = {}) => {
  const urls = rulesetUrls(tag, mirrors)
  if (!urls.length) {
    throw new Error(`未知或不合法的规则集名 ${tag}:只认得 geoip-/geosite- 开头的规则集`)
  }

  let lastError = null
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(RULESET_FETCH_TIMEOUT_MS) })
      if (!res || !res.ok) {
        lastError = new Error(`HTTP ${res ? res.status : '无响应'}`)
        continue
      }
      const data = await readBodyLimited(res, MAX_RULESET_BYTES, tag)
      // 空文件要当失败:某些加速站在回源失败时会返回 200 + 空体,写下去就是一个
      // 看起来存在、实际加载必炸的规则集,而且下次部署会因为"文件已存在"直接跳过。
      if (!data.length) {
        lastError = new Error('响应为空')
        continue
      }
      return data
    } catch (err) {
      lastError = err
    }
  }
  throw new Error(`下载规则集 ${tag} 失败:${(lastError && lastError.message) || '所有来源均不可用'}`)
}

// 按配置里 route.rule_set 的声明补齐缺失的 .srs。直接读配置而不是另算一遍 tag:
// 那是内核真正会去打开的路径清单,两边各算一次迟早会算歪。
// 规则集目录里记一个来源标记:老安装的目录里是 SagerNet 官方的文件(没有标记),同名不同
// 内容,不能再用——第一次部署时把配置用到的规则集整体重下,之后按标记跳过。
export const SOURCE_MARKER = '.source'
const readSourceMarker = async (ctx, dir) => {
  try {
    return (await ctx.readFile(`${dir}/${SOURCE_MARKER}`)).trim()
  } catch {
    return ''
  }
}

export const ensureRulesets = async (ctx, config, { fetchImpl = globalThis.fetch } = {}) => {
  const entries = (config && config.route && config.route.rule_set) || []
  // list- 开头的是「规则集链接」:由 system/rule-lists.mjs 从用户填的网址下载、解析、编译,
  // 不在 MetaCubeX 上,拿它的名字去那边找必然 404。只跳过这一种——其余认不出前缀的名字
  // 仍然要走下面的报错路径(路径穿越那道闸也在那儿)。
  const local = entries.filter(
    (e) => e && e.type === 'local' && e.tag && e.path && !isRuleListTag(e.tag),
  )
  if (!local.length) return { ok: true, downloaded: [] }

  const src = RULESET_SOURCE
  const dir = local[0].path.slice(0, local[0].path.lastIndexOf('/'))
  const switched = dir ? (await readSourceMarker(ctx, dir)) !== src : false

  const missing = []
  for (const entry of local) {
    if (switched || !(await ctx.exists(entry.path))) missing.push(entry)
  }
  if (!missing.length) return { ok: true, downloaded: [], source: src }

  const downloaded = []
  for (const entry of missing) {
    let data
    try {
      data = await downloadRuleset(fetchImpl, entry.tag)
    } catch (err) {
      return { ok: false, downloaded, message: (err && err.message) || String(err) }
    }
    // 先建目录:全新安装时 rulesetDir 整个不存在(真机上就是这样)
    const dir = entry.path.slice(0, entry.path.lastIndexOf('/'))
    if (dir) await ctx.mkdirp(dir)
    await ctx.writeFileBinary(entry.path, data)
    downloaded.push(entry.tag)
  }
  if (dir) await ctx.writeFile(`${dir}/${SOURCE_MARKER}`, `${src}\n`)

  return { ok: true, downloaded, source: src, switched }
}
