import assert from 'node:assert/strict'
import test from 'node:test'
import { parseClashProxies } from './clash.mjs'

const yamlDoc = `
proxies:
  - name: "US-SS"
    type: ss
    server: us.example.com
    port: 8388
    cipher: aes-256-gcm
    password: sspw
  - name: "JP-VMess"
    type: vmess
    server: jp.example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    alterId: 0
    cipher: auto
    network: ws
    tls: true
    servername: jp.example.com
    ws-opts:
      path: /vm
      headers:
        Host: cdn.jp.com
  - name: "HK-Trojan"
    type: trojan
    server: hk.example.com
    port: 443
    password: tjpw
    sni: hk.example.com
  - name: "WG"
    type: wireguard
    server: wg.example.com
    port: 51820
    private-key: privkey==
    public-key: pubkey==
    ip: 10.0.0.2
  - name: "SG-VLESS"
    type: vless
    server: sg.example.com
    port: 443
    uuid: 22222222-2222-2222-2222-222222222222
    flow: xtls-rprx-vision
    network: ws
    tls: true
    servername: sg.example.com
    ws-opts:
      path: /vl
      headers:
        Host: cdn.sg.com
  - name: "DE-Hy2"
    type: hysteria2
    server: de.example.com
    port: 4432
    password: hy2pw
    sni: de.example.com
    obfs: salamander
    obfs-password: obfspw
  - name: "FR-Tuic"
    type: tuic
    server: fr.example.com
    port: 4433
    uuid: 33333333-3333-3333-3333-333333333333
    password: tuicpw
    congestion-controller: bbr
    sni: fr.example.com
    alpn:
      - h3
  - name: "Legacy"
    type: snell
    server: x.com
    port: 1234
`

test('parseClashProxies 映射七协议子集,跳过未知', () => {
  const { nodes, skipped } = parseClashProxies(yamlDoc)
  const byName = Object.fromEntries(nodes.map((n) => [n.originalTag, n]))

  assert.equal(byName['US-SS'].type, 'shadowsocks')
  assert.equal(byName['US-SS'].fields.method, 'aes-256-gcm')
  assert.equal(byName['US-SS'].fields.password, 'sspw')

  assert.equal(byName['JP-VMess'].type, 'vmess')
  assert.equal(byName['JP-VMess'].fields.uuid, '11111111-1111-1111-1111-111111111111')
  assert.equal(byName['JP-VMess'].fields.alter_id, 0)
  assert.equal(byName['JP-VMess'].fields.transport.type, 'ws')
  assert.equal(byName['JP-VMess'].fields.transport.path, '/vm')
  assert.equal(byName['JP-VMess'].fields.transport.headers.Host, 'cdn.jp.com')
  assert.equal(byName['JP-VMess'].fields.tls.enabled, true)
  assert.equal(byName['JP-VMess'].fields.tls.server_name, 'jp.example.com')

  assert.equal(byName['HK-Trojan'].type, 'trojan')
  assert.equal(byName['HK-Trojan'].fields.password, 'tjpw')

  assert.equal(byName['WG'].type, 'wireguard')
  assert.equal(byName['WG'].fields.private_key, 'privkey==')
  assert.equal(byName['WG'].fields.peer_public_key, 'pubkey==')
  assert.deepEqual(byName['WG'].fields.local_address, ['10.0.0.2'])

  assert.equal(byName['SG-VLESS'].type, 'vless')
  assert.equal(byName['SG-VLESS'].fields.uuid, '22222222-2222-2222-2222-222222222222')
  assert.equal(byName['SG-VLESS'].fields.flow, 'xtls-rprx-vision')
  assert.equal(byName['SG-VLESS'].fields.transport.type, 'ws')
  assert.equal(byName['SG-VLESS'].fields.transport.path, '/vl')
  assert.equal(byName['SG-VLESS'].fields.transport.headers.Host, 'cdn.sg.com')
  assert.equal(byName['SG-VLESS'].fields.tls.enabled, true)
  assert.equal(byName['SG-VLESS'].fields.tls.server_name, 'sg.example.com')

  assert.equal(byName['DE-Hy2'].type, 'hysteria2')
  assert.equal(byName['DE-Hy2'].fields.password, 'hy2pw')
  assert.equal(byName['DE-Hy2'].fields.tls.server_name, 'de.example.com')
  assert.equal(byName['DE-Hy2'].fields.obfs.type, 'salamander')
  assert.equal(byName['DE-Hy2'].fields.obfs.password, 'obfspw')

  assert.equal(byName['FR-Tuic'].type, 'tuic')
  assert.equal(byName['FR-Tuic'].fields.uuid, '33333333-3333-3333-3333-333333333333')
  assert.equal(byName['FR-Tuic'].fields.password, 'tuicpw')
  assert.equal(byName['FR-Tuic'].fields.congestion_control, 'bbr')
  assert.equal(byName['FR-Tuic'].fields.tls.server_name, 'fr.example.com')
  assert.deepEqual(byName['FR-Tuic'].fields.tls.alpn, ['h3'])

  assert.deepEqual(skipped, [{ name: 'Legacy', type: 'snell', reason: 'unsupported-type' }])
})

