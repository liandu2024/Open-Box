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

  assert.deepEqual(skipped, [{ name: 'Legacy', type: 'snell' }])
})

test('非 Clash 文本返回空', () => {
  assert.deepEqual(parseClashProxies('just: a string').nodes, [])
})
