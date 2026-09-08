import express from 'express'
import path from 'node:path'
import { configMetaPath, TUN_DEVICE } from '../system/deploy.mjs'

// 「导出诊断包」:把定位一个问题需要的东西一次打成一个 JSON——面板 / 内核版本、固件和架构、
// 内存和存储、内核在不在跑、脱敏后的内核配置、分流设置、最近一次部署结果、nft 表、有没有别的
// 代理插件、内核和面板最近的日志。GitHub 上的反馈来回问三四轮都拿不齐这些,而每一项都只是
// 路由器上的一条命令。
//
// 一律脱敏,这个包是要贴到公开 issue 里的:密码 / 密钥 / UUID / clash 密钥全部抹成 ***,
// 节点和订阅的地址只留占位。节点的主机名还会出现在直连规则的域名表和日志里("lookup xxx"),
// 所以先从出站里收齐主机名,再把它们在整个包里逐个替换,不只靠字段名。

const SECRET_KEY = /^(password|passwd|uuid|secret|token|private_key|public_key|pre_shared_key|psk|key|auth|auth_str|obfs_password|short_id|certificate|certificate_path|key_path)$/i
const HOST_KEY = /^(server|server_name|sni|host|hosts)$/i
const URL_KEY = /^(url|link|ruleUrls|urls)$/i

const redactUrl = (value) => {
  try {
    const u = new URL(value)
    return `${u.protocol}//<host>${u.pathname && u.pathname !== '/' ? '/…' : ''}`
  } catch {
    return '<url>'
  }
}

// 递归脱敏:按字段名把秘密抹掉、主机名换成占位;数组元素沿用父级的字段名判断。
// dns 这一段例外:里面的 server 是公共解析器地址(223.5.5.5)或 DNS 服务器的 tag(dns-proxy),
// 不是节点地址,而且"上游 DNS 是谁、哪条规则走哪个 DNS"正是排 DNS 问题时最要看的
export const redact = (value, key = '', inDns = false) => {
  if (Array.isArray(value)) return value.map((v) => redact(v, key, inDns))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k, inDns || key === 'dns')
    return out
  }
  if (typeof value === 'string' && value) {
    if (SECRET_KEY.test(key)) return '***'
    if (HOST_KEY.test(key) && !inDns) return '<host>'
    if (URL_KEY.test(key)) return redactUrl(value)
  }
  return value
}

// 出站里的服务器主机名 / IP:它们还会出现在直连规则和日志里,要在整个包里替换掉
const collectNodeHosts = (config) => {
  const hosts = new Set()
  for (const list of [config?.outbounds, config?.endpoints]) {
    for (const o of Array.isArray(list) ? list : []) {
      if (o && typeof o.server === 'string' && o.server) hosts.add(o.server)
      for (const p of Array.isArray(o?.peers) ? o.peers : []) if (p && typeof p.address === 'string' && p.address) hosts.add(p.address)
    }
  }
  return [...hosts].filter((h) => h.length >= 4)
}

// 出站里的秘密原文(密码 / UUID / 密钥 / clash 密钥):正常情况日志里不会有,但万一某条错误
// 把它打出来了,也得在整个包里抹掉,不能只靠字段名
const collectSecrets = (value, key = '', out = new Set()) => {
  if (Array.isArray(value)) value.forEach((v) => collectSecrets(v, key, out))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) collectSecrets(v, k, out)
  else if (typeof value === 'string' && value.length >= 6 && SECRET_KEY.test(key)) out.add(value)
  return out
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const replaceAll = (text, values, placeholder) => {
  let out = String(text)
  for (const v of values) out = out.replace(new RegExp(escapeRegExp(v), 'g'), placeholder)
  return out
}
export const scrubHosts = (text, hosts) => replaceAll(text, hosts, '<node-host>')
export const scrubText = (text, { hosts, secrets }) => replaceAll(replaceAll(text, secrets, '***'), hosts, '<node-host>')
// 脱敏过的 JSON 再把主机名 / 秘密替换一遍:直连规则的域名表、DNS 规则里都可能原样带着节点主机名
const scrubJson = (value, known) => (value === null || value === undefined ? null : JSON.parse(scrubText(JSON.stringify(value), known)))

const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '')
const tail = (text, n) => stripAnsi(text).split('\n').filter(Boolean).slice(-n).join('\n')