// Clash 侧同一个 bug:hysteria2 / tuic 之前自己拼 tls,skip-cert-verify 与
// client-fingerprint 被丢掉,自签 / 过期证书的自建节点连不上。
test('clash hysteria2 / tuic 采集 skip-cert-verify 与 client-fingerprint', () => {
  const yaml = [
    'proxies:',
    '  - {"name":"H","type":"hysteria2","server":"h.example.com","port":8443,"password":"pw","sni":"kami.im","skip-cert-verify":true,"obfs":"salamander","obfs-password":"o"}',
    '  - {"name":"T","type":"tuic","server":"t.example.com","port":443,"uuid":"33333333-3333-3333-3333-333333333333","password":"pw","sni":"kami.im","alpn":["h3","h2"],"skip-cert-verify":true,"client-fingerprint":"chrome","congestion-controller":"bbr"}',
    '  - {"name":"P","type":"hysteria2","server":"p.example.com","port":8443,"password":"pw","sni":"p.example.com"}',
  ].join('\n')
  const { nodes } = parseClashProxies(yaml)
  const byName = Object.fromEntries(nodes.map((n) => [n.tag, n]))
  assert.equal(byName.H.fields.tls.insecure, true)
  assert.equal(byName.H.fields.tls.server_name, 'kami.im')
  assert.equal(byName.H.fields.obfs.password, 'o')
  assert.equal(byName.T.fields.tls.insecure, true)
  assert.deepEqual(byName.T.fields.tls.alpn, ['h3', 'h2'])
  assert.deepEqual(byName.T.fields.tls.utls, { enabled: true, fingerprint: 'chrome' })
  assert.equal(byName.T.fields.congestion_control, 'bbr')
  // 没写 skip-cert-verify 的照旧严格校验
  assert.equal(byName.P.fields.tls.insecure, undefined)
  assert.equal(byName.P.fields.tls.enabled, true)
})

test('Clash unsafe client-fingerprint 归一为 chrome', () => {
  const { nodes } = parseClashProxies('proxies:\n  - {name: U, type: trojan, server: u.example.com, port: 443, password: pw, tls: true, client-fingerprint: unsafe}')
  assert.equal(nodes[0].fields.tls.utls.fingerprint, 'chrome')
})

test('非 Clash 文本返回空', () => {
  assert.deepEqual(parseClashProxies('just: a string').nodes, [])
})

test('clash vless reality + h2 归一 + ss obfs 插件按 SIP003 带过去', () => {
  const doc = `
proxies:
  - name: "R-VLESS"
    type: vless
    server: r.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    tls: true
    servername: r.com
    network: h2
    h2-opts: { path: /h2, host: [cdn.com] }
    reality-opts: { public-key: PUBK, short-id: "01ab" }
    client-fingerprint: chrome
    flow: xtls-rprx-vision
  - name: "SS-Plugin"
    type: ss
    server: s.com
    port: 8388
    cipher: aes-256-gcm
    password: pw
    plugin: obfs
    plugin-opts: { mode: http, host: www.bing.com }
  - name: "SS-ShadowTLS"
    type: ss
    server: s.com
    port: 8388
    cipher: aes-256-gcm
    password: pw
    plugin: shadow-tls
    plugin-opts: { host: cloud.tencent.com, password: x, version: 3 }
  - name: "R-NullSid"
    type: vless
    server: r2.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    tls: true
    servername: r2.com
    reality-opts: { public-key: PUBK2, short-id: null }
    flow: xtls-rprx-vision-udp443
`
  const { nodes, skipped } = parseClashProxies(doc)
  const r = nodes.find((n) => n.originalTag === 'R-VLESS')
  assert.equal(r.fields.tls.reality.public_key, 'PUBK')
  assert.equal(r.fields.tls.reality.short_id, '01ab')
  assert.equal(r.fields.tls.utls.fingerprint, 'chrome')
  assert.equal(r.fields.transport.type, 'http')
  assert.equal(r.fields.transport.path, '/h2')
  assert.equal(r.fields.transport.headers.Host, 'cdn.com')
  const ssp = nodes.find((n) => n.originalTag === 'SS-Plugin')
  assert.equal(ssp.fields.plugin, 'obfs-local')
  assert.equal(ssp.fields.plugin_opts, 'obfs=http;obfs-host=www.bing.com')
  // 内核没有的插件才跳过,且带原因
  assert.deepEqual(skipped, [{ name: 'SS-ShadowTLS', type: 'ss', reason: 'unsupported-plugin', detail: 'shadow-tls' }])
  // short-id: null 不能变成字符串 "null";-udp443 的 flow 归一成 vision(GitHub #19 #23)
  const r2 = nodes.find((n) => n.originalTag === 'R-NullSid')
  assert.equal(r2.fields.tls.reality.short_id, undefined)
  assert.equal(r2.fields.flow, 'xtls-rprx-vision')
})

