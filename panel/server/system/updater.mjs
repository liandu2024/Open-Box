// Open-Box 自身升级 + Geo 规则集刷新的系统层。
//
// 升级本身交给随包发布的 scripts/update.sh(--detach 后台跑、--cancel 协作式取消、
// /tmp/openbox-update.status 报进度),面板只负责:读版本、探最新版、发起/取消、
// 读进度。这样 LuCI 兜底页和面板用的是同一条升级路径,不会各有一套坑。
import { downloadRuleset, RULESET_MIRRORS, SOURCE_MARKER, RULESET_SOURCE } from './rulesets.mjs'
import { isRuleListTag } from '../engine/rule-list.mjs'

export const REPO = 'liandu2024/Open-Box'

// Geo 规则集分两类(geosite / geoip),现在都来自 MetaCubeX 同一个仓库(见 system/rulesets.mjs),
// 版本号是那个仓库 sing 分支最近一次提交,两类记同一个值。
export const GEO_REPOS = Object.freeze([
  { key: 'geosite', prefix: 'geosite-' },
  { key: 'geoip', prefix: 'geoip-' },
])

// 下载通道 → 来源前缀顺序('' 是直连):
//   direct 只直连;mirror 只走镜像(安装时用过的那个排最前);
//   auto 沿用安装通道:装的时候走镜像就先镜像后直连,否则先直连后镜像。
export const geoSources = (channel = 'auto', installed = { mode: 'direct', prefix: '' }) => {
  const mirrors = RULESET_MIRRORS.filter(Boolean)
  const known = installed && installed.prefix && mirrors.includes(installed.prefix) ? installed.prefix : ''
  const ordered = known ? [known, ...mirrors.filter((m) => m !== known)] : mirrors
  if (channel === 'direct') return ['']
  if (channel === 'mirror') return ordered
  return installed && installed.mode === 'mirror' ? [...ordered, ''] : ['', ...mirrors]
}

export const parseKeyValues = (text) => {
  const out = {}
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf('=')
    if (i === -1) continue
    out[line.slice(0, i)] = line.slice(i + 1)
  }
  return out
}

// 版本号:发布包是 vX.Y.Z,开发部署是 git describe 的 vX.Y.Z-N-gHASH;只比前三段。
export const parseVersion = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
export const compareVersions = (a, b) => {
  const pa = parseVersion(a), pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

export const readMeta = async (ctx, paths) => {
  try {
    const meta = JSON.parse(await ctx.readFile(paths.metaPath))
    return meta && typeof meta === 'object' ? meta : {}
  } catch {
    return {}
  }
}

export const readChannel = async (ctx, paths) => {
  try {
    const [mode, prefix] = (await ctx.readFile(paths.channelPath)).split('\n')
    return { mode: mode === 'mirror' ? 'mirror' : 'direct', prefix: (prefix || '').trim() }
  } catch {
    return { mode: 'direct', prefix: '' }
  }
}

// /tmp/openbox-update.status:pid= stage= bytes= total= message=
// 与 scripts/update.sh 的 write_status 一致。restarting_core 是面板重启之后、内核按新版本
// 重新部署的那一段(约 20 秒):必须算"进行中",否则前端会当升级已结束而提前刷新页面。
const RUNNING_STAGES = new Set(['starting', 'probing', 'downloading', 'verifying', 'extracting', 'committing', 'restarting_core'])
const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return Boolean(err && err.code === 'EPERM')
  }
}

export const readUpdateStatus = async (ctx, paths) => {
  let raw = ''
  try { raw = await ctx.readFile(paths.updateStatusPath) } catch { return { stage: '', running: false } }
  const kv = parseKeyValues(raw)
  const num = (v) => (/^\d+$/.test(v || '') ? Number(v) : null)
  return {
    stage: kv.stage || '',
    pid: kv.pid || '',
    bytes: num(kv.bytes),
    total: num(kv.total),
    message: kv.message || '',
    // worker 被 OOM / 断电杀掉时状态文件会永远停在 downloading 之类:pid 已经不在就不算进行中,
    // 否则面板一直 409「已有一次更新在进行中」直到重启路由器
    running: RUNNING_STAGES.has(kv.stage || '') && (!kv.pid || pidAlive(Number(kv.pid))),
  }
}

export const readUpdateLogTail = async (ctx, paths, lines = 30) => {
  try {
    const all = (await ctx.readFile(paths.updateLogPath)).split('\n')
    return all.slice(-lines).join('\n').trim()
  } catch {
    return ''
  }
}

