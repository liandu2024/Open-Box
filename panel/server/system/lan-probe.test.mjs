import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import {
  DHCP_SCRIPT, PROBE_DHCP_SCRIPT, PROBE_MAC, PROBE_NETNS, PROBE_VETH_HOST, PROBE_VETH_NS, TUN_INPUT_MARK,
  bypassSetHas, classifyEntry, dnsEvidence, dnsmasqForwardFor, ensureProbeNetns, findFlow, parseConntrack, parseInterfaceStatus,
  parseLease, parseRouteGet, probeCapability, readLanInterface, teardownProbeNetns, tunSettings,
} from './lan-probe.mjs'

// 开发路由器上抓下来的 conntrack 原样(去掉了 packets / bytes)
const CT_REDIRECT = 'ipv4     2 tcp      6 113 TIME_WAIT src=10.0.0.160 dst=111.45.11.5 sport=48466 dport=80 src=10.0.0.1 dst=10.0.0.160 sport=45677 dport=48466 [ASSURED] mark=0 zone=0 use=2'
const CT_FORWARD = 'ipv4     2 tcp      6 431999 ESTABLISHED src=10.0.0.160 dst=183.240.99.224 sport=50001 dport=80 packets=5 bytes=500 src=183.240.99.224 dst=192.168.3.35 sport=80 dport=50001 packets=4 bytes=400 [ASSURED] mark=0 zone=0 use=2'
const CT_TUN_MARK = 'ipv4     2 udp      17 29 src=10.0.0.160 dst=1.1.1.1 sport=40000 dport=443 src=1.1.1.1 dst=10.0.0.160 sport=443 dport=40000 mark=8227 zone=0 use=2'
const CT_DNS = 'ipv4     2 udp      17 53 src=10.0.0.160 dst=10.0.0.1 sport=53467 dport=53 src=10.0.0.1 dst=10.0.0.160 sport=53 dport=53467 mark=8228 zone=0 use=2'
const CT_DNS_HIJACK = 'ipv4     2 udp      17 53 src=10.0.0.160 dst=10.0.0.1 sport=53468 dport=53 src=172.19.0.2 dst=10.0.0.160 sport=53 dport=53468 mark=8227 zone=0 use=2'
const CT_ICMP = 'ipv4     2 icmp     1 20 src=10.0.0.1 dst=10.0.0.160 type=8 code=0 id=36869 [UNREPLIED] src=10.0.0.160 dst=10.0.0.1 type=0 code=0 id=36869 mark=0 zone=0 use=2'
const CT_OFFLOAD = 'ipv4     2 tcp      6 src=10.0.0.209 dst=192.168.3.10 sport=62105 dport=445 packets=45 bytes=12653 src=192.168.3.10 dst=192.168.3.35 sport=445 dport=62105 packets=37 bytes=6814 [OFFLOAD] mark=11001 zone=0 use=2'

test('parseConntrack:原始方向 / 回复方向 / 状态 / 标记 / 标志都拆出来,udp 和 icmp 没有状态词也能解', () => {
  const entries = parseConntrack([CT_REDIRECT, CT_FORWARD, CT_TUN_MARK, CT_DNS, CT_ICMP, CT_OFFLOAD, '', 'garbage line'].join('\n'))
  assert.equal(entries.length, 6)
  const r = entries[0]
  assert.equal(r.proto, 'tcp')
  assert.equal(r.state, 'TIME_WAIT')
  assert.deepEqual(r.orig, { src: '10.0.0.160', dst: '111.45.11.5', sport: 48466, dport: 80 })
  assert.deepEqual(r.reply, { src: '10.0.0.1', dst: '10.0.0.160', sport: 45677, dport: 48466 })
  assert.deepEqual(r.flags, ['ASSURED'])
  assert.equal(r.mark, 0)
  assert.equal(entries[1].state, 'ESTABLISHED')
  assert.equal(entries[2].proto, 'udp')
  assert.equal(entries[2].state, '')
  assert.equal(entries[2].mark, 8227)
  assert.equal(entries[4].proto, 'icmp')
  assert.equal(entries[4].orig.type, '8')
  assert.deepEqual(entries[5].flags, ['OFFLOAD'])
  assert.equal(entries[5].mark, 11001)
})

