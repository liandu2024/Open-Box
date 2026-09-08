import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerTerminalTestRoutes, runTerminalTest } from './terminal-test.mjs'
import * as lanProbe from '../system/lan-probe.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'
import { configMetaPath } from '../system/deploy.mjs'
import { dnsForwardFilePath } from '../system/dns-takeover.mjs'

const paths = createPaths('/opt/open-box')
const LEASE = { ip: '10.0.0.160', mask: 24, gateway: '10.0.0.1', dns: ['10.0.0.1'], mac: '02:4f:42:00:00:01', hostname: 'openbox-probe', lanDevice: 'br-lan', dhcpMs: 1200, reused: false }
const ADDRS = '2: eth0    inet 192.168.3.35/24 brd 192.168.3.255 scope global eth0\\       valid_lft forever\n5: br-lan    inet 10.0.0.1/24 brd 10.0.0.255 scope global br-lan\\       valid_lft forever\n'
const CT_FORWARD = 'ipv4     2 tcp      6 431999 ESTABLISHED src=10.0.0.160 dst=183.240.99.224 sport=50001 dport=80 src=183.240.99.224 dst=192.168.3.35 sport=80 dport=50001 [ASSURED] mark=0 zone=0 use=2'
const CT_REDIRECT = 'ipv4     2 tcp      6 431999 ESTABLISHED src=10.0.0.160 dst=8.8.8.8 sport=42174 dport=443 src=10.0.0.1 dst=10.0.0.160 sport=45677 dport=42174 [ASSURED] mark=0 zone=0 use=2'
const CT_SYN_REDIRECT = 'ipv4     2 tcp      6 118 SYN_SENT src=10.0.0.160 dst=9.9.9.9 sport=48072 dport=443 src=10.0.0.1 dst=10.0.0.160 sport=45677 dport=48072 mark=0 zone=0 use=2'
const CT_DNS = 'ipv4     2 udp      17 53 src=10.0.0.160 dst=10.0.0.1 sport=53467 dport=53 src=10.0.0.1 dst=10.0.0.160 sport=53 dport=53467 mark=8228 zone=0 use=2'

const meta = { firstLayer: { dnsMode: 'dnsmasq', dnsForward: 'domains', nativeBypass: { enabled: true, sets: ['geoip-cn'] } } }
const config = { inbounds: [{ type: 'tun', tag: 'tun-in', auto_redirect: true }] }
const store = { getProfile: () => ({ ipv6: false }), getClashSecret: () => 'secret', getGroups: () => [] }

// 子进程用脚本化的事件序列代替:同步吐完事件,close 由 gather 结束时调
const fakeChild = (events) => async ({ onEvent }) => {
  const control = { close: () => {} }
  for (const ev of events) onEvent(ev, control)
  return { events, code: 0, stderr: '' }
}
const makeProbe = (events, overrides = {}) => ({
  ...lanProbe,
  probeCapability: async () => ({ ok: true, missing: [], lan: { device: 'br-lan', address: '10.0.0.1', mask: 24 } }),
  ensureProbeNetns: async () => LEASE,
  runProbeChild: fakeChild(events),
  ...overrides,
})
const makeCtx = ({ conntrack, extraExec = {} }) => createMockContext({
  files: {
    [paths.configPath]: JSON.stringify(config),
    [configMetaPath(paths)]: JSON.stringify(meta),
    [dnsForwardFilePath(paths)]: 'server=/google/127.0.0.1#7853\nserver=/.youtube.com/127.0.0.1#7853\n',
    [lanProbe.CONNTRACK_PATH]: conntrack,
  },
  execResults: { 'ip -4 -o addr': { stdout: ADDRS }, 'ip -6 -o addr': { stdout: '' }, ...extraExec },
})
const fetchConnections = (connections) => async () => ({ ok: true, status: 200, json: async () => ({ connections }) })

