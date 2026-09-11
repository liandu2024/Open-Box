import assert from 'node:assert/strict'
import test from 'node:test'
import { elapsedMs, traceDnsQuery, openKernelLogTap } from './dns-trace.mjs'

// 正式路由器 sing-box 1.14.0 level=debug 的原始行(2026-09-11 截)
const PROXY = [
  '[1819020931 0ms] inbound/direct[dns-in]: inbound packet connection from 192.168.3.167:49426',
  '[2051838111 0ms] inbound/direct[dns-in]: inbound packet connection from 192.168.3.167:32896',
  '[2051838111 0ms] inbound/direct[dns-in]: inbound packet connection to 0.0.0.0:7853',
  '[2051838111 0ms] router: match[1] inbound=dns-in => hijack-dns',
  '[2051838111 0ms] dns: exchange chatgpt.com. IN AAAA',
  '[1819020931 0ms] dns: exchange chatgpt.com. IN A',
  '[2051838111 0ms] dns: match[9] rule_set=geosite-category-ai-!cn => route(dns-policy-4)',
  '[1819020931 0ms] dns: match[9] rule_set=geosite-category-ai-!cn => route(dns-policy-4)',
  '[2051838111 0ms] dns: strategy rejected',
  '[1819020931 0ms] outbound/tuic[VW | 英国-HOME-02]: outbound connection to 1.1.1.1:53',
  '[1819020931 270ms] dns: exchanged chatgpt.com NOERROR 300',
  '[1819020931 270ms] dns: exchanged A chatgpt.com. 300 IN A 104.18.32.47',
  '[1819020931 270ms] dns: exchanged A chatgpt.com. 300 IN A 172.64.155.209',
]

test('时长写法:0ms / 270ms / 2.49s / 5.0s / 1m2s', () => {
  assert.equal(elapsedMs('0ms'), 0)
  assert.equal(elapsedMs('270ms'), 270)
  assert.equal(elapsedMs('2.49s'), 2490)
  assert.equal(elapsedMs('5.0s'), 5000)
  assert.equal(elapsedMs('1m2s'), 62000)
  assert.equal(elapsedMs('bogus'), null)
})

test('经代理 DNS 的查询:A 记下来源、命中规则、解析器、实际拨号节点、应答与耗时;AAAA 记成被策略拒绝', () => {
  const r = traceDnsQuery(PROXY, 'chatgpt.com')
  assert.equal(r.seen, true)
  assert.equal(r.A.source, '192.168.3.167')
  assert.equal(r.A.ruleIndex, 9)
  assert.equal(r.A.ruleText, 'rule_set=geosite-category-ai-!cn')
  assert.equal(r.A.server, 'dns-policy-4')
  assert.deepEqual(r.A.outbound, { type: 'tuic', tag: 'VW | 英国-HOME-02', to: '1.1.1.1:53' })
  assert.equal(r.A.result, 'exchanged')
  assert.equal(r.A.rcode, 'NOERROR')
  assert.equal(r.A.ttl, 300)
  assert.equal(r.A.ms, 270)
  assert.deepEqual(r.A.answers, ['104.18.32.47', '172.64.155.209'])
  assert.equal(r.AAAA.result, 'rejected')
  assert.equal(r.AAAA.server, 'dns-policy-4')
  // 大小写 / 末尾点都认
  assert.equal(traceDnsQuery(PROXY, 'ChatGPT.com.').seen, true)
  // 别的域名不算
  assert.equal(traceDnsQuery(PROXY, 'openai.com').seen, false)
})

test('直连解析、缓存命中、上游失败、规则直接处理(predefined)各自的结果', () => {
  const direct = ['[1 0ms] inbound/direct[dns-in]: inbound packet connection from 127.0.0.1:5', '[1 0ms] dns: exchange www.baidu.com. IN A', '[1 0ms] dns: match[19] rule_set=geosite-cn => route(dns-direct)',
    '[1 0ms] outbound/direct[直连]: outbound packet connection to 211.139.29.150:53', '[1 12ms] dns: exchanged www.baidu.com NOERROR 60', '[1 12ms] dns: exchanged A www.baidu.com. 60 IN A 183.240.99.224']
  const d = traceDnsQuery(direct, 'www.baidu.com').A
  assert.equal(d.server, 'dns-direct'); assert.equal(d.outbound.tag, '直连'); assert.deepEqual(d.answers, ['183.240.99.224']); assert.equal(d.ms, 12)
  // 经 CNAME 的答案:A 记录的 owner 是别名目标,同一 id 下照样算这条查询的答案
  const cname = ['[9 0ms] dns: exchange www.baidu.com. IN A', '[9 0ms] dns: match[23] rule_set=geosite-cn => route(dns-direct)', '[9 1ms] dns: exchanged www.baidu.com NOERROR 44',
    '[9 1ms] dns: exchanged CNAME www.baidu.com. 44 IN CNAME www.a.shifen.com.', '[9 1ms] dns: exchanged A www.a.shifen.com. 44 IN A 183.240.99.224', '[9 1ms] dns: exchanged A www.a.shifen.com. 44 IN A 111.45.11.5']
  assert.deepEqual(traceDnsQuery(cname, 'www.baidu.com').A.answers, ['183.240.99.224', '111.45.11.5'])
  const cached = ['[2 0ms] dns: exchange www.baidu.com. IN A', '[2 0ms] dns: match[19] rule_set=geosite-cn => route(dns-direct)', '[2 0ms] dns: cached www.baidu.com NOERROR 41', '[2 0ms] dns: cached A www.baidu.com. 41 IN A 183.240.99.224']
  const c = traceDnsQuery(cached, 'www.baidu.com').A
  assert.equal(c.result, 'cached'); assert.equal(c.ttl, 41); assert.deepEqual(c.answers, ['183.240.99.224'])
  const failed = ['[3 0ms] dns: exchange x.example. IN A', '[3 0ms] dns: match[11] rule_set=geosite-gfw => route(dns-policy-11)', '[3 0ms] outbound/anytls[瞬云 | 日本-01]: outbound connection to 1.1.1.1:53', '[3 5.0s] dns: exchange failed for x.example IN A: read response: read tcp 1.2.3.4:1->1.1.1.1:53: connection reset']
  const f = traceDnsQuery(failed, 'x.example').A
  assert.equal(f.result, 'failed'); assert.match(f.error, /connection reset/); assert.equal(f.ms, 5000); assert.equal(f.outbound.tag, '瞬云 | 日本-01')
  const action = ['[4 0ms] dns: exchange ads.example. IN A', '[4 0ms] dns: match[2] rule_set=geosite-category-ads-all => predefined']
  const a = traceDnsQuery(action, 'ads.example').A
  assert.equal(a.result, 'action'); assert.equal(a.action, 'predefined'); assert.equal(a.server, '')
  // 收到查询、日志里还没有应答
  const pending = ['[5 0ms] dns: exchange slow.example. IN A', '[5 0ms] dns: match[11] rule_set=geosite-gfw => route(dns-policy-11)']
  assert.equal(traceDnsQuery(pending, 'slow.example').A.result, 'pending')
})

