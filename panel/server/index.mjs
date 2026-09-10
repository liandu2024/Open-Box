import express from 'express'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { createDnsFilterObserver, createDnsFilterStore } from './system/dns-filter-observer.mjs'
import { readFilterArtifact } from './system/dns-filter.mjs'
import { registerDnsFilterRoutes } from './api/dns-filter.mjs'
import { registerDeployRoutes } from './api/deploy.mjs'
import { registerGroupRoutes } from './api/groups.mjs'
import { registerNodeLatencyRoutes } from './api/node-latency.mjs'
import { registerPenetrationRoutes } from './api/penetration.mjs'
import { registerProfileRoutes } from './api/profile.mjs'
import { registerServiceRoutes } from './api/service.mjs'
import { registerRulesetRoutes } from './api/rulesets.mjs'
import { registerUpdateRoutes } from './api/updates.mjs'
import { registerRouteTestRoutes } from './api/route-test.mjs'
import { registerTerminalTestRoutes } from './api/terminal-test.mjs'
import { teardownProbeNetns } from './system/lan-probe.mjs'
import { registerTrafficRoutes } from './api/traffic.mjs'
import { registerLatencyHistoryRoutes } from './api/latency-history.mjs'
import { createLatencyHistory } from './system/latency-history.mjs'
import { createLatencyScheduler } from './system/latency-scheduler.mjs'
import { createFailoverManager } from './system/failover-manager.mjs'
import { createDnsRewriteServer } from './system/dns-rewrite-server.mjs'
import { DNS_REWRITE_TAG, ensureDnsRewriteDefaults } from './engine/dns-rewrite.mjs'
import { ensureTestUrlDefaults } from './engine/test-url.mjs'
import { decideDnsServer } from './api/route-test.mjs'
import { readSystemDns } from './system/resolv.mjs'
import { registerFailoverRoutes } from './api/failover.mjs'
import { registerServerRoutes } from './api/servers.mjs'
import { registerBackupRoutes } from './api/backup.mjs'
import { registerDiagnosticsRoutes } from './api/diagnostics.mjs'
import { readMeta } from './system/updater.mjs'
import { seedDefaultStorage } from './system/seed-defaults.mjs'
import { runDeploy, fetchSelections, resolveSelections, regenerateIfPlanChanged } from './api/deploy-runner.mjs'
import { flushDnsCache } from './system/dns-cache.mjs'
import { startScheduler } from './system/scheduler.mjs'
import { createTrafficCollector, createTrafficStore } from './system/traffic-collector.mjs'
import { registerSubscriptionRoutes } from './api/subscriptions.mjs'
import { subscriptionFetch } from './system/insecure-fetch.mjs'
import { createStore } from './store/openbox-store.mjs'
import { createRealContext } from './system/context-real.mjs'
import { createPaths } from './system/paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const dataDir = path.join(rootDir, 'data')
const dbPath = process.env.ZASHBOARD_DB_PATH || path.join(dataDir, 'zashboard.sqlite')
const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || 2026)
// Open-Box 只管理本机唯一的 sing-box,clash_api 固定监听 127.0.0.1:9095;
// 环境变量覆盖仅用于测试(指向假上游),生产环境不应设置。
const DEFAULT_CLASH_API_BASE = process.env.OPENBOX_CLASH_API_BASE || 'http://127.0.0.1:9095'
const backgroundImageStorageKey = '__background_image__'
const ACCESS_PASSWORD_ENABLED_KEY = 'config/access-password-enabled'
const ACCESS_PASSWORD_KEY = 'config/access-password'
const ACCESS_SESSION_COOKIE_NAME = 'openbox_access_session'
const ACCESS_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const ACCESS_PASSWORD_REQUIRED_CODE = 'ACCESS_PASSWORD_REQUIRED'
const ACCESS_PASSWORD_INVALID_CODE = 'ACCESS_PASSWORD_INVALID'
const PASSWORD_SETUP_REQUIRED_CODE = 'PASSWORD_SETUP_REQUIRED'
const PASSWORD_ALREADY_SET_CODE = 'PASSWORD_ALREADY_SET'
const PASSWORD_TOO_SHORT_CODE = 'PASSWORD_TOO_SHORT'
const MIN_ACCESS_PASSWORD_LENGTH = 4
// 首次访问强制设密:密码尚未设置前,除这三条(健康检查 + 查询状态 + 设密本身)外,
// 一切 /api/* 一律拒绝 —— 面板对路由器有 root 级权限,不能裸奔。
const PASSWORD_SETUP_EXEMPT_PATHS = new Set(['/api/health', '/api/auth/status', '/api/auth/setup'])
const serviceWorkerCleanupScript = `
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheKeys = await caches.keys()
    await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)))
    await self.registration.unregister()
    const clientsList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })
    await Promise.all(
      clientsList.map((client) => {
        if ('navigate' in client) {
          return client.navigate(client.url)
        }

        return Promise.resolve()
      }),
    )
  })())
})
`.trim()
const registerSWCleanupScript = `
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) =>
      Promise.allSettled(registrations.map((registration) => registration.unregister())),
    )
    .then(() => ('caches' in window ? caches.keys() : Promise.resolve([])))
    .then((cacheKeys) => Promise.allSettled(cacheKeys.map((cacheKey) => caches.delete(cacheKey))))
    .catch(() => {})
}
`.trim()

fs.mkdirSync(path.dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath, { timeout: 5000 })

db.exec(`
  CREATE TABLE IF NOT EXISTS app_storage (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`)

const getSnapshotStatement = db.prepare(`
  SELECT key, value
  FROM app_storage
  ORDER BY key
`)

const insertSnapshotStatement = db.prepare(`
  INSERT INTO app_storage (key, value, updated_at)
  VALUES (?, ?, CURRENT_TIMESTAMP)
`)

const upsertStorageValueStatement = db.prepare(`
  INSERT INTO app_storage (key, value, updated_at)
  VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = CURRENT_TIMESTAMP
`)

const getStorageValueStatement = db.prepare(`
  SELECT value
  FROM app_storage
  WHERE key = ?
`)

