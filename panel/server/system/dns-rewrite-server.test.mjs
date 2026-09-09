import assert from 'node:assert/strict'
import test from 'node:test'
import { Resolver } from 'node:dns/promises'
import { QTYPE, RCODE, answerQuery, buildResponse, createDnsRewriteServer, ipv6ToBytes, parseQuery } from './dns-rewrite-server.mjs'
import { normalizeDnsRewrite } from '../engine/dns-rewrite.mjs'

const rulesOf = (list) => normalizeDnsRewrite({ rewrite: { initialized: 1, rules: list } }).rules
const RULES = rulesOf([
  { id: 'g', source: 'services.googleapis.cn', domain: 'services.googleapis.com' },
  { id: 'w', source: '*.ok1248.cn', addresses: ['192.168.3.1', '2001:db8::1'] },
  { id: 'e', source: 'article.ok1248.cn', addresses: ['121.43.244.161'] },
  { id: 'wd', source: '*.example.com', domain: 'target.example.net' },
  { id: 'chain', source: 'alias.review.test', domain: 'article.ok1248.cn' },
  { id: 'loop1', source: 'l1.test', domain: 'l2.test' },
  { id: 'loop2', source: 'l2.test', domain: 'l1.test' },
])
// 假的"内核 :7853":只认几个目标域名
const kernel = async (name, qtype) => {
  if (name === 'services.googleapis.com') {
    return qtype === QTYPE.AAAA
      ? { rcode: RCODE.NOERROR, records: [{ address: '2404:6800:4004:80b::200a', ttl: 120 }] }
      : { rcode: RCODE.NOERROR, records: [{ address: '172.217.114.4', ttl: 30 }, { address: '172.217.114.5', ttl: 30 }] }
  }
  if (name === 'target.example.net') return qtype === QTYPE.A ? { rcode: RCODE.NOERROR, records: [{ address: '203.0.113.9', ttl: 300 }] } : { rcode: RCODE.NOERROR, records: [] }
  if (name === 'nx.example.net') return { rcode: RCODE.NXDOMAIN, records: [], error: 'ENOTFOUND' }
  if (name === 'slow.example.net') return { rcode: RCODE.SERVFAIL, records: [], error: 'ETIMEOUT' }
  return { rcode: RCODE.NXDOMAIN, records: [], error: 'ENOTFOUND' }
}
const q = (qname, qtype) => ({ id: 1, rd: true, qname, qtype, qclass: 1, udpSize: 4096, questionRaw: Buffer.alloc(0) })
const opts = (over = {}) => ({ rules: RULES, ipv6: true, resolveKernel: kernel, resolveFallback: async () => ({ rcode: RCODE.SERVFAIL, records: [] }), ...over })

test('域名型:回 CNAME 链 + 目标的 A / AAAA(所有者是目标),CNAME 的 TTL 跟目标记录里最短的走', async () => {
  const a = await answerQuery(q('services.googleapis.cn', QTYPE.A), opts())
  assert.equal(a.rcode, RCODE.NOERROR)
  assert.deepEqual(a.answers, [
    { name: 'services.googleapis.cn', type: QTYPE.CNAME, ttl: 30, data: 'services.googleapis.com' },
    { name: 'services.googleapis.com', type: QTYPE.A, ttl: 30, data: '172.217.114.4' },
    { name: 'services.googleapis.com', type: QTYPE.A, ttl: 30, data: '172.217.114.5' },
  ])
  const aaaa = await answerQuery(q('services.googleapis.cn', QTYPE.AAAA), opts())
  assert.deepEqual(aaaa.answers.map((x) => [x.type, x.data]), [[QTYPE.CNAME, 'services.googleapis.com'], [QTYPE.AAAA, '2404:6800:4004:80b::200a']])
  // 档案没开 IPv6:AAAA 只回 CNAME、不问内核
  const noV6 = await answerQuery(q('services.googleapis.cn', QTYPE.AAAA), opts({ ipv6: false }))
  assert.deepEqual(noV6.answers.map((x) => x.type), [QTYPE.CNAME])
  // 只问 CNAME:只回链
  const c = await answerQuery(q('services.googleapis.cn', QTYPE.CNAME), opts())
  assert.deepEqual(c.answers.map((x) => x.type), [QTYPE.CNAME])
})

