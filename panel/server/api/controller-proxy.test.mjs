import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { WebSocket, WebSocketServer } from 'ws'

// 起一个假冒 clash_api 的本地 http/ws server:记录收到的请求路径、Authorization 头、
// 以及 ws 升级请求的 url(用于校验 token query 是否携带了 secret)。
const startFakeUpstream = () =>
  new Promise((resolve, reject) => {
    const receivedRequests = []
    const receivedConnections = []

    const httpServer = http.createServer((req, res) => {
      receivedRequests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers['authorization'] || '',
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, path: req.url }))
    })

    const wss = new WebSocketServer({ server: httpServer })

    wss.on('connection', (socket, request) => {
      receivedConnections.push({ url: request.url })
      socket.on('message', (data) => socket.send(data))
    })

    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', () => {
      const { port } = httpServer.address()

      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        receivedRequests,
        receivedConnections,
        close: () => new Promise((r) => httpServer.close(r)),
      })
    })
  })

// listen(0) 拿到临时端口后返回可访问的 baseUrl,供 fetch/WebSocket 使用。
const listenEphemeral = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve(`http://127.0.0.1:${port}`)
    })
  })

const importServerModule = async ({ dbPath, clashApiBase }) => {
  process.env.ZASHBOARD_DB_PATH = dbPath

  if (clashApiBase) {
    process.env.OPENBOX_CLASH_API_BASE = clashApiBase
  } else {
    delete process.env.OPENBOX_CLASH_API_BASE
  }

  const moduleUrl = new URL(`./../index.mjs?test=${Date.now()}-${Math.random()}`, import.meta.url)
  return import(moduleUrl.href)
}

const makeTempDbPath = async (label) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `openbox-controller-proxy-${label}-`))
  return { tempDir, dbPath: path.join(tempDir, 'zashboard.sqlite') }
}

// 注意:所有异步 setup 必须在任何 test()/after() 注册之前完成 ——
// node:test 在遇到顶层 await 时可能提前调度已注册的测试并发执行,
// 若 setup 与 test() 声明交错,会与仍未 resolve 的 setup 产生竞态(ECONNREFUSED 之类的假失败)。

// ---- 实例 A:不设置 OPENBOX_CLASH_API_BASE,用于校验解析函数的真实缺省值 ----
const { tempDir: tempDirA, dbPath: dbPathA } = await makeTempDbPath('a')
const modA = await importServerModule({ dbPath: dbPathA })

// ---- 实例 B:通过 OPENBOX_CLASH_API_BASE 指向假 clash_api,做真实的 HTTP/WS 往返验证 ----
const fakeDefaultUpstream = await startFakeUpstream()
const fakeOverrideUpstream = await startFakeUpstream()
const { tempDir: tempDirB, dbPath: dbPathB } = await makeTempDbPath('b')
const modB = await importServerModule({ dbPath: dbPathB, clashApiBase: fakeDefaultUpstream.baseUrl })
// P4a Task 8:未设密时守卫会拦截除 /api/health、/api/auth/status、/api/auth/setup 外的一切 /api/*。
// 本文件测的是代理转发本身,不是认证流程,这里只需要"已设密"这一前提条件就能绕开新守卫;
// 不设置 access-password-enabled,保持鉴权本身关闭,不影响本文件原有的免鉴权断言。
modB.replaceSnapshot({ 'config/access-password': 'controller-proxy-test-placeholder' })
const baseUrlB = await listenEphemeral(modB.server)

after(async () => {
  await modA.shutdownServer().catch(() => {})
  await modB.shutdownServer().catch(() => {})
  await fakeDefaultUpstream.close()
  await fakeOverrideUpstream.close()
  await fs.rm(tempDirA, { recursive: true, force: true })
  await fs.rm(tempDirB, { recursive: true, force: true })
})