const deleteStorageValueStatement = db.prepare(`
  DELETE FROM app_storage
  WHERE key = ?
`)

// 全新安装(还没有任何 config/*)时写入随包的默认面板设置和背景图(system/seed-defaults.mjs)
seedDefaultStorage({
  countConfigEntries: () => db.prepare(`SELECT COUNT(*) AS c FROM app_storage WHERE key LIKE 'config/%'`).get().c,
  insert: (key, value) => upsertStorageValueStatement.run(key, value),
  hasKey: (key) => Boolean(getStorageValueStatement.get(key)),
  log: (m) => console.log(m),
})

// openbox-store 复用同一张 app_storage KV 表;controller 代理靠它拿本机 clash_api 的 secret。
const store = createStore({
  get: (key) => getStorageValueStatement.get(key)?.value ?? null,
  set: (key, value) => upsertStorageValueStatement.run(key, value),
  del: (key) => deleteStorageValueStatement.run(key),
})
// DNS 重写第一次引入时补两条默认规则(只在还没初始化的档案上做一次;用户之后改 / 停 / 删都算数)
try {
  if (ensureDnsRewriteDefaults(store)) console.log('[dns-rewrite] 档案首次初始化 DNS 重写,写入默认规则')
} catch (err) {
  console.log(`[dns-rewrite] 初始化默认规则失败:${err instanceof Error ? err.message : err}`)
}
// 测速地址还是老的 http 默认值的换成 https 默认(内核的 clash API 不认 http,见 engine/test-url.mjs)
try {
  if (ensureTestUrlDefaults(store)) console.log('[profile] 测速地址从老的 http 默认值换成 https 默认值')
} catch (err) {
  console.log(`[profile] 迁移测速地址失败:${err instanceof Error ? err.message : err}`)
}

// 会话密钥落库,不是每次启动随机生成:否则升级 / 重启面板 / 路由器重启后进程一换,所有
// 浏览器 cookie 立刻失效、被踢回登录页(升级到"替换文件"阶段面板重启就会当场弹登录)。
// 键在 openbox/ 前缀下(isProtectedStorageKey 保护):不回显给浏览器,也不被设置同步清掉。
// 密钥只用来给会话记录里的 passwordTag 做 HMAC(把会话绑到签发时的密码上,改密即失效)。
const SESSION_SECRET_KEY = 'openbox/session-secret'
const loadOrCreateSessionSecret = () => {
  const existing = getStorageValueStatement.get(SESSION_SECRET_KEY)?.value
  if (typeof existing === 'string' && existing.length >= 32) return existing
  const secret = randomBytes(32).toString('hex')
  upsertStorageValueStatement.run(SESSION_SECRET_KEY, secret)
  return secret
}
const accessSessionSecret = loadOrCreateSessionSecret()

// 会话表也落库(同样在 openbox/ 前缀下):每次登录签发一个随机 id,记下签发时间、到期时间和
// 当时密码的 HMAC。以前的令牌是 HMAC(密钥, 密码)——同一密码下恒定,30 天只写在浏览器
// cookie 的 Max-Age 里,服务端从不看过期,退出登录也只是叫浏览器删 cookie:被拷走的令牌直到
// 改密都有效。现在服务端按记录判有效期、退出即删记录、改密后旧记录的 passwordTag 对不上。
const SESSIONS_KEY = 'openbox/sessions'
const MAX_ACCESS_SESSIONS = 32
const readAccessSessions = () => {
  try {
    const parsed = JSON.parse(getStorageValueStatement.get(SESSIONS_KEY)?.value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
const writeAccessSessions = (sessions) => {
  upsertStorageValueStatement.run(SESSIONS_KEY, JSON.stringify(sessions))
}
const passwordTagOf = (password) => createHmac('sha256', accessSessionSecret).update(password).digest('base64url')
const issueAccessSession = (password) => {
  const now = Date.now()
  const sessions = readAccessSessions()
  // 顺手清掉过期的;活着的太多就丢最早签发的——正常一个人几台设备远到不了这个数
  for (const [id, s] of Object.entries(sessions)) {
    if (!s || typeof s !== 'object' || !(Number(s.expiresAt) > now)) delete sessions[id]
  }
  const alive = Object.entries(sessions).sort((a, b) => Number(a[1].createdAt) - Number(b[1].createdAt))
  while (alive.length >= MAX_ACCESS_SESSIONS) delete sessions[alive.shift()[0]]
  const id = randomBytes(32).toString('hex')
  sessions[id] = { createdAt: now, expiresAt: now + ACCESS_SESSION_MAX_AGE_MS, passwordTag: passwordTagOf(password) }
  writeAccessSessions(sessions)
  return id
}
const revokeAccessSession = (id) => {
  if (!id) return
  const sessions = readAccessSessions()
  if (!(id in sessions)) return
  delete sessions[id]
  writeAccessSessions(sessions)
}

// Open-Box 系统层依赖:paths 描述 OpenWrt 上的固定安装布局,ctx 是真实的 exec/fs 抽象
// (与测试用的 createMockContext 同接口),两者都是无状态的纯对象/闭包,可安全全局复用。
const obPaths = createPaths(process.env.OPENBOX_ROOT || '/opt/open-box')
const obCtx = createRealContext()

const parseStoredBoolean = (value) => {
  if (typeof value !== 'string') {
    return false
  }

  if (value === 'true' || value === '1') {
    return true
  }

  if (value === 'false' || value === '0' || value === '') {
    return false
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1) === 'true'
  }

  return false
}

const parseStoredString = (value) => {
  if (typeof value !== 'string' || value === '') {
    return ''
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value)

      if (typeof parsed === 'string') {
        return parsed
      }
    } catch {
      // Fall back to the raw value below.
    }
  }

  return value
}

const parseCookies = (cookieHeader) => {
  const cookies = new Map()

  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) {
    return cookies
  }

  cookieHeader.split(';').forEach((segment) => {
    const separatorIndex = segment.indexOf('=')

    if (separatorIndex === -1) {
      return
    }

    const key = segment.slice(0, separatorIndex).trim()
    const value = segment.slice(separatorIndex + 1).trim()

    if (!key) {
      return
    }

    cookies.set(key, decodeURIComponent(value))
  })

  return cookies
}

