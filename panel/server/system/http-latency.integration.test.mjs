// Runs the bundled core against local HTTP nodes and a local 204 server. No
// public test endpoint, real subscription, TUN or router configuration is used.
import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { configMetaPath } from './deploy.mjs'
import { createFailoverManager } from './failover-manager.mjs'
import { createLatencyScheduler } from './latency-scheduler.mjs'

const binary = process.env.OPENBOX_TEST_SINGBOX || fileURLToPath(new URL('../../.tools/sing-box', import.meta.url))
const inCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
const listen = async (server) => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port }
const until = async (fn) => {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) { if (await fn()) return; await sleep(30) }
  assert.fail('Timed out waiting for the core')
}

// A real HTTP CONNECT proxy, with controllable failure and link latency. Reject
// unexpected destinations so the upstream HTTP-to-gstatic bug fails locally.
const makeNode = async (t, destination, latency) => {
  const sockets = new Set()
  const state = { mode: 'up', targets: [] }
  const server = http.createServer()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('connect', async (req, client, head) => {
    state.targets.push(req.url)
    if (state.mode === 'down' || req.url !== destination) { client.destroy(); return }
    if (state.mode === 'timeout') return
    await sleep(latency)
    if (client.destroyed) return
    const upstream = net.connect(Number(destination.split(':')[1]), '127.0.0.1')
    sockets.add(upstream)
    upstream.on('error', () => client.destroy())
    upstream.on('close', () => { sockets.delete(upstream); client.destroy() })
    client.on('close', () => upstream.destroy())
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(client).pipe(upstream)
    })
  })
  state.port = await listen(server)
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)) })
  return state
}