test('getProxyTarget 无 header 时缺省本机 9095 + store 中的 secret', () => {
  const fakeReq = { header: () => undefined }
  const result = modA.getProxyTargetForTesting(fakeReq)

  assert.equal(result.base.toString(), 'http://127.0.0.1:9095/')
  assert.equal(result.secret, modA.storeForTesting.getClashSecret())
  assert.ok(result.secret.length > 0)
})

test('getProxyTarget 带 header 时以传入为准(本地调试逃生舱)', () => {
  const fakeReq = {
    header: (name) => {
      if (name === 'x-zashboard-target-base') return 'http://10.0.0.5:9999'
      if (name === 'x-zashboard-target-secret') return 'debug-secret'
      return undefined
    },
  }
  const result = modA.getProxyTargetForTesting(fakeReq)

  assert.equal(result.base.toString(), 'http://10.0.0.5:9999/')
  assert.equal(result.secret, 'debug-secret')
})

test('getWebSocketProxyTarget 无 query 时缺省本机 9095 + store 中的 secret', () => {
  const requestUrl = new URL('http://localhost/api/controller-ws/foo')
  const result = modA.getWebSocketProxyTargetForTesting(requestUrl)

  assert.equal(result.base.toString(), 'http://127.0.0.1:9095/')
  assert.equal(result.secret, modA.storeForTesting.getClashSecret())
})

test('getWebSocketProxyTarget 带 query 时以传入为准', () => {
  const requestUrl = new URL(
    'http://localhost/api/controller-ws/foo?targetBase=http%3A%2F%2F10.0.0.5%3A9999&secret=debug-secret',
  )
  const result = modA.getWebSocketProxyTargetForTesting(requestUrl)

  assert.equal(result.base.toString(), 'http://10.0.0.5:9999/')
  assert.equal(result.secret, 'debug-secret')
})

test('不带 header 的 /api/controller/xxx 请求被转发到本机 clash_api,并带 Bearer secret', async () => {
  const expectedSecret = modB.storeForTesting.getClashSecret()

  const res = await fetch(`${baseUrlB}/api/controller/version`)
  assert.equal(res.status, 200)

  const body = await res.json()
  assert.equal(body.path, '/version')

  assert.equal(fakeDefaultUpstream.receivedRequests.length, 1)
  const received = fakeDefaultUpstream.receivedRequests[0]
  assert.equal(received.url, '/version')
  assert.equal(received.authorization, `Bearer ${expectedSecret}`)
})

test('带 x-zashboard-target-base/secret header 时以传入目标为准', async () => {
  const res = await fetch(`${baseUrlB}/api/controller/proxies`, {
    headers: {
      'x-zashboard-target-base': fakeOverrideUpstream.baseUrl,
      'x-zashboard-target-secret': 'debug-secret',
    },
  })
  assert.equal(res.status, 200)

  assert.equal(fakeOverrideUpstream.receivedRequests.length, 1)
  const received = fakeOverrideUpstream.receivedRequests[0]
  assert.equal(received.url, '/proxies')
  assert.equal(received.authorization, 'Bearer debug-secret')

  // 不应该污染默认目标的假上游
  assert.equal(fakeDefaultUpstream.receivedRequests.length, 1)
})

test('不带 query 的 /api/controller-ws 连接被转发到本机 clash_api,并在 token 上携带 secret', async () => {
  const expectedSecret = modB.storeForTesting.getClashSecret()
  const wsUrl = baseUrlB.replace('http://', 'ws://') + '/api/controller-ws/connections'

  const client = new WebSocket(wsUrl)

  await new Promise((resolve, reject) => {
    client.once('open', resolve)
    client.once('error', reject)
  })

  await new Promise((resolve) => setTimeout(resolve, 50))

  assert.equal(fakeDefaultUpstream.receivedConnections.length, 1)
  const connectionUrl = new URL(
    fakeDefaultUpstream.receivedConnections[0].url,
    'http://localhost',
  )
  assert.equal(connectionUrl.pathname, '/connections')
  assert.equal(connectionUrl.searchParams.get('token'), expectedSecret)

  client.close()
  await new Promise((resolve) => client.once('close', resolve))
})
