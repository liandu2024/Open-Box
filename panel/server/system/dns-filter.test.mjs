import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import dgram from 'node:dgram'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Resolver } from 'node:dns/promises'
import { WebSocket } from 'ws'
import { createRealContext } from './context-real.mjs'
import { prepareDnsFilter } from './dns-filter.mjs'
import { buildFilterConfig } from '../engine/dns-filter.mjs'
import { buildResponse, parseQuery } from './dns-rewrite-server.mjs'
import { createDnsEventParser } from './dns-filter-observer.mjs'

const binary = path.resolve(import.meta.dirname, '../../.tools/sing-box')
const available = await fs.access(binary).then(() => true, () => false)
const freePort = async () => { const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const port = s.address().port; await new Promise((r) => s.close(r)); return port }

test('native 1.14 DNS filters, exceptions, AAAA, regex, rewrite priority and observable records', { skip: !available, timeout: 20000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openbox-dns-filter-test-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const profile = { dns: { filter: { enabled: true, allowDomains: ['manual.ads.test'], lists: [{ id: 'list', name: 'Test list', enabled: true, url: 'https://example.com/filter.txt' }] } } }
  const raw = new Map()
  const store = { getProfile: () => profile, getRaw: (k) => raw.get(k), setRaw: (k, v) => raw.set(k, v) }
  const ctx = createRealContext(), paths = { dataDir: dir, singbox: binary }
  const body = '||ads.test^\n@@||safe.ads.test^\n||only-a.test^$dnstype=A\n||*.wild.test^\n/^ad[0-9]+\\.regex\\.test$/$denyallow=ad1.regex.test\n||local.test^'
  const artifact = await prepareDnsFilter({ store, ctx, paths, fetchImpl: async () => new Response(body) })
  const previous = raw.get('openbox/dns-filter-lists')
  await prepareDnsFilter({ store, ctx, paths, force: true, fetchImpl: async () => { throw new Error('offline') } })
  assert.equal(JSON.parse(raw.get('openbox/dns-filter-lists')).list.hash, JSON.parse(previous).list.hash)
  assert.match(JSON.parse(raw.get('openbox/dns-filter-lists')).list.error, /offline/)
  await prepareDnsFilter({ store, ctx, paths, force: true, fetchImpl: async () => new Response('/(invalid/') })
  assert.equal(JSON.parse(raw.get('openbox/dns-filter-lists')).list.hash, JSON.parse(previous).list.hash)
  assert.match(JSON.parse(raw.get('openbox/dns-filter-lists')).list.error, /正则无效/)
  const filtering = buildFilterConfig(profile, artifact)
  const upstream = dgram.createSocket('udp4')
  upstream.bind(0, '127.0.0.1'); await once(upstream, 'listening')
  t.after(() => upstream.close())
  upstream.on('message', (msg, peer) => {
    const query = parseQuery(msg)
    upstream.send(buildResponse(query, { answers: [{ name: query.qname, type: query.qtype, ttl: 60, data: query.qtype === 28 ? '2001:db8::1' : '192.0.2.1' }] }), peer.port, peer.address)
  })
  const port = await freePort(), api = await freePort()
  const config = { log: { level: 'warn' }, dns: { servers: [{ tag: 'up', type: 'udp', server: '127.0.0.1', server_port: upstream.address().port }], rules: [{ domain: ['local.test'], action: 'predefined', answer: ['local.test. 60 IN A 192.168.3.1'] }, ...filtering.rules], final: 'up' }, inbounds: [{ type: 'direct', tag: 'dns-in', listen: '127.0.0.1', listen_port: port }], route: { rules: [{ inbound: ['dns-in'], action: 'hijack-dns' }], rule_set: filtering.sets }, experimental: { clash_api: { external_controller: `127.0.0.1:${api}` } } }
  const file = path.join(dir, 'config.json')
  await fs.writeFile(file, JSON.stringify(config))
  const core = spawn(binary, ['run', '-c', file], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; core.stderr.on('data', (d) => { output += d })
  t.after(async () => { if (core.exitCode === null) { core.kill(); await once(core, 'exit') } })
  for (let i = 0; i < 60; i++) {
    if (core.exitCode !== null) throw new Error(output)
    try { await fetch(`http://127.0.0.1:${api}/version`); break } catch { await new Promise(r => setTimeout(r, 50)) }
  }
  const rows = [], starts = []
  const parser = createDnsEventParser({ data: { start: (q) => starts.push(q), finish: (q) => rows.push(q) }, rules: config.dns.rules, names: Object.fromEntries(artifact.blocks.map(b => [b.tag, b.name])) })
  const ws = new WebSocket(`ws://127.0.0.1:${api}/logs?level=debug`)
  t.after(() => ws.terminate())
  const logs = []
  ws.on('message', (v) => { const entry = JSON.parse(v.toString()); logs.push(entry); parser.accept(entry) })
  await once(ws, 'open')
  const resolver = new Resolver({ timeout: 1000, tries: 1 }); resolver.setServers([`127.0.0.1:${port}`])
  for (const name of ['ads.test', 'sub.ads.test', 'x.wild.test', 'ad2.regex.test', 'only-a.test']) await assert.rejects(resolver.resolve4(name), { code: 'ENOTFOUND' })
  for (const name of ['safe.ads.test', 'manual.ads.test', 'wild.test', 'badads.test', 'ad1.regex.test']) assert.deepEqual(await resolver.resolve4(name), ['192.0.2.1'])
  assert.deepEqual(await resolver.resolve6('only-a.test'), ['2001:db8::1'])
  await assert.rejects(resolver.resolve6('ads.test'), { code: 'ENOTFOUND' })
  assert.deepEqual(await resolver.resolve4('local.test'), ['192.168.3.1'])
  await new Promise(r => setTimeout(r, 100))
  assert.equal(rows.filter(r => r.result === 'blocked').length, 6, JSON.stringify(logs))
  assert.equal(starts.length, 13, JSON.stringify(logs))
  assert.equal(rows.filter(r => r.result === 'allowed').length, 6, JSON.stringify(logs))
  assert.equal(rows.find(r => r.domain === 'ads.test').list, 'Test list')
})