test('同一时间窗里别的终端也在查同一个域名:优先取探测终端(或本机转发)发的那条,没有就取最后一条', () => {
  const lines = [
    '[10 0ms] inbound/direct[dns-in]: inbound packet connection from 192.168.3.100:1', '[10 0ms] dns: exchange a.example. IN A', '[10 0ms] dns: match[9] x => route(dns-policy-4)', '[10 100ms] dns: exchanged a.example NOERROR 1', '[10 100ms] dns: exchanged A a.example. 1 IN A 1.1.1.1',
    '[11 0ms] inbound/direct[dns-in]: inbound packet connection from 192.168.3.167:2', '[11 0ms] dns: exchange a.example. IN A', '[11 0ms] dns: match[9] x => route(dns-policy-4)', '[11 90ms] dns: exchanged a.example NOERROR 1', '[11 90ms] dns: exchanged A a.example. 1 IN A 2.2.2.2',
    '[12 0ms] inbound/direct[dns-in]: inbound packet connection from 192.168.3.200:3', '[12 0ms] dns: exchange a.example. IN A', '[12 0ms] dns: match[9] x => route(dns-policy-4)', '[12 80ms] dns: exchanged a.example NOERROR 1', '[12 80ms] dns: exchanged A a.example. 1 IN A 3.3.3.3',
  ]
  assert.deepEqual(traceDnsQuery(lines, 'a.example', { preferSources: ['192.168.3.167', '127.0.0.1'] }).A.answers, ['2.2.2.2'])
  assert.deepEqual(traceDnsQuery(lines, 'a.example', { preferSources: ['10.9.9.9'] }).A.answers, ['3.3.3.3'])
  assert.deepEqual(traceDnsQuery(lines, 'a.example').A.answers, ['3.3.3.3'])
})

test('openKernelLogTap:连不上(拒绝 / 超时)时 ready=false 带原因;连上后攒 payload 行,close 不抛', async () => {
  class Refused {
    constructor() { this.handlers = {}; setTimeout(() => this.handlers.error?.(new Error('connect ECONNREFUSED 127.0.0.1:9095')), 0) }
    on(ev, fn) { this.handlers[ev] = fn }
    removeAllListeners() { this.handlers = {} }
    terminate() {}
  }
  const bad = openKernelLogTap({ WebSocketImpl: Refused })
  assert.equal(await bad.ready, false)
  assert.match(bad.error, /ECONNREFUSED/)
  bad.close()
  class Silent { on() {} removeAllListeners() {} terminate() {} }
  const slow = openKernelLogTap({ WebSocketImpl: Silent, connectTimeoutMs: 20 })
  assert.equal(await slow.ready, false)
  assert.equal(slow.error, 'log stream timeout')
  class Good {
    constructor(url, opts) { Good.last = { url, opts }; this.handlers = {}; setTimeout(() => { this.handlers.open?.(); this.handlers.message?.(Buffer.from(JSON.stringify({ type: 'debug', payload: '[7 0ms] dns: exchange a.example. IN A' }))); this.handlers.message?.(Buffer.from('not json')) }, 0) }
    on(ev, fn) { this.handlers[ev] = fn }
    removeAllListeners() { this.handlers = {} }
    terminate() { Good.terminated = true }
  }
  const good = openKernelLogTap({ WebSocketImpl: Good, secret: 's3' })
  assert.equal(await good.ready, true)
  await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(good.lines, ['[7 0ms] dns: exchange a.example. IN A'])
  assert.equal(Good.last.url, 'ws://127.0.0.1:9095/logs?level=debug')
  assert.equal(Good.last.opts.headers.Authorization, 'Bearer s3')
  good.close(); good.close()
  assert.equal(Good.terminated, true)
})
