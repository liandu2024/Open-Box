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

// 官方预编译的 .srs 仓库。tag 前缀决定去哪个仓库取:sing-box 的 geoip/geosite 规则集
// 是分开发布的两个仓库,文件名就是 tag 本身。
const REPO_BY_PREFIX = [
  { prefix: 'geoip-', repo: 'SagerNet/sing-geoip' },
  { prefix: 'geosite-', repo: 'SagerNet/sing-geosite' },
]

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
const SAFE_TAG = /^[A-Za-z0-9._!-]+$/
export const isSafeRulesetTag = (tag) =>
  typeof tag === 'string' && SAFE_TAG.test(tag) && !tag.includes('..')

export const rulesetRepo = (tag) => {
  if (!isSafeRulesetTag(tag)) return null
  const hit = REPO_BY_PREFIX.find((entry) => tag.startsWith(entry.prefix))
  return hit ? hit.repo : null
}

// tag 里可能含 `!`(如 geosite-geolocation-!cn)。它在 URL 路径里是合法的 sub-delim,
// raw.githubusercontent.com 对原样和 %21 两种形式都返回 200(实测),这里原样传。
export const rulesetUrls = (tag) => {
  const repo = rulesetRepo(tag)
  if (!repo) return []
  const path = `https://raw.githubusercontent.com/${repo}/rule-set/${tag}.srs`
  return RULESET_MIRRORS.map((mirror) => (mirror ? `${mirror}${path}` : path))
}

const downloadOne = async (fetchImpl, tag) => {
  const urls = rulesetUrls(tag)
  if (!urls.length) {
    throw new Error(`未知或不合法的规则集名 ${tag}:只认得 geoip-/geosite- 开头的官方规则集`)
  }

  let lastError = null
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(RULESET_FETCH_TIMEOUT_MS) })
      if (!res || !res.ok) {
        lastError = new Error(`HTTP ${res ? res.status : '无响应'}`)
        continue
      }
      const data = Buffer.from(await res.arrayBuffer())
      // 空文件要当失败:某些加速站在回源失败时会返回 200 + 空体,写下去就是一个
      // 看起来存在、实际加载必炸的规则集,而且下次部署会因为"文件已存在"直接跳过。
      if (!data.length) {
        lastError = new Error('响应为空')
        continue
      }
      if (data.length > MAX_RULESET_BYTES) {
        throw new Error(`规则集 ${tag} 超过 ${MAX_RULESET_BYTES} 字节上限`)
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
export const ensureRulesets = async (ctx, config, { fetchImpl = globalThis.fetch } = {}) => {
  const entries = (config && config.route && config.route.rule_set) || []
  const local = entries.filter((e) => e && e.type === 'local' && e.tag && e.path)
  if (!local.length) return { ok: true, downloaded: [] }

  const missing = []
  for (const entry of local) {
    if (!(await ctx.exists(entry.path))) missing.push(entry)
  }
  if (!missing.length) return { ok: true, downloaded: [] }

  const downloaded = []
  for (const entry of missing) {
    let data
    try {
      data = await downloadOne(fetchImpl, entry.tag)
    } catch (err) {
      return { ok: false, downloaded, message: (err && err.message) || String(err) }
    }
    // 先建目录:全新安装时 rulesetDir 整个不存在(真机上就是这样)
    const dir = entry.path.slice(0, entry.path.lastIndexOf('/'))
    if (dir) await ctx.mkdirp(dir)
    await ctx.writeFileBinary(entry.path, data)
    downloaded.push(entry.tag)
  }

  return { ok: true, downloaded }
}