test('旁路目标:conntrack 里没改写、路由从 eth0 转出、回包发往 WAN 地址、内核连接表没有 → bypass,并带全部证据', async () => {
  const ctx = makeCtx({
    conntrack: [CT_DNS, CT_FORWARD].join('\n'),
    extraExec: {
      'ip route get 183.240.99.224 from 10.0.0.160 iif br-lan': { stdout: '183.240.99.224 from 10.0.0.160 via 192.168.3.1 dev eth0 \n    cache iif br-lan \n' },
      'nft list set inet sing-box inet4_route_exclude_address_set': { code: 0, stdout: 'set ...' },
      'nft get element inet sing-box inet4_route_exclude_address_set { 183.240.99.224 }': { code: 0, stdout: '{ 183.192.0.0-183.255.255.255 }' },
    },
  })
  const probe = makeProbe([
    { event: 'dns', server: '10.0.0.1', ok: true, answers: ['183.240.99.224', '111.45.11.5'], ms: 6 },
    { event: 'connected', localAddress: '10.0.0.160', localPort: 50001, remoteAddress: '183.240.99.224', remotePort: 80, ms: 12 },
    { event: 'response', status: 200, ms: 70 },
  ])
  const r = await runTerminalTest({ store, ctx, paths, fetchImpl: fetchConnections([]), probe }, { target: 'www.baidu.com', port: 80 })
  assert.equal(r.capable, true)
  assert.deepEqual(r.source, { kind: 'virtual', name: 'openbox-probe', ip: '10.0.0.160', mac: '02:4f:42:00:00:01', via: 'dhcp', dns: ['10.0.0.1'], gateway: '10.0.0.1', lanDevice: 'br-lan', reused: false, dhcpMs: 1200 })
  assert.deepEqual(r.dns, { server: '10.0.0.1', ok: true, answers: ['183.240.99.224', '111.45.11.5'], ms: 6 })
  assert.deepEqual(r.dnsForward, { forward: 'upstream', plan: 'domains' })
  assert.equal(r.dnsEvidence.hijacked, false)
  assert.equal(r.dnsEvidence.answeredBy, '10.0.0.1')
  assert.equal(r.entry.kind, 'bypass')
  assert.equal(r.entry.device, 'eth0')
  assert.equal(r.entry.masquerade, true)
  assert.equal(r.entry.evidence.conntrack, CT_FORWARD)
  assert.equal(r.entry.evidence.setHit, true)
  assert.equal(r.entry.evidence.set, 'inet4_route_exclude_address_set')
  assert.equal(r.entry.evidence.kernelConn, false)
  assert.equal(r.entry.evidence.autoRedirect, true)
  assert.equal(r.kernel.seen, false)
  assert.deepEqual(r.exit.forward, { device: 'eth0', gateway: '192.168.3.1', masquerade: true, address: '192.168.3.35' })
  assert.equal(r.exit.status, 200)
  assert.equal(r.exit.connectTo, '183.240.99.224')
  assert.equal(r.exit.localPort, 50001)
  assert.equal(r.exit.url, 'http://www.baidu.com/')
  assert.deepEqual(r.firstLayer, { bypassEnabled: true, bypassSets: ['geoip-cn'], dnsMode: 'dnsmasq', dnsForward: 'domains' })
})

test('进内核的代理目标:conntrack 回复方改写成路由器地址(redirect)+ 连接表里有记录 → kernel,带链路和规则', async () => {
  const ctx = makeCtx({
    conntrack: CT_REDIRECT,
    extraExec: {
      'ip route get 8.8.8.8 from 10.0.0.160 iif br-lan': { stdout: '8.8.8.8 from 10.0.0.160 via 192.168.3.1 dev eth0' },
      'nft list set inet sing-box inet4_route_exclude_address_set': { code: 0 },
      'nft get element inet sing-box inet4_route_exclude_address_set { 8.8.8.8 }': { code: 1 },
    },
  })
  const probe = makeProbe([
    { event: 'connected', localAddress: '10.0.0.160', localPort: 42174, remoteAddress: '8.8.8.8', remotePort: 443, ms: 3 },
    { event: 'response', status: 302, ms: 390 },
  ])
  const connections = [{ metadata: { type: 'redirect/tun-in', sourceIP: '10.0.0.160', sourcePort: '42174', destinationIP: '8.8.8.8', destinationPort: '443', host: '' }, rule: 'rule_set=[geoip-google] => route(国外)', rulePayload: '', chains: ['自建 | 美国-02', '美国-自动', '国外'] }]
  const r = await runTerminalTest({ store, ctx, paths, fetchImpl: fetchConnections(connections), probe }, { target: '8.8.8.8', port: 443 })
  assert.deepEqual(r.dns, { skipped: true })
  assert.equal(r.dnsForward, undefined)
  assert.equal(r.entry.kind, 'kernel')
  assert.equal(r.entry.via, 'redirect')
  assert.equal(r.entry.redirectPort, 45677)
  assert.equal(r.entry.evidence.setHit, false)
  assert.equal(r.kernel.seen, true)
  assert.deepEqual(r.kernel.chains, ['国外', '美国-自动', '自建 | 美国-02'])
  assert.equal(r.kernel.viaProxy, true)
  assert.equal(r.kernel.inbound, 'redirect/tun-in')
  assert.equal(r.exit.forward, undefined)
  assert.equal(r.exit.status, 302)
  assert.equal(r.exit.url, 'https://8.8.8.8/')
})