test('真实 Clash API：HTTP 指定地址、手动选择、自动优选、故障切换及恢复', {
  skip: !fs.existsSync(binary) && !inCI ? 'Set OPENBOX_TEST_SINGBOX to the newly built bundled core' : false,
  timeout: 45_000,
}, async (t) => {
  assert.ok(fs.existsSync(binary), 'CI must install the bundled core before testing')
  const requests = []
  const endpoint = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url })
    res.writeHead(204).end()
  })
  const endpointPort = await listen(endpoint)
  t.after(() => new Promise((resolve) => { endpoint.closeAllConnections(); endpoint.close(resolve) }))
  const destination = `127.0.0.1:${endpointPort}`
  const url = `http://${destination}/probe-204?source=openbox`
  const nodes = await Promise.all([15, 65, 110].map((delay) => makeNode(t, destination, delay)))
  const tags = ['node-a', 'node-b', 'node-c']
  const reserved = net.createServer()
  const apiPort = await listen(reserved)
  await new Promise((resolve) => reserved.close(resolve))
  const base = `http://127.0.0.1:${apiPort}`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-http-latency-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const paths = createPaths(dir)
  fs.mkdirSync(paths.etc, { recursive: true })
  const config = {
    log: { level: 'error' },
    experimental: { clash_api: { external_controller: `127.0.0.1:${apiPort}` } },
    outbounds: [
      ...nodes.map((node, i) => ({ type: 'http', tag: tags[i], server: '127.0.0.1', server_port: node.port })),
      { type: 'direct', tag: 'direct' }, { type: 'block', tag: 'reject' },
      { type: 'urltest', tag: 'auto', outbounds: tags.slice(0, 2), url, interval: '1h', idle_timeout: '2h', tolerance: 0 },
      { type: 'selector', tag: 'manual', outbounds: tags },
      { type: 'urltest', tag: '__fo:test:A', outbounds: tags.slice(0, 2), url, interval: '1h', idle_timeout: '2h', tolerance: 0 },
      { type: 'selector', tag: 'failover', outbounds: ['__fo:test:A', 'node-c', 'reject'], default: '__fo:test:A' },
    ],
  }
  fs.writeFileSync(paths.configPath, JSON.stringify(config))
  let output = ''
  const child = spawn(binary, ['run', '-c', paths.configPath], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (b) => { output += b })
  child.stderr.on('data', (b) => { output += b })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
  })
  const api = async (route, init) => {
    const res = await fetch(base + route, { ...init, signal: AbortSignal.timeout(7000) })
    const body = res.status === 204 ? null : await res.json()
    return { status: res.status, body }
  }
  const proxy = async (name) => (await api(`/proxies/${encodeURIComponent(name)}`)).body
  const delay = (name, timeout = 1000) => api(`/proxies/${encodeURIComponent(name)}/delay?url=${encodeURIComponent(url)}&timeout=${timeout}`)
  await until(async () => {
    assert.equal(child.exitCode, null, output)
    try { return (await api('/version')).status === 200 } catch { return false }
  })
  await until(async () => (await proxy('node-a')).history.length > 0 && (await proxy('node-b')).history.length > 0 && (await proxy('auto')).now === 'node-a')

  await t.test('直连与单节点：原样发送 HTTP HEAD，经过指定节点，超时仍失败', async () => {
    for (const tag of ['direct', ...tags]) {
      const result = await delay(tag)
      assert.equal(result.status, 200, JSON.stringify(result))
      assert.ok(result.body.delay > 0)
    }
    for (const node of nodes) assert.ok(node.targets.length && node.targets.every((target) => target === destination))
    assert.ok(requests.length && requests.every((r) => r.method === 'HEAD' && r.url === '/probe-204?source=openbox'))
    nodes[2].mode = 'timeout'
    assert.equal((await delay('node-c', 100)).status, 504)
    assert.deepEqual((await proxy('node-c')).history, [])
    nodes[2].mode = 'up'
    assert.equal((await delay('node-c')).status, 200)
  })

  await t.test('手动选择：测速跟随所选节点，批量检测不更改用户选择', async () => {
    assert.equal((await api('/proxies/manual', { method: 'PUT', body: JSON.stringify({ name: 'node-b' }) })).status, 204)
    const before = nodes.map((node) => node.targets.length)
    assert.equal((await delay('manual')).status, 200)
    assert.deepEqual(nodes.map((node, i) => node.targets.length - before[i]), [0, 1, 0])
    const result = await api(`/group/manual/delay?url=${encodeURIComponent(url)}&timeout=1000`)
    assert.equal(result.status, 200)
    assert.deepEqual(Object.keys(result.body).sort(), tags)
    assert.ok(Object.values(result.body).every((value) => value > 0))
    assert.equal((await proxy('manual')).now, 'node-b')
  })

  await t.test('自动优选与定时调度：当前节点失败，切到可用节点并返回新延迟', async () => {
    nodes[0].mode = 'down'
    assert.equal((await delay('node-a')).status, 503)
    await until(async () => (await proxy('auto')).now === 'node-b')
    const result = await delay('auto')
    assert.equal(result.status, 200)
    assert.ok(result.body.delay > 0)
    const ctx = createMockContext({ files: { [paths.configPath]: JSON.stringify(config) }, execResults: { 'pidof sing-box': { code: 1, stdout: '' } } })
    const samples = []
    const scheduler = createLatencyScheduler({
      ctx, paths, store: {}, fetchImpl: (target, init) => fetch(base + new URL(target).pathname + new URL(target).search, init),
      history: { recordFromProxies() {}, recordSamples(items) { samples.push(...items) } },
    })
    const tick = await scheduler.tick()
    assert.deepEqual(tick.tested, ['auto'])
    assert.ok(samples.some((s) => s.name === 'node-a' && s.delay === 0))
    assert.equal((await proxy('auto')).now, 'node-b')
  })

  await t.test('故障转移：组内换节点、阈值后换备用、全部失败拒绝、主用恢复后回切', async () => {
    nodes[0].mode = 'up'
    const mapping = {
      id: 'test', tag: 'failover', rejectTag: 'reject',
      lanes: [
        { id: 'A', index: 0, members: tags.slice(0, 2), valid: tags.slice(0, 2), mode: 'urltest', ref: '__fo:test:A', subTag: '__fo:test:A' },
        { id: 'B', index: 1, members: ['node-c'], valid: ['node-c'], mode: 'single', ref: 'node-c', subTag: null },
      ],
      settings: { testUrl: url, intervalMs: 5000, timeoutMs: 1000, failureThreshold: 2, restorePrimary: true, recoveryHoldMs: 6000 },
    }
    let clock = Date.now()
    const memory = new Map()
    const manager = createFailoverManager({
      paths, now: () => clock,
      store: { getRaw: (key) => memory.get(key), setRaw: (key, value) => memory.set(key, value) },
      ctx: createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify({ generatedAt: 'test', failover: [mapping] }) }, execResults: { 'pidof sing-box': { code: 1, stdout: '' } } }),
      fetchImpl: (target, init) => fetch(base + new URL(target).pathname + new URL(target).search, init),
    })
    t.after(() => manager.stop())
    const round = async () => { clock += 5001; return manager.tick() }
    await round()
    assert.equal((await proxy('failover')).now, '__fo:test:A')
    nodes[0].mode = 'down'
    await round()
    assert.equal((await proxy('__fo:test:A')).now, 'node-b')
    assert.equal((await proxy('failover')).now, '__fo:test:A')
    nodes[1].mode = 'down'
    await round()
    assert.equal((await proxy('failover')).now, '__fo:test:A')
    await round()
    assert.equal((await proxy('failover')).now, 'node-c')
    assert.ok((await delay('failover')).body.delay > 0)
    nodes[2].mode = 'down'
    await round(); await round()
    assert.equal((await proxy('failover')).now, 'reject')
    nodes[2].mode = 'up'
    await round()
    assert.equal((await proxy('failover')).now, 'node-c')
    nodes[0].mode = 'up'
    await round(); await round()
    assert.equal((await proxy('failover')).now, 'node-c', 'recovery hold must be respected')
    await round()
    assert.equal((await proxy('failover')).now, '__fo:test:A')
    assert.equal((await proxy('__fo:test:A')).now, 'node-a')
    assert.ok((await delay('failover')).body.delay > 0)
  })
})