const readAccessAuthConfig = () => {
  const enabledRow = getStorageValueStatement.get(ACCESS_PASSWORD_ENABLED_KEY)
  const passwordRow = getStorageValueStatement.get(ACCESS_PASSWORD_KEY)

  return {
    enabled: parseStoredBoolean(enabledRow?.value),
    password: parseStoredString(passwordRow?.value),
  }
}

const safeTokenEquals = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false
  }

  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

const isAccessSessionAuthenticated = (cookieHeader, password) => {
  if (!password) {
    return false
  }

  const id = parseCookies(cookieHeader).get(ACCESS_SESSION_COOKIE_NAME)

  if (!id) {
    return false
  }

  const session = readAccessSessions()[id]
  if (!session || typeof session !== 'object') return false
  // 服务端自己看过期,不信 cookie 的 Max-Age;绑定签发时的密码,改密后旧会话立即失效
  if (!(Number(session.expiresAt) > Date.now())) return false
  return safeTokenEquals(String(session.passwordTag || ''), passwordTagOf(password))
}

const getRequestAccessAuthStatus = (req) => {
  const config = readAccessAuthConfig()

  if (!config.enabled) {
    return {
      enabled: false,
      authenticated: true,
    }
  }

  return {
    enabled: true,
    authenticated: isAccessSessionAuthenticated(req.headers.cookie, config.password),
  }
}

const getUpgradeAccessAuthStatus = (request) => {
  const config = readAccessAuthConfig()

  if (!config.enabled) {
    return {
      enabled: false,
      authenticated: true,
    }
  }

  return {
    enabled: true,
    authenticated: isAccessSessionAuthenticated(request.headers.cookie, config.password),
  }
}

const setAccessSessionCookie = (res, password) => {
  res.cookie(ACCESS_SESSION_COOKIE_NAME, issueAccessSession(password), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: ACCESS_SESSION_MAX_AGE_MS,
    path: '/',
  })
}

const clearAccessSessionCookie = (res) => {
  res.clearCookie(ACCESS_SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })
}

const sendAccessPasswordRequired = (res) => {
  res.setHeader('Cache-Control', 'no-store')
  clearAccessSessionCookie(res)
  res.status(401).json({
    code: ACCESS_PASSWORD_REQUIRED_CODE,
    message: 'Access password authentication required',
    enabled: true,
    authenticated: false,
  })
}

const sendPasswordSetupRequired = (res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.status(403).json({
    error: PASSWORD_SETUP_REQUIRED_CODE,
  })
}

const writeUpgradePasswordSetupRequired = (socket) => {
  socket.write(
    `HTTP/1.1 403 Forbidden\r
Content-Type: application/json; charset=utf-8\r
Connection: close\r
\r
${JSON.stringify({
  error: PASSWORD_SETUP_REQUIRED_CODE,
})}`,
  )
  socket.destroy()
}

// Open-Box 业务状态(openbox/*:订阅/节点/profile/部署态/clash secret)与访问密码
// (config/access-*)都存在同一张 app_storage KV 表里,但它们不是"前端设置同步"的一部分——
// 前端每次改主题/语言都会全量 PUT /api/storage 覆盖快照,若不把这些键排除在外,一次routine
// 的设置同步就会清空 Open-Box 全部状态、轮换 clash secret(与已部署 config.json 失配),
// 甚至清掉密码本身(→ passwordSet:false → 可被抢先 POST /api/auth/setup 接管面板)。
// 背景图 sentinel 同理不属于"快照"概念,原本就单独用 /api/background-image 管理。
// 三处必须共用同一份判定:读(不回显给浏览器)、写-删(不清空)、写-插(不接受客户端覆盖)。
export const isProtectedStorageKey = (key) => {
  return (
    typeof key === 'string' &&
    (key.startsWith('openbox/') || key.startsWith('config/access-') || key === backgroundImageStorageKey)
  )
}

const readSnapshot = () => {
  const snapshot = {}

  for (const row of getSnapshotStatement.all()) {
    if (isProtectedStorageKey(row.key)) continue
    snapshot[row.key] = row.value
  }

  return snapshot
}