test('连接建不起来(超时):没有来源端口也按目标在 conntrack 里找 SYN_SENT,被 redirect 的照样判进内核', async () => {
  const ctx = makeCtx({
    conntrack: CT_SYN_REDIRECT,
    extraExec: {
      'ip route get 9.9.9.9 from 10.0.0.160 iif br-lan': { stdout: '9.9.9.9 from 10.0.0.160 via 192.168.3.1 dev eth0' },
      'nft list set inet sing-box inet4_route_exclude_address_set': { code: 1 },
    },
  })
  const probe = makeProbe([{ event: 'error', stage: 'connect', error: 'timeout', ms: 10000 }])
  const r = await runTerminalTest({ store, ctx, paths, fetchImpl: fetchConnections([]), probe }, { target: '9.9.9.9', port: 443 })
  assert.equal(r.exit.ok, false)
  assert.equal(r.exit.error, 'timeout')
  assert.equal(r.entry.kind, 'kernel')
  assert.equal(r.entry.via, 'redirect')
  assert.equal(r.entry.evidence.set, null)
})

test('conntrack 里没有这条流:不判旁路(unknown / no-conntrack),即使内核连接表也没有', async () => {
  const ctx = makeCtx({ conntrack: CT_DNS, extraExec: { 'ip route get 183.240.99.224 from 10.0.0.160 iif br-lan': { stdout: '183.240.99.224 via 192.168.3.1 dev eth0' }, 'nft list set inet sing-box inet4_route_exclude_address_set': { code: 1 } } })
  const probe = makeProbe([
    { event: 'dns', server: '10.0.0.1', ok: true, answers: ['183.240.99.224'], ms: 4 },
    { event: 'connected', localPort: 50002, remoteAddress: '183.240.99.224', remotePort: 80, ms: 9 },
    { event: 'response', status: 200, ms: 50 },
  ])
  const r = await runTerminalTest({ store, ctx, paths, fetchImpl: fetchConnections([]), probe }, { target: 'www.baidu.com', port: 80 })
  assert.equal(r.entry.kind, 'unknown')
  assert.equal(r.entry.reason, 'no-conntrack')
  assert.equal(r.exit.forward, undefined)
  assert.equal(r.exit.status, 200)
})

test('DNS 解析失败:不去连,exit 记 dns 错误,入口 not-connected', async () => {
  const ctx = makeCtx({ conntrack: '' })
  const probe = makeProbe([
    { event: 'dns', server: '10.0.0.1', ok: false, answers: [], ms: 5000, error: 'queryA ETIMEOUT nope.invalid' },
    { event: 'error', stage: 'dns', error: 'queryA ETIMEOUT nope.invalid', ms: 5001 },
  ])
  const r = await runTerminalTest({ store, ctx, paths, fetchImpl: fetchConnections([]), probe }, { target: 'nope.invalid' })
  assert.equal(r.dns.ok, false)
  assert.match(r.exit.error, /^dns: /)
  assert.deepEqual([r.entry.kind, r.entry.reason], ['unknown', 'not-connected'])
})

test('设备不具备条件 / 虚拟终端建不起来:如实回报,不做任何探测', async () => {
  const ctx = makeCtx({ conntrack: '' })
  let spawned = 0
  const incapable = makeProbe([], { probeCapability: async () => ({ ok: false, missing: ['netns', 'veth'] }), runProbeChild: async () => { spawned += 1; return { events: [], code: 0, stderr: '' } } })
  const r1 = await runTerminalTest({ store, ctx, paths, fetchImpl: fetchConnections([]), probe: incapable }, { target: 'www.baidu.com' })
  assert.deepEqual(r1, { target: 'www.baidu.com', mode: 'lan', capable: false, missing: ['netns', 'veth'] })
  const broken = makeProbe([], { ensureProbeNetns: async () => { throw new Error('dhcp: udhcpc: no lease, failing') }, runProbeChild: async () => { spawned += 1; return { events: [], code: 0, stderr: '' } } })
  const r2 = await runTerminalTest({ store, ctx, paths, fetchImpl: fetchConnections([]), probe: broken }, { target: 'www.baidu.com' })
  assert.equal(r2.capable, true)
  assert.equal(r2.setupError, 'dhcp: udhcpc: no lease, failing')
  assert.equal(r2.source, undefined)
  assert.equal(spawned, 0)
})

test('HTTP 路由:非法目标 400;capability 接口回能力;POST 返回测试结果', async () => {
  const app = express()
  const ctx = makeCtx({ conntrack: '' })
  const probe = makeProbe([], { probeCapability: async () => ({ ok: false, missing: ['root'], lan: null }) })
  registerTerminalTestRoutes(app, { store, ctx, paths, fetchImpl: fetchConnections([]), probe })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const cap = await (await fetch(`${base}/api/openbox/terminal-test/capability`)).json()
    assert.deepEqual(cap, { ok: false, missing: ['root'], lan: null })
    const bad = await fetch(`${base}/api/openbox/terminal-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: '-x' }) })
    assert.equal(bad.status, 400)
    const ok = await fetch(`${base}/api/openbox/terminal-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'Example.COM' }) })
    assert.deepEqual(await ok.json(), { target: 'example.com', mode: 'lan', capable: false, missing: ['root'] })
  } finally {
    server.close()
  }
})