// 发起升级:update.sh --detach 自己 fork 到后台并立刻返回;真正的进度看状态文件。
export const startUpdate = async (ctx, paths, channel = 'auto', { expect = '' } = {}) => {
  const args = [paths.updateScript, '--detach']
  if (channel === 'direct') args.push('--direct')
  else if (channel === 'mirror') args.push('--mirror')
  // 把探到的最新 tag 交给脚本:它据此下载带版本号的资产,并在解包后核对版本,
  // 镜像缓存的旧包过不了这一关(见 update.sh 里 EXPECT_VERSION 的说明)
  if (expect && /^[A-Za-z0-9._-]+$/.test(expect)) args.push('--expect', expect)
  const r = await ctx.exec('sh', args, { timeoutMs: 20_000 })
  return { ok: r.code === 0, code: r.code, output: `${r.stdout}${r.stderr}`.trim() }
}

export const cancelUpdate = async (ctx, paths) => {
  const r = await ctx.exec('sh', [paths.updateScript, '--cancel'], { timeoutMs: 20_000 })
  return { result: (r.stdout || '').trim().split('\n').pop() || 'none' }
}

// 某个 GitHub 仓库的最新 tag:不查 api.github.com(限流、镜像站不代理),而是看
// releases/latest 的 302 跳转指向 /releases/tag/<tag>——几十字节就能拿到 tag。
// sources 是来源前缀顺序('' 直连),依次试到拿到为止。
export const fetchLatestTag = async (fetchImpl, repo, { sources = ['', ...RULESET_MIRRORS.filter(Boolean)], timeoutMs = 8000 } = {}) => {
  let lastError = ''
  for (const source of sources) {
    const prefix = source && !source.endsWith('/') ? `${source}/` : source
    const url = `${prefix}https://github.com/${repo}/releases/latest`
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let res
      try {
        res = await fetchImpl(url, { method: 'HEAD', redirect: 'manual', signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      const location = res.headers.get('location') || ''
      let tag = /\/releases\/tag\/([^/?#]+)/.exec(location)?.[1]
      // 有的镜像会把跳转吃掉直接返回落地页:从最终 URL 里再找一次
      if (!tag && res.url) tag = /\/releases\/tag\/([^/?#]+)/.exec(res.url)?.[1]
      if (tag) return { latest: decodeURIComponent(tag), via: prefix || 'direct' }
      lastError = `HTTP ${res.status}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  throw new Error(`没能取到最新版本号:${lastError || '所有来源均不可用'}`)
}

// Open-Box 自身的最新版:直连不通就依次试镜像
export const fetchLatestVersion = async (fetchImpl = globalThis.fetch, { mirrors = RULESET_MIRRORS, timeoutMs = 8000 } = {}) =>
  fetchLatestTag(fetchImpl, REPO, { sources: ['', ...mirrors.filter(Boolean)], timeoutMs })

// 配置里用到了哪几个 Geo 仓库(按 rule_set 的 tag 前缀);没生成过配置就当两个都用
const usedGeoRepos = async (ctx, paths) => {
  try {
    const config = JSON.parse(await ctx.readFile(paths.configPath))
    const tags = ((config.route && config.route.rule_set) || []).filter((e) => e && e.type === 'local' && e.tag).map((e) => e.tag)
    const used = GEO_REPOS.filter((r) => tags.some((t) => t.startsWith(r.prefix)))
    return used.length ? used : GEO_REPOS
  } catch {
    return GEO_REPOS
  }
}

// MetaCubeX 的 release tag 永远叫 latest,版本只能看 sing 分支最近一次提交:日期 + 短 sha。
// api.github.com 加速站不代理,只能直连;探不到就当"不知道新旧"(hasUpdate),让用户能更一次。
const METACUBEX_COMMITS_API = 'https://api.github.com/repos/MetaCubeX/meta-rules-dat/commits/sing'
export const fetchMetacubexVersion = async (fetchImpl, { timeoutMs = 8000 } = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(METACUBEX_COMMITS_API, { headers: { accept: 'application/vnd.github+json' }, signal: controller.signal })
    if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : '无响应'}`)
    const body = await res.json()
    const sha = String(body.sha || '').slice(0, 8)
    const date = String(body.commit?.committer?.date || body.commit?.author?.date || '').slice(0, 10)
    if (!sha || !date) throw new Error('响应里没有提交信息')
    return { latest: `${date} ${sha}`, via: 'direct' }
  } finally {
    clearTimeout(timer)
  }
}

// 探 Geo 规则集有没有新版:MetaCubeX sing 分支最近一次提交 对比本地上次下载时记下的版本。
// 本地没记过、或记的是以前官方来源的版本号(不可比)就当有新版;探不到上游也当有新版——
// 不知道新旧,只能让用户能更一次。返回 { current, latest, hasUpdate, via, used, source }。
export const checkGeoUpdate = async (ctx, paths, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) => {
  const [state, used] = await Promise.all([readJsonFile(ctx, paths.geoUpdateStatePath, {}), usedGeoRepos(ctx, paths)])
  const current = state && state.source === RULESET_SOURCE ? state.versions || {} : {}
  let probe = null
  try {
    probe = await fetchMetacubexVersion(fetchImpl, { timeoutMs })
  } catch {
    probe = null
  }
  const latest = probe ? Object.fromEntries(used.map((r) => [r.key, probe.latest])) : {}
  const hasUpdate = !probe || used.some((r) => latest[r.key] !== current[r.key])
  return { current, latest, hasUpdate, via: probe ? probe.via : 'unknown', used: used.map((r) => r.key), source: RULESET_SOURCE }
}

// Geo 规则集刷新:把当前配置里所有本地规则集按所选通道重新下载一遍(全部下完再落盘,
// 半途失败不留下混着新旧的状态)。返回 {updated, failed, total, versions}:
// versions 是这次下到的上游 tag(传入 latest 就直接记;没传就自己探一次,探不到留空,
// 下次检查会当作"不知道新旧"),调用方把它写进 geo-update.json 当"当前版本"。
export const refreshRulesets = async (ctx, paths, { fetchImpl = globalThis.fetch, channel = 'auto', latest = null } = {}) => {
  const src = RULESET_SOURCE
  let config
  try {
    config = JSON.parse(await ctx.readFile(paths.configPath))
  } catch {
    return { updated: [], failed: [], versions: {}, message: '还没有生成过配置,没有可更新的规则集' }
  }
  // 只管 Geo 那几份(geoip-* / geosite-*)。list-* 是「规则集链接」:由 system/rule-lists.mjs 从
  // 用户填的网址下载、编译,不在 MetaCubeX 上——部署路径(rulesets.mjs 的 ensureRulesets)早就
  // 跳过了它,这条更新路径以前漏了,每次 Geo 更新都给它记一条"只认识 geoip-/geosite- 前缀"的失败。
  const entries = ((config.route && config.route.rule_set) || []).filter((e) => e && e.type === 'local' && e.tag && e.path && !isRuleListTag(e.tag))
  const mirrors = geoSources(channel, await readChannel(ctx, paths))
  let versions = latest && typeof latest === 'object' ? { ...latest } : null
  if (!versions) {
    try {
      versions = (await checkGeoUpdate(ctx, paths, { fetchImpl })).latest
    } catch {
      versions = {}
    }
  }
  const updated = []
  const failed = []
  const blobs = []
  for (const entry of entries) {
    try {
      blobs.push([entry, await downloadRuleset(fetchImpl, entry.tag, { mirrors })])
    } catch (err) {
      failed.push({ tag: entry.tag, message: err instanceof Error ? err.message : String(err) })
    }
  }
  for (const [entry, data] of blobs) {
    const dir = entry.path.slice(0, entry.path.lastIndexOf('/'))
    if (dir) await ctx.mkdirp(dir)
    await ctx.writeFileBinary(entry.path, data)
    updated.push(entry.tag)
  }
  // 全部下成功才算这个目录属于该来源(部分失败时混着新旧,标记留旧的,下次部署会整体重下)
  if (entries.length && !failed.length) {
    const dir = entries[0].path.slice(0, entries[0].path.lastIndexOf('/'))
    if (dir) await ctx.writeFile(`${dir}/${SOURCE_MARKER}`, `${src}\n`)
  }
  // 有失败的仓库就不记它的版本:文件还是旧的,记了新 tag 下次检查会误判"已是最新"
  for (const repo of GEO_REPOS) {
    if (failed.some((f) => f.tag.startsWith(repo.prefix))) delete versions[repo.key]
  }
  return { updated, failed, total: entries.length, versions, source: src }
}

// 部署时 ensureRulesets 自动下载了规则集(新装机第一次启动、换来源):探一次上游版本记进 geo-update.json,
// 让「当前版本」不再是「未知」。探不到就不写(留着「未知」比记一个错的强)。返回记下的版本表或 null
export const recordGeoVersionsAfterDownload = async (ctx, paths, { fetchImpl = globalThis.fetch, downloaded = [], source = RULESET_SOURCE, timeoutMs = 8000 } = {}) => {
  const { latest, via } = await checkGeoUpdate(ctx, paths, { fetchImpl, timeoutMs })
  if (!latest || !Object.keys(latest).length || via === 'unknown') return null
  const previous = await readJsonFile(ctx, paths.geoUpdateStatePath, {})
  const record = {
    ...previous,
    lastAt: new Date().toISOString(),
    updated: [...downloaded],
    failed: [],
    restarted: false,
    trigger: 'deploy',
    channel: previous.channel || 'auto',
    versions: { ...(previous.source === source ? previous.versions || {} : {}), ...latest },
    source,
  }
  await writeJsonFile(ctx, paths.geoUpdateStatePath, record)
  return record.versions
}

export const readJsonFile = async (ctx, path, fallback = {}) => {
  try { return JSON.parse(await ctx.readFile(path)) } catch { return fallback }
}
export const writeJsonFile = async (ctx, path, data) => {
  const dir = path.slice(0, path.lastIndexOf('/'))
  if (dir) await ctx.mkdirp(dir)
  await ctx.writeFile(path, JSON.stringify(data))
}
