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

  assert.deepEqual(skipped, [{ name: 'Legacy', type: 'snell' }])
})

test('非 Clash 文本返回空', () => {
  assert.deepEqual(parseClashProxies('just: a string').nodes, [])
})

test('clash vless reality + h2 归一 + ss plugin 计入 skipped', () => {
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
`
  const { nodes, skipped } = parseClashProxies(doc)
  const r = nodes.find((n) => n.originalTag === 'R-VLESS')
  assert.equal(r.fields.tls.reality.public_key, 'PUBK')
  assert.equal(r.fields.tls.reality.short_id, '01ab')
  assert.equal(r.fields.tls.utls.fingerprint, 'chrome')
  assert.equal(r.fields.transport.type, 'http')
  assert.equal(r.fields.transport.path, '/h2')
  assert.equal(r.fields.transport.headers.Host, 'cdn.com')
  assert.ok(skipped.some((s) => s.name === 'SS-Plugin'))
})