test('findFlow:按原始方向精确找;不知道来源端口时按目标找最后一条', () => {
  const entries = parseConntrack([CT_REDIRECT, CT_FORWARD].join('\n'))
  assert.equal(findFlow(entries, { proto: 'tcp', src: '10.0.0.160', sport: 50001, dst: '183.240.99.224', dport: 80 }).state, 'ESTABLISHED')
  assert.equal(findFlow(entries, { proto: 'tcp', src: '10.0.0.160', sport: 1, dst: '183.240.99.224', dport: 80 }), null)
  assert.equal(findFlow(entries, { proto: 'tcp', src: '10.0.0.160', dst: '111.45.11.5', dport: 80 }).reply.sport, 45677)
  assert.equal(findFlow(entries, { proto: 'udp', src: '10.0.0.160', dst: '111.45.11.5', dport: 80 }), null)
})

test('dnsEvidence:回复方是 DNS 服务器本人 = 没被劫持;回复方变成 tun 对端 = 被内核劫持', () => {
  const clean = dnsEvidence(parseConntrack([CT_DNS, CT_REDIRECT].join('\n')), { src: '10.0.0.160', server: '10.0.0.1' })
  assert.deepEqual({ flows: clean.flows, hijacked: clean.hijacked, answeredBy: clean.answeredBy }, { flows: 1, hijacked: false, answeredBy: '10.0.0.1' })
  const hijacked = dnsEvidence(parseConntrack([CT_DNS, CT_DNS_HIJACK].join('\n')), { src: '10.0.0.160', server: '10.0.0.1' })
  assert.deepEqual({ flows: hijacked.flows, hijacked: hijacked.hijacked, answeredBy: hijacked.answeredBy }, { flows: 2, hijacked: true, answeredBy: '172.19.0.2' })
  assert.equal(dnsEvidence([], { src: '10.0.0.160', server: '10.0.0.1' }).flows, 0)
})

test('classifyEntry:回复方改写成路由器自己的地址 = 被 redirect 进内核', () => {
  const flow = parseConntrack(CT_REDIRECT)[0]
  const r = classifyEntry({ flow, localAddresses: ['10.0.0.1', '192.168.3.35'], route: { line: 'x', dev: 'eth0' } })
  assert.equal(r.kind, 'kernel')
  assert.equal(r.via, 'redirect')
  assert.equal(r.redirectPort, 45677)
  assert.equal(r.evidence.conntrack, CT_REDIRECT)
})

test('classifyEntry:打了 tun 输入标记 = 进内核(tun);内核连接表里有 = 进内核(纯 tun 模式)', () => {
  const marked = parseConntrack(CT_TUN_MARK)[0]
  assert.deepEqual([classifyEntry({ flow: marked, tunMark: TUN_INPUT_MARK }).kind, classifyEntry({ flow: marked, tunMark: TUN_INPUT_MARK }).via], ['kernel', 'tun'])
  const plain = parseConntrack(CT_FORWARD)[0]
  const r = classifyEntry({ flow: plain, localAddresses: ['10.0.0.1'], route: { line: 'x', dev: 'tun0' }, kernelConn: true })
  assert.deepEqual([r.kind, r.via], ['kernel', 'connection-table'])
})

test('classifyEntry:没改写、没标记、连接表没有、路由从 WAN 设备转出 = 旁路;回包发往 WAN 地址记为 masquerade', () => {
  const flow = parseConntrack(CT_FORWARD)[0]
  const r = classifyEntry({ flow, localAddresses: ['10.0.0.1', '192.168.3.35'], tunDevice: 'tun0', route: { line: '183.240.99.224 from 10.0.0.160 via 192.168.3.1 dev eth0', dev: 'eth0', via: '192.168.3.1' }, kernelConn: false, deviceAddresses: ['192.168.3.35'] })
  assert.equal(r.kind, 'bypass')
  assert.equal(r.via, 'forward')
  assert.equal(r.device, 'eth0')
  assert.equal(r.gateway, '192.168.3.1')
  assert.equal(r.masquerade, true)
  assert.equal(classifyEntry({ flow, localAddresses: ['10.0.0.1'], route: { line: 'x', dev: 'eth0' }, deviceAddresses: [] }).masquerade, false)
})