const run = async (ctx, cmd, args = []) => {
  try {
    const { code, stdout, stderr } = await ctx.exec(cmd, args)
    return { code, out: `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim() }
  } catch (err) {
    return { code: -1, out: err instanceof Error ? err.message : String(err) }
  }
}
const readJson = async (ctx, file) => {
  try {
    return JSON.parse(await ctx.readFile(file))
  } catch {
    return null
  }
}

// 常见的会和 Open-Box 抢 tun / nft / DNS 的插件,装没装一目了然
const CONFLICT_SCRIPTS = ['openclash', 'passwall', 'passwall2', 'nikki', 'mihomo', 'shellcrash', 'homeproxy', 'ssr-plus']

export const buildDiagnostics = async ({ store, ctx, paths, now = () => new Date() }) => {
  const config = await readJson(ctx, paths.configPath)
  const profile = (store.getProfile && store.getProfile()) || {}
  // 主机名和秘密从内核配置和档案两边收:档案里有订阅地址、节点密码,内核配置里有 clash 密钥
  const known = {
    hosts: collectNodeHosts(config),
    secrets: [...collectSecrets(config), ...collectSecrets(profile)],
  }
  const scrub = (v) => (typeof v === 'string' ? scrubText(v, known) : v)
  const installRoot = path.dirname(paths.metaPath)

  const [meta, configMeta, board, unamem, meminfo, df, status, procs, nft, kernelLog, panelLog, uptime] = await Promise.all([
    readJson(ctx, paths.metaPath),
    readJson(ctx, configMetaPath(paths)),
    run(ctx, 'ubus', ['call', 'system', 'board']),
    run(ctx, 'uname', ['-m']),
    run(ctx, 'cat', ['/proc/meminfo']),
    run(ctx, 'df', ['-k', installRoot]),
    run(ctx, paths.initd.core, ['status']),
    run(ctx, 'sh', ['-c', 'ps w | grep "[s]ing-box"']),
    run(ctx, 'nft', ['list', 'tables']),
    run(ctx, 'logread', ['-e', 'sing-box']),
    run(ctx, 'sh', ['-c', 'logread | grep -iE "open-box|openbox|node\\["']),
    run(ctx, 'cat', ['/proc/uptime']),
  ])
  const conflicts = []
  for (const name of CONFLICT_SCRIPTS) if (await ctx.exists(`/etc/init.d/${name}`)) conflicts.push(name)

  let boardJson = null
  try { boardJson = JSON.parse(board.out) } catch { /* 不是 OpenWrt 或 ubus 不在 */ }
  const memLine = (name) => {
    const m = new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(meminfo.out)
    return m ? `${Math.round(Number(m[1]) / 1024)} MB` : null
  }

  return {
    format: 'open-box-diagnostics',
    generatedAt: now().toISOString(),
    versions: {
      openBox: meta?.version ?? null,
      singBox: meta?.singboxVersion ?? null,
      node: meta?.nodeVersion ?? null,
      builtAt: meta?.builtAt ?? null,
    },
    system: {
      board: boardJson ? { model: boardJson.model, board_name: boardJson.board_name, kernel: boardJson.kernel, release: boardJson.release } : board.out,
      arch: unamem.out,
      uptimeSeconds: Number.parseFloat(uptime.out) || null,
      memTotal: memLine('MemTotal'),
      memAvailable: memLine('MemAvailable'),
      disk: df.out,
      tunDevice: await ctx.exists(TUN_DEVICE),
      conflictingPlugins: conflicts,
    },
    kernel: {
      status: status.out,
      processes: scrub(procs.out),
      nftTables: nft.out,
      configMeta,
      config: config ? scrubJson(redact(config), known) : null,
    },
    settings: {
      dns: profile.dns ?? null,
      ipv6: profile.ipv6 ?? null,
      tun: profile.tun ?? null,
      directForNodes: profile.directForNodes ?? null,
      routing: scrubJson(redact(profile.routing ?? null), known),
      clientRoutes: profile.clientRoutes ?? null,
    },
    lastDeploy: store.getDeployState ? store.getDeployState() : null,
    logs: {
      kernel: scrub(tail(kernelLog.out, 200)),
      panel: scrub(tail(panelLog.out, 200)),
    },
  }
}

export const registerDiagnosticsRoutes = (app, { store, ctx, paths }) => {
  const router = express.Router({ caseSensitive: true })
  router.get('/diagnostics', async (_req, res) => {
    try {
      res.json(await buildDiagnostics({ store, ctx, paths }))
    } catch (err) {
      res.status(500).json({ message: err instanceof Error ? err.message : String(err) })
    }
  })
  app.use('/api/openbox', router)
}