test('固定地址:泛域名的答案所有者是实际被查的名字;A 只回 IPv4、AAAA 只回 IPv6;IPv6 关着时 AAAA 回空', async () => {
  const a = await answerQuery(q('a.b.ok1248.cn', QTYPE.A), opts())
  assert.deepEqual(a.answers, [{ name: 'a.b.ok1248.cn', type: QTYPE.A, ttl: 60, data: '192.168.3.1' }])
  const aaaa = await answerQuery(q('a.ok1248.cn', QTYPE.AAAA), opts())
  assert.deepEqual(aaaa.answers, [{ name: 'a.ok1248.cn', type: QTYPE.AAAA, ttl: 60, data: '2001:db8::1' }])
  const off = await answerQuery(q('a.ok1248.cn', QTYPE.AAAA), opts({ ipv6: false }))
  assert.equal(off.rcode, RCODE.NOERROR)
  assert.deepEqual(off.answers, [])
  // 精确规则只有 IPv4:AAAA 回空,不回退到泛域名的 IPv6,也不去问上游
  const e6 = await answerQuery(q('article.ok1248.cn', QTYPE.AAAA), opts({ resolveKernel: async () => { throw new Error('不该问内核') } }))
  assert.equal(e6.rcode, RCODE.NOERROR)
  assert.deepEqual(e6.answers, [])
  assert.equal(e6.matched.id, 'e')
  const e4 = await answerQuery(q('article.ok1248.cn', QTYPE.A), opts())
  assert.deepEqual(e4.answers.map((x) => x.data), ['121.43.244.161'])
})

test('泛域名 → 固定目标域名:所有子域都指向同一个目标并动态解析;根域 / 相似域名不命中', async () => {
  const a = await answerQuery(q('x.y.example.com', QTYPE.A), opts())
  assert.deepEqual(a.answers, [
    // CNAME 的 TTL 取 min(固定 60, 目标记录最短 TTL)
    { name: 'x.y.example.com', type: QTYPE.CNAME, ttl: 60, data: 'target.example.net' },
    { name: 'target.example.net', type: QTYPE.A, ttl: 300, data: '203.0.113.9' },
  ])
  const root = await answerQuery(q('example.com', QTYPE.A), opts({ resolveFallback: async () => ({ rcode: RCODE.NOERROR, records: [{ address: '9.9.9.9', ttl: 10 }] }) }))
  assert.equal(root.matched, null)
  assert.deepEqual(root.answers.map((x) => x.data), ['9.9.9.9'], '没命中的按直连上游解析,不回内核')
})

test('链:目标又命中固定地址规则 → 两跳 CNAME 后给地址;成环 → SERVFAIL;NXDOMAIN / 超时原样反映', async () => {
  const chain = await answerQuery(q('alias.review.test', QTYPE.A), opts())
  assert.deepEqual(chain.answers.map((x) => [x.name, x.type, x.data]), [
    ['alias.review.test', QTYPE.CNAME, 'article.ok1248.cn'],
    ['article.ok1248.cn', QTYPE.A, '121.43.244.161'],
  ])
  const loop = await answerQuery(q('l1.test', QTYPE.A), opts())
  assert.equal(loop.rcode, RCODE.SERVFAIL)
  assert.equal(loop.error, 'loop')
  const nx = await answerQuery(q('nx.example.com', QTYPE.A), opts({ rules: rulesOf([{ source: 'nx.example.com', domain: 'nx.example.net' }]) }))
  assert.equal(nx.rcode, RCODE.NXDOMAIN)
  assert.deepEqual(nx.answers.map((x) => x.type), [QTYPE.CNAME])
  const slow = await answerQuery(q('slow.example.com', QTYPE.A), opts({ rules: rulesOf([{ source: 'slow.example.com', domain: 'slow.example.net' }]) }))
  assert.equal(slow.rcode, RCODE.SERVFAIL)
})

test('报文编解码:问题段解析、OPT 的 UDP 上限、IPv6 压缩写法、超过上限截断置 TC', () => {
  const question = Buffer.concat([Buffer.from([1, 97, 2, 99, 110, 0]), Buffer.from([0, 1, 0, 1])]) // a.cn A IN
  const header = Buffer.from([0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 1])
  const opt = Buffer.concat([Buffer.from([0]), Buffer.from([0, 41, 0x10, 0, 0, 0, 0, 0, 0, 0])]) // OPT, udp 4096
  const query = parseQuery(Buffer.concat([header, question, opt]))
  assert.equal(query.id, 0x1234)
  assert.equal(query.qname, 'a.cn')
  assert.equal(query.qtype, 1)
  assert.equal(query.udpSize, 4096)
  assert.equal(ipv6ToBytes('2001:db8::1').toString('hex'), '20010db8000000000000000000000001')
  assert.equal(ipv6ToBytes('::ffff:1.2.3.4').toString('hex'), '00000000000000000000ffff01020304')
  const small = { ...query, udpSize: 512 }
  const many = Array.from({ length: 40 }, (_, i) => ({ name: 'a.cn', type: 1, ttl: 60, data: `10.0.0.${i + 1}` }))
  const buf = buildResponse(small, { answers: many })
  assert.ok(buf.length <= 512)
  assert.ok(buf.readUInt16BE(2) & 0x0200, 'TC 置位')
  assert.ok(buf.readUInt16BE(6) < 40)
})

