import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from './config.mjs'
import { parseSubscription } from './subscription.mjs'
import { renameNodes } from './rename.mjs'
import { groupNodesByRegion } from './groups.mjs'
import { buildRoute } from './routing.mjs'

const enginedir = path.dirname(fileURLToPath(import.meta.url))
const sbBin = path.resolve(enginedir, '../../.tools/sing-box')
const hasBin = fs.existsSync(sbBin)

const compileSrs = (dir, tag) => {
  const src = path.join(dir, `${tag}.json`)
  const out = path.join(dir, `${tag}.srs`)
  fs.writeFileSync(src, JSON.stringify({ version: 1, rules: [{ domain: [`${tag}.example.com`] }] }))
  execFileSync(sbBin, ['rule-set', 'compile', '--output', out, src])
}

test('生成的配置通过 sing-box check(全协议 + wireguard + DNS 分流 + 广告)', { skip: hasBin ? false : 'sing-box 二进制缺失(panel/.tools/sing-box);运行 pnpm run check:config 前先放置二进制' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-check-'))
  try {
    // 组织多协议订阅样本(分享链接)
    const sub = [
      'ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@us.example.com:8388#US-01',
      'trojan://pw@jp.example.com:443?sni=jp.example.com#JP-01',
      'hysteria2://pw@hk.example.com:8443?sni=hk.example.com#HK-01',
      'anytls://pw@sg.example.com:23130/?insecure=1&sni=buylite.music.apple.com#SG-01',
    ].join('\n')
    const { nodes } = parseSubscription(sub)
    const renamed = renameNodes(nodes)
    const { groups } = groupNodesByRegion(renamed)
    const profile = {
      ipv6: true,
      dns: { split: true, direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' },
      routing: { proxyTag: 'PROXY', categories: [{ ruleset: 'geosite-geolocation-!cn', target: groups[0]?.name || 'PROXY' }], directRulesets: ['geosite-cn', 'geoip-cn'], adBlock: true, adRuleset: 'geosite-category-ads-all', fallback: 'PROXY' },
      rulesetDir: dir,
      clashApiSecret: 'testsecret',
    }
    const config = buildConfig({ nodes: renamed, regionGroups: groups, profile })
    // 为每个被引用的 rule_set tag 造 .srs fixture
    const { rulesetTags } = buildRoute(profile.routing, dir)
    for (const tag of rulesetTags) compileSrs(dir, tag)
    const cfgPath = path.join(dir, 'config.json')
    fs.writeFileSync(cfgPath, JSON.stringify(config))
    // 应通过
    execFileSync(sbBin, ['check', '-c', cfgPath])   // 非 0 会抛错 → 测试失败
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('坏节点(缺 method)导致 check 失败', { skip: hasBin ? false : 'sing-box 二进制缺失' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-checkbad-'))
  try {
    const config = {
      log: { level: 'warn' },
      inbounds: [{ type: 'tun', tag: 't', address: ['172.19.0.1/30'], auto_route: true, stack: 'mixed' }],
      outbounds: [{ type: 'direct', tag: 'direct' }, { type: 'shadowsocks', tag: 'bad', server: 'a.com', server_port: 8388 }],
    }
    const cfgPath = path.join(dir, 'bad.json')
    fs.writeFileSync(cfgPath, JSON.stringify(config))
    assert.throws(() => execFileSync(sbBin, ['check', '-c', cfgPath], { stdio: 'pipe' }))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('生成的配置通过 sing-box check(sing-box JSON 订阅 → wireguard endpoint)', { skip: hasBin ? false : 'sing-box 二进制缺失' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-checkwg-'))
  try {
    // sing-box JSON 格式订阅:一个常规 outbound(shadowsocks)+ 一个 wireguard endpoint。
    // 私钥/对端公钥用 `panel/.tools/sing-box generate wg-keypair` 生成的标准 base64 32 字节密钥,
    // 确保 check 校验的是真实的 key 格式合法性,而不是随手写的占位符。
    const subJson = JSON.stringify({
      outbounds: [
        { type: 'shadowsocks', tag: 'US-SS', server: 'us.example.com', server_port: 8388, method: 'aes-256-gcm', password: 'secretpw' },
      ],
      endpoints: [
        {
          type: 'wireguard',
          tag: 'US-WG',
          address: ['10.0.0.2/32'],
          private_key: 'oIYbSZXnRnvpKgBZ20Fz6tZLetm9UqEiF0wNOgafXkk=',
          peers: [
            { address: 'wg.example.com', port: 51820, public_key: 'vhdYcThImW2+FL5SvTHUcSyX83lRk7mcyKoqAotE8C8=' },
          ],
        },
      ],
    })
    const { nodes, format } = parseSubscription(subJson)
    assert.equal(format, 'singbox')
    const renamed = renameNodes(nodes)
    const { groups } = groupNodesByRegion(renamed)
    const profile = {
      ipv6: true,
      dns: { split: true, direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' },
      routing: { proxyTag: 'PROXY', categories: [{ ruleset: 'geosite-geolocation-!cn', target: groups[0]?.name || 'PROXY' }], directRulesets: ['geosite-cn', 'geoip-cn'], adBlock: false, fallback: 'PROXY' },
      rulesetDir: dir,
      clashApiSecret: 'testsecret',
    }
    const config = buildConfig({ nodes: renamed, regionGroups: groups, profile })
    // 证明 wireguard 路径真的被走通了,而不是被静默丢弃
    assert.ok(Array.isArray(config.endpoints) && config.endpoints.length === 1)
    assert.equal(config.endpoints[0].type, 'wireguard')
    // 为每个被引用的 rule_set tag 造 .srs fixture
    const { rulesetTags } = buildRoute(profile.routing, dir)
    for (const tag of rulesetTags) compileSrs(dir, tag)
    const cfgPath = path.join(dir, 'config.json')
    fs.writeFileSync(cfgPath, JSON.stringify(config))
    // 应通过(非 0 会抛错 → 测试失败,不做 try/catch 吞掉)
    execFileSync(sbBin, ['check', '-c', cfgPath])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('生成的配置通过 sing-box check(dns.mode=dnsmasq;仅 dns-in 入站被劫持,防 hijack 回环回归)', { skip: hasBin ? false : 'sing-box 二进制缺失' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-checkdnsmasq-'))
  try {
    const sub = [
      'ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@us.example.com:8388#US-01',
      'trojan://pw@jp.example.com:443?sni=jp.example.com#JP-01',
      'hysteria2://pw@hk.example.com:8443?sni=hk.example.com#HK-01',
      'anytls://pw@sg.example.com:23130/?insecure=1&sni=buylite.music.apple.com#SG-01',
    ].join('\n')
    const { nodes } = parseSubscription(sub)
    const renamed = renameNodes(nodes)
    const { groups } = groupNodesByRegion(renamed)
    const profile = {
      ipv6: true,
      dns: { split: true, mode: 'dnsmasq', direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' },
      routing: { proxyTag: 'PROXY', categories: [{ ruleset: 'geosite-geolocation-!cn', target: groups[0]?.name || 'PROXY' }], directRulesets: ['geosite-cn', 'geoip-cn'], adBlock: true, adRuleset: 'geosite-category-ads-all', fallback: 'PROXY' },
      rulesetDir: dir,
      clashApiSecret: 'testsecret',
    }
    const config = buildConfig({ nodes: renamed, regionGroups: groups, profile })
    // 结构性不变量断言:即便 sing-box check 通过,也要能单独捕捉 Critical 修复的回归。
    // 1) 存在仅限 dns-in 入站的 hijack-dns 规则
    const hijack = config.route.rules.find((r) => r.action === 'hijack-dns')
    assert.ok(hijack, '应存在 hijack-dns 规则')
    assert.ok(Array.isArray(hijack.inbound) && hijack.inbound.includes('dns-in'), 'hijack-dns 规则应限定 inbound: [dns-in]')
    // 2) 不存在全局 protocol:'dns' 劫持规则(这正是导致 tun→dns-in 转发查询自环的根因)
    assert.ok(!config.route.rules.some((r) => r.protocol === 'dns'), '不应存在 protocol:dns 的全局劫持规则(回环回归)')
    // 3) 存在监听 127.0.0.1:7853 的 direct 入站,供 dnsmasq 上游转发查询
    const dnsIn = config.inbounds.find((i) => i.type === 'direct' && i.tag === 'dns-in')
    assert.ok(dnsIn, '应存在 tag=dns-in 的 direct 入站')
    assert.equal(dnsIn.listen, '127.0.0.1')
    assert.equal(dnsIn.listen_port, 7853)
    // 为每个被引用的 rule_set tag 造 .srs fixture
    const { rulesetTags } = buildRoute(profile.routing, dir)
    for (const tag of rulesetTags) compileSrs(dir, tag)
    const cfgPath = path.join(dir, 'config.json')
    fs.writeFileSync(cfgPath, JSON.stringify(config))
    // 应通过(非 0 会抛错 → 测试失败,不做 try/catch 吞掉)
    execFileSync(sbBin, ['check', '-c', cfgPath])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
