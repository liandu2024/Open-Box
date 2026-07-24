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
  // 组织多协议订阅样本(分享链接)
  const sub = [
    'ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@us.example.com:8388#US-01',
    'trojan://pw@jp.example.com:443?sni=jp.example.com#JP-01',
    'hysteria2://pw@hk.example.com:8443?sni=hk.example.com#HK-01',
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
})

test('坏节点(缺 method)导致 check 失败', { skip: hasBin ? false : 'sing-box 二进制缺失' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-checkbad-'))
  const config = {
    log: { level: 'warn' },
    inbounds: [{ type: 'tun', tag: 't', address: ['172.19.0.1/30'], auto_route: true, stack: 'mixed' }],
    outbounds: [{ type: 'direct', tag: 'direct' }, { type: 'shadowsocks', tag: 'bad', server: 'a.com', server_port: 8388 }],
  }
  const cfgPath = path.join(dir, 'bad.json')
  fs.writeFileSync(cfgPath, JSON.stringify(config))
  assert.throws(() => execFileSync(sbBin, ['check', '-c', cfgPath], { stdio: 'pipe' }))
})