// 真起一个 UDP 服务,用 node:dns 的 Resolver 当客户端端到端查一遍(和 sing-box 发过来的形态一样)
test('UDP 服务端到端:A / AAAA / CNAME 查询都能回到可用的记录;规则从档案实时读', async () => {
  let profile = { ipv6: true, dns: { rewrite: { initialized: 1, rules: [
    { id: 'g', source: 'services.googleapis.cn', domain: 'services.googleapis.com' },
    { id: 'w', source: '*.ok1248.cn', addresses: ['192.168.3.1', '2001:db8::1'] },
  ] } } }
  let clock = 0
  const store = { getProfile: () => profile }
  const server = createDnsRewriteServer({ store, port: 0, resolveKernel: kernel, now: () => clock, log: () => {} })
  await server.start()
  const port = server.address().port
  const resolver = new Resolver({ timeout: 2000, tries: 1 })
  resolver.setServers([`127.0.0.1:${port}`])
  try {
    const a = await resolver.resolve4('services.googleapis.cn', { ttl: true })
    assert.deepEqual(a.map((x) => x.address), ['172.217.114.4', '172.217.114.5'])
    assert.equal(a[0].ttl, 30)
    assert.deepEqual(await resolver.resolveCname('services.googleapis.cn'), ['services.googleapis.com'])
    assert.deepEqual(await resolver.resolve6('services.googleapis.cn'), ['2404:6800:4004:80b::200a'])
    assert.deepEqual(await resolver.resolve4('deep.a.ok1248.cn'), ['192.168.3.1'])
    assert.deepEqual(await resolver.resolve6('deep.a.ok1248.cn'), ['2001:db8::1'])
    // 规则改了(停用泛域名),两秒缓存过后生效:没命中就按直连上游,这里没有上游 → SERVFAIL
    profile = { ...profile, dns: { rewrite: { initialized: 1, rules: [profile.dns.rewrite.rules[0]] } } }
    clock += 5000
    await assert.rejects(resolver.resolve4('deep.a.ok1248.cn'), (err) => err.code === 'ESERVFAIL')
  } finally {
    server.stop()
  }
})

