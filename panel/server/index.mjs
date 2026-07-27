import express from 'express'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { registerDeployRoutes } from './api/deploy.mjs'
import { registerPenetrationRoutes } from './api/penetration.mjs'
import { registerProfileRoutes } from './api/profile.mjs'
import { registerServiceRoutes } from './api/service.mjs'
import { registerSubscriptionRoutes } from './api/subscriptions.mjs'
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
const MIN_ACCESS_PASSWORD_LENGTH = 8
// 首次访问强制设密:密码尚未设置前,除这三条(健康检查 + 查询状态 + 设密本身)外,
// 一切 /api/* 一律拒绝 —— 面板对路由器有 root 级权限,不能裸奔。
const PASSWORD_SETUP_EXEMPT_PATHS = new Set(['/api/health', '/api/auth/status', '/api/auth/setup'])
const accessSessionSecret = randomBytes(32).toString('hex')
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

const db = new DatabaseSync(dbPath)

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

// openbox-store 复用同一张 app_storage KV 表;controller 代理靠它拿本机 clash_api 的 secret。
const store = createStore({
  get: (key) => getStorageValueStatement.get(key)?.value ?? null,
  set: (key, value) => upsertStorageValueStatement.run(key, value),
  del: (key) => deleteStorageValueStatement.run(key),
})

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

const createAccessSessionToken = (password) => {
  return createHmac('sha256', accessSessionSecret).update(password).digest('base64url')
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

  const token = parseCookies(cookieHeader).get(ACCESS_SESSION_COOKIE_NAME)

  if (!token) {
    return false
  }

  return safeTokenEquals(token, createAccessSessionToken(password))
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
  res.cookie(ACCESS_SESSION_COOKIE_NAME, createAccessSessionToken(password), {
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
app.use('/api/storage', express.json({ limit: '25mb' }))
app.use('/api/background-image', express.json({ limit: '25mb' }))
app.use('/api/controller', express.raw({ type: '*/*', limit: '25mb' }))

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

  upsertStorageValueStatement.run(ACCESS_PASSWORD_KEY, newPassword)

  // 会话 token 是 HMAC(密码) 派生的(见 createAccessSessionToken):改密后旧 token 自动
  // 失效,若不在这里重新签发,发起这次改密请求的当前会话本身也会瞬间掉线——必须立刻
  // 签发一份绑定新密码的 cookie,把当前会话续上。
  setAccessSessionCookie(res, newPassword)

  res.json({
    ok: true,
    enabled: true,
    authenticated: true,
  })
})

app.post('/api/auth/login', (req, res) => {
  const { enabled, password } = readAccessAuthConfig()

  res.setHeader('Cache-Control', 'no-store')

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
    clearAccessSessionCookie(res)
    res.status(401).json({
      code: ACCESS_PASSWORD_INVALID_CODE,
      message: 'Invalid access password',
      enabled: true,
      authenticated: false,
    })
    return
  }

  setAccessSessionCookie(res, password)
  res.json({
    enabled: true,
    authenticated: true,
  })
})

app.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')

  const { enabled, password } = readAccessAuthConfig()

  if (!password) {
    sendPasswordSetupRequired(res)
    return
  }

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
registerSubscriptionRoutes(app, { store, fetchImpl: globalThis.fetch })
registerProfileRoutes(app, { store })
registerDeployRoutes(app, { store, ctx: obCtx, paths: obPaths })
registerServiceRoutes(app, { ctx: obCtx, paths: obPaths })
registerPenetrationRoutes(app, { store, ctx: obCtx, paths: obPaths, fetchImpl: globalThis.fetch })

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
  createAccessSessionToken as createAccessSessionTokenForTesting,
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