const replaceSnapshot = (entries) => {
  db.exec('BEGIN')

  try {
    for (const row of getSnapshotStatement.all()) {
      if (isProtectedStorageKey(row.key)) continue
      deleteStorageValueStatement.run(row.key)
    }

    for (const [key, value] of Object.entries(entries)) {
      if (isProtectedStorageKey(key)) continue
      insertSnapshotStatement.run(key, value)
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const isValidEntries = (entries) => {
  return (
    entries &&
    typeof entries === 'object' &&
    !Array.isArray(entries) &&
    Object.entries(entries).every(
      ([key, value]) => typeof key === 'string' && typeof value === 'string',
    )
  )
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

const getProxyTarget = (req) => {
  const rawBase = req.header('x-zashboard-target-base')

  // 缺省即本机:Open-Box 只管理唯一的本地 sing-box,secret 从 store 里取。
  // header 仅作为本地调试的逃生舱,传了才以传入为准。
  if (!rawBase) {
    return {
      base: new URL(DEFAULT_CLASH_API_BASE),
      secret: store.getClashSecret(),
    }
  }

  const target = new URL(rawBase)

  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('Only http and https controller targets are supported')
  }

  return {
    base: target,
    secret: req.header('x-zashboard-target-secret') || '',
  }
}

const buildUpstreamUrl = (req, targetBase) => {
  const suffix = req.originalUrl.slice('/api/controller'.length) || '/'
  const normalizedBase = targetBase.toString().replace(/\/$/, '')

  return new URL(`${normalizedBase}${suffix.startsWith('/') ? suffix : `/${suffix}`}`)
}

const buildProxyPath = (basePath, suffix) => {
  const normalizedBasePath = (basePath || '').replace(/\/+$/, '')
  const normalizedSuffix = (suffix || '').replace(/^\/+/, '')

  if (!normalizedBasePath && !normalizedSuffix) {
    return '/'
  }

  if (!normalizedBasePath) {
    return `/${normalizedSuffix}`
  }

  if (!normalizedSuffix) {
    return normalizedBasePath || '/'
  }

  return `${normalizedBasePath}/${normalizedSuffix}`
}

// 代理页改完出口之后要做两件事:把选择读回来(存快照 + 按"选择即默认"写进档案),
// 再看这次改动有没有让磁盘上那份 DNS 规则过期——站点集在"直连"和"代理"之间翻面了就会。
// 翻面了就在后台重新生成配置并重启内核:这一步只能重启(dns.rules 是生成时定死的),
// 但用户不必知道,也不用自己去点。在代理线路之间换(香港 → 美国)不算翻面,不重启。
// 连点几下只跑最后一次:每次点都重启内核的话,一轮切换下来要断好几次流。
let selectionSyncTimer = null
const syncSelectionsAfterProxySwitch = () => {
  if (selectionSyncTimer) clearTimeout(selectionSyncTimer)
  selectionSyncTimer = setTimeout(async () => {
    selectionSyncTimer = null
    // 先清 DNS 缓存:缓存里的答案是上一条线路问出来的,换了线路还用它,连上去的 CDN
    // 就不是新线路就近的那个(见 system/dns-cache.mjs)。翻面要重启的情况下重启本身也会
    // 清掉,这里清一次是为了"只换线路、不重启"的那种切换——那才是大多数。
    try {
      await flushDnsCache(fetch, store.getClashSecret())
    } catch {
      // 清不掉不影响下面的同步
    }
    try {
      const selections = resolveSelections(store, await fetchSelections(fetch, store.getClashSecret()))
      // DNS 分类翻面,或第一层计划(入口旁路指纹 / DNS 转发三态 / v6 保护的出口类别)变了,都得重新生成
      // (判断和执行都在 api/deploy-runner.mjs 的 regenerateIfPlanChanged 里)
      await regenerateIfPlanChanged({ store, ctx: obCtx, paths: obPaths, selections, log: (m) => console.log(m) })
    } catch (error) {
      console.warn('[proxies] 同步选择失败:', error instanceof Error ? error.message : error)
    }
  }, 600)
}

const proxyControllerRequest = async (req, res) => {
  try {
    const { base, secret } = getProxyTarget(req)
    const upstreamUrl = buildUpstreamUrl(req, base)
    const headers = new Headers()

    Object.entries(req.headers).forEach(([key, value]) => {
      const normalizedKey = key.toLowerCase()

      if (
        HOP_BY_HOP_HEADERS.has(normalizedKey) ||
        normalizedKey.startsWith('x-zashboard-target-')
      ) {
        return
      }

      if (Array.isArray(value)) {
        headers.set(key, value.join(', '))
        return
      }

      if (typeof value === 'string') {
        headers.set(key, value)
      }
    })

    if (secret) {
      headers.set('Authorization', `Bearer ${secret}`)
    } else {
      headers.delete('Authorization')
    }

    const response = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body:
        req.method === 'GET' || req.method === 'HEAD'
          ? undefined
          : Buffer.isBuffer(req.body) && req.body.length
            ? req.body
            : undefined,
    })

    res.status(response.status)

    response.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value)
      }
    })

    const body = Buffer.from(await response.arrayBuffer())
    res.send(body)

    // 代理页切换 / 重置了某个 selector 的出口:马上把内核里的选择读回来存快照、按"选择即默认"
    // 写进档案(api/deploy-runner.mjs)。不等每分钟一次的计划任务——刚切完就升级 / 重启时,
    // 生成配置用的是快照,晚一分钟就是一份错的 DNS 规则。
    if (response.ok && (req.method === 'PUT' || req.method === 'DELETE') && /\/proxies\//.test(req.path || req.url || '')) {
      syncSelectionsAfterProxySwitch()
    }
  } catch (error) {
    res.status(502).json({
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

const getWebSocketProxyTarget = (requestUrl) => {
  const targetBaseRaw = requestUrl.searchParams.get('targetBase')

  // 同 getProxyTarget:缺省即本机 clash_api,query 仅作为本地调试逃生舱。
  if (!targetBaseRaw) {
    return {
      base: new URL(DEFAULT_CLASH_API_BASE),
      secret: store.getClashSecret(),
    }
  }

  const targetBase = new URL(targetBaseRaw)

  if (!['http:', 'https:'].includes(targetBase.protocol)) {
    throw new Error('Only http and https controller targets are supported')
  }

  return {
    base: targetBase,
    secret: requestUrl.searchParams.get('secret') || '',
  }
}

const buildUpstreamWebSocketUrl = (requestUrl, targetBase, secret) => {
  const suffix = requestUrl.pathname.slice('/api/controller-ws'.length) || '/'
  const upstreamUrl = new URL(targetBase.toString())

  upstreamUrl.protocol = targetBase.protocol === 'https:' ? 'wss:' : 'ws:'
  upstreamUrl.pathname = buildProxyPath(upstreamUrl.pathname, suffix)
  upstreamUrl.search = ''

  requestUrl.searchParams.forEach((value, key) => {
    if (key !== 'targetBase' && key !== 'secret') {
      upstreamUrl.searchParams.append(key, value)
    }
  })

  if (secret) {
    upstreamUrl.searchParams.set('token', secret)
  }

  return upstreamUrl
}

const normalizeCloseCode = (code, fallback = 1000) => {
  if (!Number.isInteger(code)) {
    return fallback
  }

  if (code >= 3000 && code <= 4999) {
    return code
  }

  if (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) {
    return code
  }

  return fallback
}

const closeSocket = (socket, code = 1000, reason = '') => {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close(normalizeCloseCode(code), reason)
  }
}

const closeSocketPair = (left, right, code = 1011, reason = '') => {
  closeSocket(left, code, reason)
  closeSocket(right, code, reason)
}

const relayControllerWebSocket = (clientSocket, request) => {
  let upstreamSocket

  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    const { base, secret } = getWebSocketProxyTarget(requestUrl)
    const upstreamUrl = buildUpstreamWebSocketUrl(requestUrl, base, secret)

    upstreamSocket = new WebSocket(upstreamUrl)

    const closeBoth = (code, reason) => {
      closeSocketPair(clientSocket, upstreamSocket, code, reason)
    }

    clientSocket.on('message', (data, isBinary) => {
      if (upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(data, { binary: isBinary })
      }
    })

    clientSocket.on('close', (code, reason) => {
      closeSocket(upstreamSocket, code, reason?.toString())
    })

    clientSocket.on('error', () => {
      closeBoth(1011, 'Client websocket error')
    })

    upstreamSocket.on('message', (data, isBinary) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(data, { binary: isBinary })
      }
    })

    upstreamSocket.on('close', (code, reason) => {
      closeSocket(clientSocket, code, reason?.toString())
    })

    upstreamSocket.on('error', () => {
      closeBoth(1011, 'Upstream websocket error')
    })
  } catch (error) {
    closeSocket(clientSocket, 1011, error instanceof Error ? error.message : String(error))

    if (upstreamSocket) {
      closeSocket(upstreamSocket, 1011)
    }
  }
}