// 复核 F1:固定地址多、域名长的应答超过 UDP 上限时 UDP 只能截断(TC),同一端口的 TCP 要给完整报文;
// node 的 Resolver(c-ares)见 TC 会自己换 TCP 重试,和内核的行为一样
const LONG_NAME = ['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60), 'd'.repeat(51), 'review', 'test'].join('.')
const SIXTEEN_V6 = Array.from({ length: 16 }, (_, i) => `2001:db8::${(i + 1).toString(16)}`)
const rawQuery = (name, type, udpSize = 4096) => {
  const h = Buffer.alloc(12); h.writeUInt16BE(23456, 0); h.writeUInt16BE(0x100, 2); h.writeUInt16BE(1, 4); h.writeUInt16BE(1, 10)
  const tail = Buffer.alloc(4); tail.writeUInt16BE(type, 0); tail.writeUInt16BE(1, 2)
  const opt = Buffer.alloc(11); opt.writeUInt16BE(41, 1); opt.writeUInt16BE(udpSize, 3)
  const parts = String(name).split('.').flatMap((l) => [Buffer.from([l.length]), Buffer.from(l, 'latin1')])
  return Buffer.concat([h, ...parts, Buffer.from([0]), tail, opt])
}
test('大应答:UDP 按声明的上限截断并置 TC;同端口 TCP 给全部 16 条;Resolver 经 TC 重试后拿全', async () => {
  const profile = { ipv6: true, dns: { rewrite: { initialized: 1, rules: [{ id: 'large', source: LONG_NAME, addresses: SIXTEEN_V6 }] } } }
  const server = createDnsRewriteServer({ store: { getProfile: () => profile }, port: 0, resolveKernel: kernel, log: () => {} })
  await server.start()
  const port = server.address().port
  try {
    const { default: dgram } = await import('node:dgram')
    const udp = await new Promise((resolve, reject) => {
      const s = dgram.createSocket('udp4')
      const t = setTimeout(() => { s.close(); reject(new Error('udp timeout')) }, 2000)
      s.once('message', (b) => { clearTimeout(t); s.close(); resolve(b) })
      s.send(rawQuery(LONG_NAME, QTYPE.AAAA, 4096), port, '127.0.0.1')
    })
    assert.ok(udp.readUInt16BE(2) & 0x0200, 'UDP 应答应置 TC')
    assert.ok(udp.readUInt16BE(6) < 16 && udp.length <= 4096)
    const { default: net } = await import('node:net')
    const tcp = await new Promise((resolve, reject) => {
      const c = net.connect(port, '127.0.0.1')
      let buf = Buffer.alloc(0)
      const t = setTimeout(() => { c.destroy(); reject(new Error('tcp timeout')) }, 2000)
      c.on('data', (d) => {
        buf = Buffer.concat([buf, d])
        if (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) { clearTimeout(t); c.destroy(); resolve(buf.subarray(2, 2 + buf.readUInt16BE(0))) }
      })
      c.on('error', (e) => { clearTimeout(t); reject(e) })
      const q = rawQuery(LONG_NAME, QTYPE.AAAA, 4096)
      const head = Buffer.alloc(2); head.writeUInt16BE(q.length, 0)
      c.write(Buffer.concat([head, q]))
    })
    assert.equal(tcp.readUInt16BE(2) & 0x0200, 0, 'TCP 不截断')
    assert.equal(tcp.readUInt16BE(6), 16)
    const resolver = new Resolver({ timeout: 2000, tries: 1 })
    resolver.setServers([`127.0.0.1:${port}`])
    const all = await resolver.resolve6(LONG_NAME)
    assert.equal(all.length, 16)
    assert.deepEqual([...all].sort(), [...SIXTEEN_V6].sort())
  } finally {
    server.stop()
  }
})

// 复核 F2:「代理 v6 降为 IPv4」时,按现有分流走代理的源域名不给 AAAA(固定地址和域名型都一样),直连的照给
test('代理 v6 降为 IPv4:走代理的源域名 AAAA 回空、直连的照给;代理允许 IPv6 或全局关 IPv6 时按原样', async () => {
  const rules = rulesOf([
    { id: 'p', source: 'proxy-v6.review.test', addresses: ['203.0.113.8', '2001:db8::8'] },
    { id: 'd', source: 'direct-v6.review.test', addresses: ['203.0.113.9', '2001:db8::9'] },
    { id: 'pd', source: 'proxy-alias.review.test', domain: 'services.googleapis.com' },
  ])
  const viaProxy = async (name) => name.startsWith('proxy-')
  const base = { rules, ipv6: true, resolveKernel: kernel, resolveFallback: async () => ({ rcode: RCODE.SERVFAIL, records: [] }) }
  const p = await answerQuery(q('proxy-v6.review.test', QTYPE.AAAA), { ...base, suppressAAAA: viaProxy })
  assert.deepEqual(p.answers, [])
  assert.equal(p.suppressedAAAA, true)
  const d = await answerQuery(q('direct-v6.review.test', QTYPE.AAAA), { ...base, suppressAAAA: viaProxy })
  assert.deepEqual(d.answers.map((x) => x.data), ['2001:db8::9'])
  const pd = await answerQuery(q('proxy-alias.review.test', QTYPE.AAAA), { ...base, suppressAAAA: viaProxy })
  assert.deepEqual(pd.answers.map((x) => x.type), [QTYPE.CNAME], '域名型:只给 CNAME,不去问目标的 AAAA')
  // A 不受影响
  const pa = await answerQuery(q('proxy-v6.review.test', QTYPE.A), { ...base, suppressAAAA: viaProxy })
  assert.deepEqual(pa.answers.map((x) => x.data), ['203.0.113.8'])
  // 代理允许 IPv6(不传 suppressAAAA):照给
  const allow = await answerQuery(q('proxy-v6.review.test', QTYPE.AAAA), base)
  assert.deepEqual(allow.answers.map((x) => x.data), ['2001:db8::8'])
  // 全局 IPv6 关:一律空
  const off = await answerQuery(q('direct-v6.review.test', QTYPE.AAAA), { ...base, ipv6: false, suppressAAAA: viaProxy })
  assert.deepEqual(off.answers, [])
  // 整个服务:档案 ipv6Proxy=ipv4 + sourceViaProxy 注入,按域名缓存判定
  let asked = 0
  const profile = { ipv6: true, ipv6Proxy: 'ipv4', dns: { rewrite: { initialized: 1, rules } } }
  const server = createDnsRewriteServer({ store: { getProfile: () => profile }, port: 0, resolveKernel: kernel, sourceViaProxy: async (n) => { asked += 1; return n.startsWith('proxy-') }, log: () => {} })
  await server.start()
  try {
    const resolver = new Resolver({ timeout: 2000, tries: 1 })
    resolver.setServers([`127.0.0.1:${server.address().port}`])
    await assert.rejects(resolver.resolve6('proxy-v6.review.test'), (e) => e.code === 'ENODATA')
    assert.deepEqual(await resolver.resolve6('direct-v6.review.test'), ['2001:db8::9'])
    await assert.rejects(resolver.resolve6('proxy-v6.review.test'), (e) => e.code === 'ENODATA')
    assert.equal(asked, 2, '同一域名的归类只判一次(缓存)')
  } finally {
    server.stop()
  }
})