test('classifyEntry:没有 conntrack / 改写到别处 / 路由查不到 / 路由却进 tun,一律不判旁路', () => {
  const flow = parseConntrack(CT_FORWARD)[0]
  assert.deepEqual([classifyEntry({ flow: null }).kind, classifyEntry({ flow: null }).reason], ['unknown', 'no-conntrack'])
  const elsewhere = parseConntrack(CT_REDIRECT)[0]
  const e = classifyEntry({ flow: elsewhere, localAddresses: ['192.168.3.35'], route: { line: 'x', dev: 'eth0' } })
  assert.deepEqual([e.kind, e.reason, e.rewrittenTo], ['unknown', 'dnat-elsewhere', '10.0.0.1:45677'])
  assert.equal(classifyEntry({ flow, route: null }).reason, 'no-route')
  assert.equal(classifyEntry({ flow, route: { line: 'x', dev: 'tun0' }, tunDevice: 'tun0' }).reason, 'route-tun')
})

test('parseLease / parseRouteGet / parseInterfaceStatus / dnsmasqForwardFor / tunSettings', () => {
  assert.deepEqual(parseLease('udhcpc: started\nLEASE ip=10.0.0.160 mask=24 router=10.0.0.1 dns=10.0.0.1 10.0.0.2\n'), { ip: '10.0.0.160', mask: 24, gateway: '10.0.0.1', dns: ['10.0.0.1', '10.0.0.2'] })
  assert.equal(parseLease('udhcpc: no lease, failing'), null)
  assert.deepEqual(parseRouteGet('9.9.9.9 from 10.0.0.160 via 172.19.0.2 dev tun0 table 2022 mark 0x2023 \n    cache iif br-lan'), { line: '9.9.9.9 from 10.0.0.160 via 172.19.0.2 dev tun0 table 2022 mark 0x2023', dev: 'tun0', via: '172.19.0.2', table: '2022' })
  assert.equal(parseRouteGet(''), null)
  assert.deepEqual(parseInterfaceStatus('{"up":true,"l3_device":"br-lan","ipv4-address":[{"address":"10.0.0.1","mask":24}]}'), { device: 'br-lan', address: '10.0.0.1', mask: 24, up: true })
  assert.equal(parseInterfaceStatus('not json'), null)
  const conf = 'server=/google/127.0.0.1#7853\nserver=/.youtube.com/127.0.0.1#7853\nserver=/baidu.jp/127.0.0.1#7853\n'
  assert.deepEqual(dnsmasqForwardFor(conf, 'www.google'), { forward: 'kernel', suffix: 'google', to: '127.0.0.1#7853' })
  assert.equal(dnsmasqForwardFor(conf, 'm.youtube.com').forward, 'kernel')
  assert.equal(dnsmasqForwardFor(conf, 'www.baidu.com').forward, 'upstream')
  assert.equal(dnsmasqForwardFor(conf, 'notbaidu.jp').forward, 'upstream')
  assert.deepEqual(tunSettings({ inbounds: [{ type: 'tun', interface_name: 'utun9', auto_redirect: true }] }), { device: 'utun9', autoRedirect: true, inputMark: 0x2023, outputMark: 0x2024 })
  assert.deepEqual(tunSettings(null), { device: 'tun0', autoRedirect: false, inputMark: 0x2023, outputMark: 0x2024 })
})

test('probeCapability:缺什么列什么;都齐了 ok', async () => {
  const bad = createMockContext({ execResults: { 'ip netns list': { code: 255, stderr: 'Object "netns" is unknown' }, 'modprobe veth': { code: 1 }, 'which udhcpc': { code: 1 } } })
  const r = await probeCapability(bad, { uid: 1000 })
  assert.equal(r.ok, false)
  assert.deepEqual(r.missing, ['root', 'netns', 'veth', 'lan', 'conntrack', 'dhcp'])
  const good = createMockContext({
    files: { '/sys/module/veth': '', '/proc/net/nf_conntrack': '', '/sbin/udhcpc': '' },
    execResults: { 'ubus call network.interface.lan status': { stdout: '{"up":true,"l3_device":"br-lan","ipv4-address":[{"address":"10.0.0.1","mask":24}]}' } },
  })
  const ok = await probeCapability(good, { uid: 0 })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.lan, { device: 'br-lan', address: '10.0.0.1', mask: 24, up: true })
})

test('readLanInterface:没有 ubus 时按 br-lan 的地址退回', async () => {
  const ctx = createMockContext({ execResults: { 'ubus call network.interface.lan status': { code: 127 }, 'ip -4 -o addr show dev br-lan': { stdout: '5: br-lan    inet 10.0.0.1/24 brd 10.0.0.255 scope global br-lan\\       valid_lft forever' } } })
  assert.deepEqual(await readLanInterface(ctx), { device: 'br-lan', address: '10.0.0.1', mask: 24, up: true })
})