const app = express()
const server = http.createServer(app)
const websocketServer = new WebSocketServer({ noServer: true })

// Express 默认路由大小写不敏感:GET /API/openbox/profile 会命中 /api/openbox/profile 的路由,
// 但下面守卫中间件若只用精确前缀判断 req.path.startsWith('/api/') 就会放过它——必须在
// 任何路由注册之前关掉大小写不敏感,否则 /API/... 绕过认证守卫却仍能打到真实 handler。
app.set('case sensitive routing', true)

app.use('/api/auth', express.json({ limit: '2kb' }))
// 25MB 的 body 解析器放在鉴权守卫之后(见下方 /api/health 之前):未登录的请求不能先让
// 面板把 25MB 深嵌套 JSON 读进内存再被 401——1GB 内存的路由器几个并发就被打 OOM。

app.get('/api/auth/status', (req, res) => {
  const authStatus = getRequestAccessAuthStatus(req)
  const { password } = readAccessAuthConfig()

  res.setHeader('Cache-Control', 'no-store')

  if (!authStatus.enabled) {
    clearAccessSessionCookie(res)
  }

  res.json({
    ...authStatus,
    passwordSet: Boolean(password),
  })
})

app.post('/api/auth/setup', (req, res) => {
  const { password: existingPassword } = readAccessAuthConfig()

  res.setHeader('Cache-Control', 'no-store')

  if (existingPassword) {
    res.status(409).json({
      error: PASSWORD_ALREADY_SET_CODE,
      message: 'Access password is already configured',
    })
    return
  }

  const inputPassword = typeof req.body?.password === 'string' ? req.body.password : ''

  if (inputPassword.length < MIN_ACCESS_PASSWORD_LENGTH) {
    res.status(400).json({
      error: PASSWORD_TOO_SHORT_CODE,
      message: `Password must be at least ${MIN_ACCESS_PASSWORD_LENGTH} characters`,
    })
    return
  }

  upsertStorageValueStatement.run(ACCESS_PASSWORD_KEY, inputPassword)
  upsertStorageValueStatement.run(ACCESS_PASSWORD_ENABLED_KEY, 'true')

  setAccessSessionCookie(res, inputPassword)
  res.json({
    enabled: true,
    authenticated: true,
    passwordSet: true,
  })
})

// P4a round2 复审 Important 2(连带损伤):C2 修复后 config/access-password 不再能经
// PUT /api/storage 写入(受保护键),但此前服务端只有 setup(已设密则 409)/login/logout,
// 没有任何改密端点——前端设置页却仍绑定这个 key、写入后照常提示"已保存",用户以为改了密码,
// 实际上从未生效。这里补一个真正的改密端点(前端接线归 P4b,见 sdd 清单)。
//
// 和 setup/login/logout 一样注册在通用守卫中间件之前:未设密时这里要能给出专属的 409,
// 而不是被守卫统一拦成 403 PASSWORD_SETUP_REQUIRED。
app.post('/api/auth/change-password', (req, res) => {
  const { password: currentStoredPassword } = readAccessAuthConfig()

  res.setHeader('Cache-Control', 'no-store')

  const lockedMs = authLockedFor(req)
  if (lockedMs > 0) {
    sendAuthLocked(res, lockedMs)
    return
  }

  if (!currentStoredPassword) {
    res.status(409).json({
      error: PASSWORD_SETUP_REQUIRED_CODE,
      message: 'Access password has not been configured yet',
    })
    return
  }

  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : ''
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : ''

  if (!safeTokenEquals(currentPassword, currentStoredPassword)) {
    noteAuthFailure(req)
    res.status(401).json({
      code: ACCESS_PASSWORD_INVALID_CODE,
      message: 'Current password is incorrect',
    })
    return
  }

  if (newPassword.length < MIN_ACCESS_PASSWORD_LENGTH) {
    res.status(400).json({
      error: PASSWORD_TOO_SHORT_CODE,
      message: `New password must be at least ${MIN_ACCESS_PASSWORD_LENGTH} characters`,
    })
    return
  }

  clearAuthFailures(req)
  upsertStorageValueStatement.run(ACCESS_PASSWORD_KEY, newPassword)

  // 会话记录绑定签发时的密码(passwordTag,见 issueAccessSession):改密后旧会话自动
  // 失效,若不在这里重新签发,发起这次改密请求的当前会话本身也会瞬间掉线——必须立刻
  // 签发一份绑定新密码的会话,把当前会话续上。
  setAccessSessionCookie(res, newPassword)

  res.json({
    ok: true,
    enabled: true,
    authenticated: true,
  })
})

