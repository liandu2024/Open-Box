// Open-Box 自身升级 + Geo 规则集刷新的系统层。
//
// 升级本身交给随包发布的 scripts/update.sh(--detach 后台跑、--cancel 协作式取消、
// /tmp/openbox-update.status 报进度),面板只负责:读版本、探最新版、发起/取消、
// 读进度。这样 LuCI 兜底页和面板用的是同一条升级路径,不会各有一套坑。
import { downloadRuleset, RULESET_MIRRORS } from './rulesets.mjs'

export const REPO = 'liandu2024/Open-Box'
const RELEASES_LATEST = `https://github.com/${REPO}/releases/latest`

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
const RUNNING_STAGES = new Set(['starting', 'probing', 'downloading', 'verifying', 'extracting', 'committing'])
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
    running: RUNNING_STAGES.has(kv.stage || ''),
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

// 最新版本:不查 api.github.com(限流、镜像站不代理),而是看 releases/latest 的
// 302 跳转指向 /releases/tag/<tag>——几十字节就能拿到 tag。直连不通就依次试镜像。
export const fetchLatestVersion = async (fetchImpl = globalThis.fetch, { mirrors = RULESET_MIRRORS, timeoutMs = 8000 } = {}) => {
  const candidates = ['', ...mirrors.map((m) => (m.endsWith('/') ? m : `${m}/`))]
  let lastError = ''
  for (const prefix of candidates) {
    const url = `${prefix}${RELEASES_LATEST}`
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

// Geo 规则集刷新:把当前配置里所有本地规则集重新下载一遍(全部下完再落盘,
// 半途失败不留下混着新旧的状态)。返回 {updated, failed}。
export const refreshRulesets = async (ctx, paths, { fetchImpl = globalThis.fetch } = {}) => {
  let config
  try {
    config = JSON.parse(await ctx.readFile(paths.configPath))
  } catch {
    return { updated: [], failed: [], message: '还没有生成过配置,没有可更新的规则集' }
  }
  const entries = ((config.route && config.route.rule_set) || []).filter((e) => e && e.type === 'local' && e.tag && e.path)
  const updated = []
  const failed = []
  const blobs = []
  for (const entry of entries) {
    try {
      blobs.push([entry, await downloadRuleset(fetchImpl, entry.tag)])
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
  return { updated, failed, total: entries.length }
}

export const readJsonFile = async (ctx, path, fallback = {}) => {
  try { return JSON.parse(await ctx.readFile(path)) } catch { return fallback }
}
export const writeJsonFile = async (ctx, path, data) => {
  const dir = path.slice(0, path.lastIndexOf('/'))
  if (dir) await ctx.mkdirp(dir)
  await ctx.writeFile(path, JSON.stringify(data))
}