test('ensureProbeNetns:按顺序建命名空间、veth 挂到 LAN 网桥、固定 MAC、DHCP 取址;拿不到租约就拆掉并报错', async () => {
  const dhcpKey = `ip netns exec ${PROBE_NETNS} udhcpc -i ${PROBE_VETH_NS} -n -q -t 4 -T 1 -x hostname:openbox-probe -s ${PROBE_DHCP_SCRIPT}`
  const ctx = createMockContext({ execResults: { 'ip netns list': { stdout: '' }, [dhcpKey]: { stdout: 'LEASE ip=10.0.0.160 mask=24 router=10.0.0.1 dns=10.0.0.1\n' } } })
  await teardownProbeNetns(ctx)
  ctx.calls.length = 0
  const lease = await ensureProbeNetns(ctx, { lan: { device: 'br-lan', address: '10.0.0.1', mask: 24 } })
  assert.equal(lease.ip, '10.0.0.160')
  assert.equal(lease.mac, PROBE_MAC)
  assert.equal(lease.reused, false)
  assert.deepEqual(lease.dns, ['10.0.0.1'])
  const cmds = ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))
  const order = [
    `ip netns add ${PROBE_NETNS}`,
    `ip link add ${PROBE_VETH_HOST} type veth peer name ${PROBE_VETH_NS}`,
    `ip link set ${PROBE_VETH_NS} netns ${PROBE_NETNS}`,
    `ip link set ${PROBE_VETH_HOST} master br-lan up`,
    `ip netns exec ${PROBE_NETNS} ip link set lo up`,
    `ip netns exec ${PROBE_NETNS} ip link set ${PROBE_VETH_NS} address ${PROBE_MAC}`,
    `ip netns exec ${PROBE_NETNS} ip link set ${PROBE_VETH_NS} up`,
    `chmod +x ${PROBE_DHCP_SCRIPT}`,
    dhcpKey,
  ]
  let last = -1
  for (const step of order) {
    const i = cmds.indexOf(step)
    assert.ok(i > last, `expected ${step} after previous step; calls: ${cmds.join(' | ')}`)
    last = i
  }
  assert.equal(ctx.files[PROBE_DHCP_SCRIPT], DHCP_SCRIPT)
  // 第二次:命名空间还在就复用,不再跑 DHCP
  ctx.execResults = undefined
  const ctx2 = ctx
  ctx2.calls.length = 0
  const again = await ensureProbeNetns(Object.assign(ctx2, { exec: async (cmd, args = []) => { ctx2.calls.push({ cmd, args }); return [cmd, ...args].join(' ') === 'ip netns list' ? { code: 0, stdout: `${PROBE_NETNS} (id: 0)\n`, stderr: '' } : { code: 0, stdout: '', stderr: '' } } }), { lan: { device: 'br-lan' } })
  assert.equal(again.reused, true)
  assert.ok(!ctx2.calls.some((c) => c.args.includes('udhcpc')))
  await teardownProbeNetns(ctx2)
  // 拿不到租约:拆掉、报错
  const fail = createMockContext({ execResults: { [dhcpKey]: { code: 1, stderr: 'udhcpc: no lease, failing' } } })
  await assert.rejects(ensureProbeNetns(fail, { lan: { device: 'br-lan' } }), /dhcp: udhcpc: no lease, failing/)
  assert.ok(fail.calls.some((c) => [c.cmd, ...c.args].join(' ') === `ip netns del ${PROBE_NETNS}`))
})

test('bypassSetHas:集合不存在 = 没有原生旁路;存在时按 nft get element 的退出码判', async () => {
  const none = createMockContext({ execResults: { 'nft list set inet sing-box inet4_route_exclude_address_set': { code: 1 } } })
  assert.deepEqual(await bypassSetHas(none, '1.2.3.4'), { set: null, hit: false })
  const hit = createMockContext({ execResults: { 'nft get element inet sing-box inet4_route_exclude_address_set { 1.2.3.4 }': { code: 0, stdout: '{ 1.0.0.0-1.255.255.255 }' } } })
  assert.deepEqual(await bypassSetHas(hit, '1.2.3.4'), { set: 'inet4_route_exclude_address_set', hit: true })
  const miss = createMockContext({ execResults: { 'nft get element inet sing-box inet6_route_exclude_address_set { 2001:db8::1 }': { code: 1 } } })
  assert.deepEqual(await bypassSetHas(miss, '2001:db8::1'), { set: 'inet6_route_exclude_address_set', hit: false })
})