// 登录 / 改密的暴力破解防护:按来源 IP 记连续失败次数,5 次起锁定,锁定时长按次数翻倍
// (5 秒起、最长 10 分钟),成功一次清零。面板对路由器有 root 级权限、密码最短只有 4 位,
// 局域网里一台中了木马的设备几百 req/s 几十秒就能穷尽 4 位数字 PIN——没有这道闸不行。
const AUTH_FAIL_THRESHOLD = 5
const AUTH_LOCK_BASE_MS = 5_000
const AUTH_LOCK_MAX_MS = 10 * 60_000
const authFailures = new Map()
const authClientKey = (req) => String((req.socket && req.socket.remoteAddress) || 'unknown')
const authLockedFor = (req) => {
  const rec = authFailures.get(authClientKey(req))
  if (!rec || !rec.until) return 0
  const left = rec.until - Date.now()
  if (left <= 0) return 0
  return left
}
const noteAuthFailure = (req) => {
  const key = authClientKey(req)
  const rec = authFailures.get(key) || { fails: 0, until: 0 }
  rec.fails += 1
  if (rec.fails >= AUTH_FAIL_THRESHOLD) {
    rec.until = Date.now() + Math.min(AUTH_LOCK_MAX_MS, AUTH_LOCK_BASE_MS * 2 ** (rec.fails - AUTH_FAIL_THRESHOLD))
  }
  authFailures.set(key, rec)
  // 别让这张表无限长:只留最近失败过的 1000 个来源
  if (authFailures.size > 1000) authFailures.delete(authFailures.keys().next().value)
}
const clearAuthFailures = (req) => authFailures.delete(authClientKey(req))
const sendAuthLocked = (res, leftMs) => {
  const seconds = Math.ceil(leftMs / 1000)
  res.setHeader('Retry-After', String(seconds))
  res.status(429).json({ code: 'ACCESS_LOCKED', message: `Too many failed attempts, try again in ${seconds}s`, retryAfter: seconds })
}

app.post('/api/auth/login', (req, res) => {
  const { enabled, password } = readAccessAuthConfig()

  res.setHeader('Cache-Control', 'no-store')

  const lockedMs = authLockedFor(req)
  if (lockedMs > 0) {
    sendAuthLocked(res, lockedMs)
    return
  }

  // login/logout 注册在通用守卫之前(它们必须始终可达才能起到登录/登出的作用),
  // 所以"未设密时全部拒绝"这条规则要在这里单独补一次,通用守卫管不到它们。
  if (!password) {
    sendPasswordSetupRequired(res)
    return
  }

  if (!enabled) {
    clearAccessSessionCookie(res)
    res.json({
      enabled: false,
      authenticated: true,
    })
    return
  }

  const inputPassword = typeof req.body?.password === 'string' ? req.body.password : ''

  if (!safeTokenEquals(inputPassword, password)) {
    noteAuthFailure(req)
    clearAccessSessionCookie(res)
    res.status(401).json({
      code: ACCESS_PASSWORD_INVALID_CODE,
      message: 'Invalid access password',
      enabled: true,
      authenticated: false,
    })
    return
  }

  clearAuthFailures(req)
  setAccessSessionCookie(res, password)
  res.json({
    enabled: true,
    authenticated: true,
  })
})

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')

  const { enabled, password } = readAccessAuthConfig()

  if (!password) {
    sendPasswordSetupRequired(res)
    return
  }

  // 退出 = 服务端撤销这个会话,不只是叫浏览器删 cookie:拷走的 cookie 从此也不能用
  revokeAccessSession(parseCookies(req.headers.cookie).get(ACCESS_SESSION_COOKIE_NAME))
  clearAccessSessionCookie(res)
  res.json({
    enabled,
    authenticated: !enabled,
  })
})

app.use((req, res, next) => {
  // 守卫判定本身也要规范化,不能只靠上面的 case-sensitive routing:
  // 折叠重复斜杠(//api/... 同样应被视为 /api/...)+ 转小写,防止任何大小写/斜杠变体绕过。
  const normalizedPath = req.path.toLowerCase().replace(/\/{2,}/g, '/')

  if (!normalizedPath.startsWith('/api/')) {
    next()
    return
  }

  // /api/health、/api/auth/status、/api/auth/setup 永远可达:
  // 不论是否已设密,前端都得能查状态、走设密流程;setup 路由自己会在已设密时拒绝(409)。
  if (PASSWORD_SETUP_EXEMPT_PATHS.has(normalizedPath)) {
    next()
    return
  }

  const { password } = readAccessAuthConfig()

  if (!password) {
    sendPasswordSetupRequired(res)
    return
  }

  if (normalizedPath === '/api/auth/login' || normalizedPath === '/api/auth/logout') {
    next()
    return
  }

  const authStatus = getRequestAccessAuthStatus(req)

  if (!authStatus.enabled || authStatus.authenticated) {
    next()
    return
  }

  sendAccessPasswordRequired(res)
})

app.use('/api/storage', express.json({ limit: '25mb' }))
app.use('/api/background-image', express.json({ limit: '25mb' }))
app.use('/api/controller', express.raw({ type: '*/*', limit: '25mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    dbPath,
  })
})

app.all(/^\/api\/controller(?:\/.*)?$/, proxyControllerRequest)

app.get('/api/storage', (_req, res) => {
  res.json({
    entries: readSnapshot(),
  })
})

app.put('/api/storage', (req, res) => {
  const { entries } = req.body ?? {}

  if (!isValidEntries(entries)) {
    res.status(400).json({
      message: 'entries must be an object with string values',
    })
    return
  }

  replaceSnapshot(entries)

  res.json({
    ok: true,
    count: Object.keys(entries).length,
  })
})

app.get('/api/background-image', (_req, res) => {
  const row = getStorageValueStatement.get(backgroundImageStorageKey)

  res.json({
    image: row?.value || '',
  })
})

app.put('/api/background-image', (req, res) => {
  const { image } = req.body ?? {}

  if (typeof image !== 'string') {
    res.status(400).json({
      message: 'image must be a string',
    })
    return
  }

  upsertStorageValueStatement.run(backgroundImageStorageKey, image)

  res.json({
    ok: true,
    size: image.length,
  })
})

app.delete('/api/background-image', (_req, res) => {
  deleteStorageValueStatement.run(backgroundImageStorageKey)

  res.json({
    ok: true,
  })
})

