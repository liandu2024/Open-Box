import assert from 'node:assert/strict'
import test from 'node:test'
import { parseShareLink } from './sharelink.mjs'
import { parseClashProxies } from './clash.mjs'
import { parseSingboxOutbounds } from './singbox-in.mjs'
import { parseSubscription } from './subscription.mjs'
import { emitOutbound } from './emit-outbound.mjs'

// 这三份样本的字段名取自真机抓到的真实机场响应(密码已换成占位符):同一个订阅地址
// 按 User-Agent 返回 base64 分享链接 / Clash YAML / sing-box JSON 三种形态,35 个节点
// 全是 anytls。此前解析器不认识 anytls,三条路都走到 0 个节点。
const SHARELINK =
  'anytls://093812a2-c774-4137-8a6d-ad303a2bd00f@fwe.example.com:23130/?insecure=1&sni=buylite.music.apple.com#香港01'

const CLASH_YAML = `
proxies:
  - client-fingerprint: chrome
    name: 香港01
    password: 093812a2-c774-4137-8a6d-ad303a2bd00f
    port: 23130
    server: fwe.example.com
    skip-cert-verify: true
    sni: buylite.music.apple.com
    type: anytls
    udp: true
`

const SINGBOX_JSON = JSON.stringify({
  outbounds: [
    {
      type: 'anytls',
      tag: '香港01',
      server: 'fwe.example.com',
      server_port: 23130,
      password: '093812a2-c774-4137-8a6d-ad303a2bd00f',
      tls: {
        enabled: true,
        insecure: true,
        server_name: 'buylite.music.apple.com',
        alpn: ['h2', 'http/1.1'],
        utls: { enabled: true, fingerprint: 'chrome' },
      },
    },
  ],
})

test('分享链接:anytls:// 能解析出节点,且带上 sni 与 insecure', () => {
  const node = parseShareLink(SHARELINK)
  assert.ok(node, 'anytls:// 应当被解析,而不是返回 null')
  assert.equal(node.type, 'anytls')
  assert.equal(node.server, 'fwe.example.com')
  assert.equal(node.server_port, 23130)
  assert.equal(node.fields.password, '093812a2-c774-4137-8a6d-ad303a2bd00f')
  // anytls 强制 TLS:链接里没有 security= 参数,但 sni/insecure 必须照样被采集,
  // 否则连不上(机场发的 anytls 链接基本都带伪装 sni)
  assert.equal(node.fields.tls.enabled, true)
  assert.equal(node.fields.tls.server_name, 'buylite.music.apple.com')
  assert.equal(node.fields.tls.insecure, true)
})

test('Clash:type: anytls 能解析,skip-cert-verify / client-fingerprint 都带过去', () => {
  const { nodes, skipped } = parseClashProxies(CLASH_YAML)
  assert.equal(skipped.length, 0)
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].type, 'anytls')
  assert.equal(nodes[0].fields.tls.server_name, 'buylite.music.apple.com')
  assert.equal(nodes[0].fields.tls.insecure, true)
  assert.deepEqual(nodes[0].fields.tls.utls, { enabled: true, fingerprint: 'chrome' })
})

test('sing-box JSON:anytls outbound 不再被当成不支持的类型跳过', () => {
  const { nodes, skipped } = parseSingboxOutbounds(SINGBOX_JSON)
  assert.equal(skipped.length, 0)
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].type, 'anytls')
})

test('整段 base64 的 anytls 分享链接订阅能被识别(不再是 unknown)', () => {
  const { nodes, format } = parseSubscription(Buffer.from(SHARELINK + '\n', 'utf8').toString('base64'))
  assert.equal(format, 'sharelink')
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].type, 'anytls')
})

test('生成的 anytls 出站形状与 sing-box 1.13.14 一致', () => {
  const node = parseShareLink(SHARELINK)
  const out = emitOutbound({ ...node, tag: 'anytls-out' })
  assert.equal(out.type, 'anytls')
  assert.equal(out.tag, 'anytls-out')
  assert.equal(out.server, 'fwe.example.com')
  assert.equal(out.server_port, 23130)
  assert.equal(out.password, '093812a2-c774-4137-8a6d-ad303a2bd00f')
  assert.equal(out.tls.enabled, true)
  assert.equal(out.tls.server_name, 'buylite.music.apple.com')
})