test('YAML 里不加引号的数字密码转成字符串;kcp / xhttp 传输层的条目记为 skipped', () => {
  const yaml = [
    'proxies:',
    '  - { name: NUM, type: trojan, server: n.example.com, port: 443, password: 12345678, sni: n.example.com }',
    '  - { name: SSNUM, type: ss, server: s.example.com, port: 8388, cipher: aes-256-gcm, password: 000123 }',
    '  - { name: KCP, type: vmess, server: k.example.com, port: 443, uuid: 11111111-1111-1111-1111-111111111111, alterId: 0, cipher: auto, network: kcp }',
    '  - { name: XH, type: vless, server: x.example.com, port: 443, uuid: 11111111-1111-1111-1111-111111111111, network: xhttp, tls: true }',
  ].join('\n')
  const { nodes, skipped } = parseClashProxies(yaml)
  const byName = Object.fromEntries(nodes.map((n) => [n.tag, n]))
  assert.equal(byName.NUM.fields.password, '12345678')
  assert.equal(typeof byName.NUM.fields.password, 'string')
  assert.equal(byName.SSNUM.fields.password, '123')
  assert.deepEqual(skipped.map((s) => s.name).sort(), ['KCP', 'XH'])
  assert.ok(skipped.every((s) => s.reason === 'invalid' && s.detail))
})

test('Clash socks5 收进来;带 tls 的记为 skipped(内核的 socks 出站没有 TLS)', () => {
  const yaml = [
    'proxies:',
    '  - { name: SK, type: socks5, server: 1.2.3.4, port: 1080, username: alice, password: 123456 }',
    '  - { name: SKANON, type: socks5, server: 5.6.7.8, port: 1081 }',
    '  - { name: SKTLS, type: socks5, server: 9.9.9.9, port: 1443, username: u, password: p, tls: true }',
  ].join('\n')
  const { nodes, skipped } = parseClashProxies(yaml)
  const byName = Object.fromEntries(nodes.map((n) => [n.tag, n]))
  assert.equal(byName.SK.type, 'socks')
  assert.equal(byName.SK.fields.username, 'alice')
  assert.equal(byName.SK.fields.password, '123456')          // 数字密码转成字符串
  assert.equal(typeof byName.SK.fields.password, 'string')
  assert.equal(byName.SKANON.fields.username, undefined)
  assert.deepEqual(skipped.map((s) => s.name), ['SKTLS'])
})

test('vless / vmess / trojan 套 ws、h2 没写 servername 时 SNI 按 Host 头兜底(CF 优选:server 是 IP,域名只在 Host 里)', () => {
  const yaml = `proxies:
  - { name: cf-vless, type: vless, server: 104.16.1.1, port: 443, uuid: 22222222-2222-2222-2222-222222222222, tls: true, network: ws, ws-opts: { path: /vl, headers: { Host: cdn.example.com } } }
  - { name: cf-vless-sni, type: vless, server: 104.16.1.1, port: 443, uuid: 22222222-2222-2222-2222-222222222222, tls: true, servername: sni.example.com, network: ws, ws-opts: { headers: { Host: cdn.example.com } } }
  - { name: cf-vmess-h2, type: vmess, server: 104.16.1.2, port: 443, uuid: 22222222-2222-2222-2222-222222222222, alterId: 0, cipher: auto, tls: true, network: h2, h2-opts: { host: [h2.example.com], path: /h2 } }
  - { name: cf-trojan, type: trojan, server: 104.16.1.3, port: 443, password: pw, network: ws, ws-opts: { headers: { Host: tj.example.com } } }
  - { name: plain-vless, type: vless, server: 104.16.1.4, port: 443, uuid: 22222222-2222-2222-2222-222222222222, tls: true, network: ws, ws-opts: { path: /x } }
`
  const { nodes } = parseClashProxies(yaml)
  const by = Object.fromEntries(nodes.map((n) => [n.originalTag, n]))
  assert.equal(by['cf-vless'].fields.tls.server_name, 'cdn.example.com')
  assert.equal(by['cf-vless-sni'].fields.tls.server_name, 'sni.example.com')   // 写了 servername 就用它
  assert.equal(by['cf-vmess-h2'].fields.tls.server_name, 'h2.example.com')
  assert.equal(by['cf-trojan'].fields.tls.server_name, 'tj.example.com')
  assert.equal(by['plain-vless'].fields.tls.server_name, undefined)          // 没 Host 就不猜
})