// Open-Box 业务路由:全部挂在守卫中间件之后、静态资源/SPA fallback 之前,
// 因此天然继承"未设密一律 403、已设密未认证一律 401"的保护,无需各自重复鉴权。
// 订阅拉取用不校验证书的 fetch(自签 / 过期证书的自建订阅也能加),不能传系统 fetch 把它盖掉
registerSubscriptionRoutes(app, { store, fetchImpl: subscriptionFetch })
registerProfileRoutes(app, { store })
registerDeployRoutes(app, { store, ctx: obCtx, paths: obPaths })
registerServiceRoutes(app, { store, ctx: obCtx, paths: obPaths })
registerRulesetRoutes(app, { store, ctx: obCtx, paths: obPaths, fetchImpl: globalThis.fetch })
registerPenetrationRoutes(app, { store, ctx: obCtx, paths: obPaths, fetchImpl: globalThis.fetch })
registerNodeLatencyRoutes(app, { ctx: obCtx, paths: obPaths, store, fetchImpl: globalThis.fetch })
registerGroupRoutes(app, { store })
registerUpdateRoutes(app, { store, ctx: obCtx, paths: obPaths, fetchImpl: globalThis.fetch })
registerRouteTestRoutes(app, { store, ctx: obCtx, paths: obPaths, fetchImpl: globalThis.fetch })
registerTerminalTestRoutes(app, { store, ctx: obCtx, paths: obPaths, fetchImpl: globalThis.fetch })
// 每日流量:面板常驻读内核连接表,按天/节点/域名把字节数记进 cache.db(system/traffic-collector.mjs);
// 采集在 startServer 里才启动,单独 import 本模块(测试)不会去碰内核
const trafficCollector = createTrafficCollector({
  store: createTrafficStore(db),
  fetchImpl: globalThis.fetch,
  getSecret: () => store.getClashSecret(),
  // 保留时长跟着档案走(后端设置里的「分析数据保留时长」),改完一分钟内生效
  getKeepMonths: () => ((store.getProfile() || {}).traffic || {}).keepMonths,
  log: (m) => console.log(m),
})
registerTrafficRoutes(app, { collector: trafficCollector, ctx: obCtx, paths: obPaths, store })
// 延迟历史 + 自动组的硬性定时测速(system/latency-scheduler.mjs):sing-box 的 URLTest 只在有流量时才按
// interval 测,闲置的组停在启动那一次;这里由面板按 interval 定时调内核测,结果记进 openbox/latency-history,
// 所有浏览器共享。和流量采集一样只在 startServer 里启动。
const latencyHistory = createLatencyHistory({ store })
const latencyScheduler = createLatencyScheduler({ store, ctx: obCtx, paths: obPaths, history: latencyHistory, fetchImpl: globalThis.fetch, log: (m) => console.log(m) })
registerLatencyHistoryRoutes(app, { history: latencyHistory, scheduler: latencyScheduler })
// 故障转移组的后台主备管理(system/failover-manager.mjs):按 config.meta.json 里的运行映射定期端到端探测各页签
// 的节点、组内先恢复、组间按顺序转移、主用恢复后切回、全部失败切兜底拒绝。跟随服务端生命周期,浏览器关了照样跑
const failoverManager = createFailoverManager({ store, ctx: obCtx, paths: obPaths, history: latencyHistory, fetchImpl: globalThis.fetch, log: (m) => console.log(m) })
registerFailoverRoutes(app, { manager: failoverManager })
// DNS 重写的应答服务(system/dns-rewrite-server.mjs):内核把命中重写源域名的查询交到 127.0.0.1:7854,这里按档案
// 里此刻的规则生成答案;没命中的按直连侧上游(WAN 下发的 DNS)解析
// 「代理 v6 降为 IPv4」时重写服务要知道源域名按现有分流走不走代理:按已部署的 config.json 里的 DNS 规则判(跳过重写
// 规则本身),配置按 meta.generatedAt 缓存,只在重新部署后重读
let deployedDnsConfig = { version: null, config: null }
const readDeployedConfig = async () => {
  let version = ''
  try { version = String(JSON.parse(await obCtx.readFile(`${obPaths.etc}/config.meta.json`)).generatedAt || '') } catch { version = '' }
  if (deployedDnsConfig.config && deployedDnsConfig.version === version) return deployedDnsConfig.config
  const config = JSON.parse(await obCtx.readFile(obPaths.configPath))
  deployedDnsConfig = { version, config }
  return config
}
const dnsRewriteSourceViaProxy = async (name) => {
  try {
    const config = await readDeployedConfig()
    const d = await decideDnsServer(obCtx, obPaths, config, name, { ignoreServers: [DNS_REWRITE_TAG] })
    if (!d || d.error) return null
    if (d.rejected) return false
    return Boolean(d.viaProxy)
  } catch { return null }
}
const dnsRewriteServer = createDnsRewriteServer({ store, fallbackServers: () => readSystemDns(obCtx).catch(() => []), sourceViaProxy: dnsRewriteSourceViaProxy, log: (m) => console.log(m) })
const dnsFilterData = createDnsFilterStore(db)
const dnsFilterObserver = createDnsFilterObserver({
  data: dnsFilterData, readConfig: readDeployedConfig, getSecret: () => store.getClashSecret(),
  getNames: () => Object.fromEntries((readFilterArtifact(store)?.blocks || []).map((b) => [b.tag, b.name])),
  enabled: async () => {
    try { return JSON.parse(await obCtx.readFile(`${obPaths.etc}/config.meta.json`)).dnsFilter?.enabled === true }
    catch { return false }
  },
})
const dnsFilterUpdater = registerDnsFilterRoutes(app, { store, ctx: obCtx, paths: obPaths, data: dnsFilterData, observer: dnsFilterObserver })
let dnsFilterTimer
registerServerRoutes(app, { store, ctx: obCtx })
// 导出诊断包(后端设置那张卡片):版本、固件、内核状态、脱敏配置、最近日志,给 issue 用
registerDiagnosticsRoutes(app, { store, ctx: obCtx, paths: obPaths })
// 导出 / 导入(后端设置那张卡片):档案 + 节点组,可选订阅和节点
registerBackupRoutes(app, {
  store,
  readVersion: async () => (await readMeta(obCtx, obPaths)).version || '',
  // 面板设置和背景图跟着一起导:和 /api/storage、/api/background-image 用同一套读写
  panelStorage: {
    readEntries: readSnapshot,
    writeEntries: replaceSnapshot,
    getBackground: () => getStorageValueStatement.get(backgroundImageStorageKey)?.value || '',
    setBackground: (image) => (image ? upsertStorageValueStatement.run(backgroundImageStorageKey, image) : deleteStorageValueStatement.run(backgroundImageStorageKey)),
  },
})
// 自动更新计划:每分钟看一眼档案里的计划,到点就做(见 system/scheduler.mjs)
startScheduler({ store, ctx: obCtx, paths: obPaths, fetchImpl: globalThis.fetch, subscriptionFetchImpl: subscriptionFetch, runDeploy, log: (m) => console.log(m) })

// /api/* 专用 JSON 错误兜底:必须注册在所有路由之后、SPA fallback 之前。任何路由处理器里
// 未被自己 try/catch 的异常(同步抛出,或调用 next(err))原本会落到 Express 默认错误处理器,
// 回一个带调用栈的 HTML 错误页——面板对路由器有 root 权限,堆栈不能泄露给客户端。
// 非 /api 请求维持 Express 默认行为(交还 next(err)),不影响 SPA 静态资源服务。
//
// P4a round2 复审:此前硬编码 500,把 body-parser 自己抛出的 400(JSON 格式错,
// entity.parse.failed)、413(超大 body,entity.too.large)都吞成了 500——这两种错误对象
// 本身带 err.status/err.statusCode,必须原样透传,不能覆盖成一律 500。
// res.headersSent 判定同样必须保留:若响应头已经发出(极端情况下某个 handler 在异常前已
// 开始流式写入),Express 要求错误中间件把 err 转交给下一个,自己不能再调用 res.status()。
app.use('/api', (err, req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }

  const status = Number(err && (err.status || err.statusCode)) || 500
  res.status(status).json({ error: err && err.message ? String(err.message) : 'internal error' })
})

app.get('/sw.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.type('application/javascript')
  res.send(serviceWorkerCleanupScript)
})

app.get('/registerSW.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.type('application/javascript')
  res.send(registerSWCleanupScript)
})

if (fs.existsSync(distDir)) {
  app.use(
    express.static(distDir, {
      setHeaders: (res, filePath) => {
        const fileName = path.basename(filePath)

        if (
          fileName === 'index.html' ||
          fileName === 'sw.js' ||
          fileName === 'registerSW.js' ||
          fileName === 'manifest.webmanifest'
        ) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
          return
        }

        if (/^index-[A-Za-z0-9_-]+\.(js|css)$/.test(fileName)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    }),
  )

  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

const writeUpgradeUnauthorized = (socket) => {
  socket.write(
    `HTTP/1.1 401 Unauthorized\r
Content-Type: application/json; charset=utf-8\r
Connection: close\r
\r
${JSON.stringify({
  code: ACCESS_PASSWORD_REQUIRED_CODE,
  message: 'Access password authentication required',
})}`,
  )
  socket.destroy()
}

server.on('upgrade', (request, socket, head) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

    if (!requestUrl.pathname.startsWith('/api/controller-ws')) {
      socket.destroy()
      return
    }

    const { password } = readAccessAuthConfig()

    if (!password) {
      writeUpgradePasswordSetupRequired(socket)
      return
    }

    const authStatus = getUpgradeAccessAuthStatus(request)

    if (authStatus.enabled && !authStatus.authenticated) {
      writeUpgradeUnauthorized(socket)
      return
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit('connection', websocket, request)
    })
  } catch {
    socket.destroy()
  }
})

websocketServer.on('connection', relayControllerWebSocket)

const startServer = async () => {
  trafficCollector.start()
  latencyScheduler.start()
  failoverManager.start()
  dnsRewriteServer.start().catch(() => {})
  dnsFilterObserver.start()
  clearInterval(dnsFilterTimer)
  dnsFilterTimer = setInterval(() => dnsFilterUpdater.updateIfDue().catch((error) => console.log(`[dns-filter] 更新失败: ${error.message}`)), 60000)
  dnsFilterTimer.unref?.()
  // 上一个面板进程留下的虚拟终端(模拟 LAN 终端测试用的网络命名空间)先拆掉,不留孤儿接口挂在网桥上
  teardownProbeNetns(obCtx).catch(() => {})
  if (server.listening) {
    return server
  }

  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off('error', handleError)
      reject(error)
    }

    server.once('error', handleError)
    server.listen(port, host, () => {
      server.off('error', handleError)
      resolve()
    })
  })

  const address = server.address()
  const listenLabel =
    typeof address === 'object' && address
      ? `http://${address.address}:${address.port}`
      : `http://${host}:${port}`

  console.log(`zashboard server listening on ${listenLabel}`)
  console.log(`sqlite db: ${dbPath}`)

  return server
}

const shutdownServer = async () => {
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  // 先把攒着没写的流量增量落盘,再关库
  trafficCollector.stop()
  latencyScheduler.stop()
  failoverManager.stop()
  dnsRewriteServer.stop()
  clearInterval(dnsFilterTimer)
  dnsFilterObserver.stop()
  if (typeof db.close === 'function') {
    db.close()
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  startServer().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

export {
  ACCESS_PASSWORD_INVALID_CODE,
  ACCESS_PASSWORD_REQUIRED_CODE,
  app,
  issueAccessSession as issueAccessSessionForTesting,
  db,
  getProxyTarget as getProxyTargetForTesting,
  getRequestAccessAuthStatus as getRequestAccessAuthStatusForTesting,
  getWebSocketProxyTarget as getWebSocketProxyTargetForTesting,
  PASSWORD_ALREADY_SET_CODE,
  PASSWORD_SETUP_REQUIRED_CODE,
  PASSWORD_TOO_SHORT_CODE,
  readSnapshot,
  replaceSnapshot,
  server,
  shutdownServer,
  startServer,
  store as storeForTesting,
}
