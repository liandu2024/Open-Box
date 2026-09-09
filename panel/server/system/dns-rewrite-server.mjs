// DNS 重写的答案由这里生成:面板进程在 127.0.0.1:7854 上开的一个小 UDP DNS 服务(engine/dns-rewrite.mjs 是规则
// 和匹配,这里是报文和解析)。内核的 dns.rules 只把命中重写源域名的查询交过来(见 engine/dns.mjs),别的查询
// 根本到不了这里。
//
// 一次查询:
//   1. 按档案里此刻启用的规则二次匹配(精确优先、泛域名取后缀最长的);
//   2. 固定地址规则:A 回 IPv4、AAAA 回 IPv6(档案没开 IPv6 就回空),记录的所有者是实际被查的名字,不是
//      "*.example.com" 这个字面量;
//   3. 域名型规则:合成 CNAME 链(源 → 目标,目标又命中别的规则就继续接,最多 8 跳、成环即 SERVFAIL),
//      最后那个目标回头问内核 :7853(目标域名走现有的分流 DNS 策略,每次都问、按上游 TTL 走,不在启动时
//      查一次写死);NXDOMAIN / 空答案 / 超时原样反映到 rcode;
//   4. 没命中任何规则(用户刚停用 / 删了规则、内核还没重启):不能再交回内核(内核会再送回来成环),按
//      直连侧上游解析一次,和原来直连解析的行为一致。
// 只处理 A / AAAA / CNAME;其它类型对域名型规则只回 CNAME 链,对固定地址规则回空。
//
// 同一个回环端口同时听 UDP 和 TCP:固定地址多、域名长的应答超过 UDP 上限时只能截断(TC),内核会按
// RFC 7766 换 TCP 重试,TCP 上按两字节长度前缀给完整报文,不裁剪。
//
// 「代理 v6 降为 IPv4」:重写规则排在内核 DNS 规则最前面,后面按站点集判出来的 strategy: ipv4_only 轮不到;
// 所以这里按源域名在现有分流里的归类(sourceViaProxy,由调用方用内核配置判)自己压掉走代理域名的 AAAA,
// 直连域名的 IPv6 照常给。
import dgram from 'node:dgram'
import { Resolver } from 'node:dns/promises'
import net from 'node:net'
import { DNS_REWRITE_FIXED_TTL, DNS_REWRITE_PORT, matchRewrite, normalizeDnsRewrite, normalizeDomain } from '../engine/dns-rewrite.mjs'
import { DNS_INBOUND_PORT } from '../engine/config.mjs'
import { ipv6ProxyMode } from '../engine/dns.mjs'

export const QTYPE = Object.freeze({ A: 1, CNAME: 5, AAAA: 28, OPT: 41 })
export const RCODE = Object.freeze({ NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 })
const MAX_CHAIN = 8

// ---------- 报文编解码(只处理查询里出现的形态:一个问题、无压缩;应答自己生成,不压缩) ----------
const readName = (buf, offset) => {
  const labels = []
  let pos = offset
  let jumped = false
  let end = offset
  let guard = 0
  for (;;) {
    if (pos >= buf.length) throw new Error('name out of range')
    const len = buf[pos]
    if (len === 0) { pos += 1; break }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) throw new Error('bad pointer')
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1]
      if (!jumped) end = pos + 2
      jumped = true
      pos = ptr
      if (++guard > 64) throw new Error('pointer loop')
      continue
    }
    if (pos + 1 + len > buf.length) throw new Error('label out of range')
    labels.push(buf.subarray(pos + 1, pos + 1 + len).toString('latin1'))
    pos += 1 + len
  }
  if (!jumped) end = pos
  return { name: labels.join('.'), end }
}

export const encodeName = (name) => {
  const parts = []
  for (const label of String(name || '').split('.').filter(Boolean)) {
    const raw = Buffer.from(label, 'latin1')
    if (raw.length > 63) throw new Error(`label too long: ${label}`)
    parts.push(Buffer.from([raw.length]), raw)
  }
  parts.push(Buffer.from([0]))
  return Buffer.concat(parts)
}

export const parseQuery = (buf) => {
  if (buf.length < 12) throw new Error('short packet')
  const id = buf.readUInt16BE(0)
  const flags = buf.readUInt16BE(2)
  const qdcount = buf.readUInt16BE(4)
  const arcount = buf.readUInt16BE(10)
  if (qdcount < 1) throw new Error('no question')
  const { name, end } = readName(buf, 12)
  if (end + 4 > buf.length) throw new Error('short question')
  const qtype = buf.readUInt16BE(end)
  const qclass = buf.readUInt16BE(end + 2)
  // 附加段里的 OPT:拿它声明的 UDP 载荷上限,应答超过就截断
  let udpSize = 512
  if (arcount) {
    let pos = end + 4
    try {
      for (let i = 0; i < arcount && pos < buf.length; i++) {
        const rr = readName(buf, pos)
        pos = rr.end
        if (pos + 10 > buf.length) break
        const type = buf.readUInt16BE(pos)
        const klass = buf.readUInt16BE(pos + 2)
        const rdlen = buf.readUInt16BE(pos + 8)
        if (type === QTYPE.OPT && klass >= 512) udpSize = Math.min(klass, 4096)
        pos += 10 + rdlen
      }
    } catch { /* 附加段解析失败就按 512 */ }
  }
  return { id, rd: Boolean(flags & 0x0100), qname: name, qtype, qclass, udpSize, questionRaw: buf.subarray(12, end + 4) }
}

export const ipv4ToBytes = (text) => Buffer.from(text.split('.').map((x) => Number(x)))
export const ipv6ToBytes = (text) => {
  let t = String(text).toLowerCase()
  // 末尾嵌入的 IPv4(::ffff:1.2.3.4)
  const v4 = t.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const b = ipv4ToBytes(v4[1])
    t = t.slice(0, -v4[1].length) + `${b.readUInt16BE(0).toString(16)}:${b.readUInt16BE(2).toString(16)}`
  }
  const [head, tail = ''] = t.split('::')
  const hs = head ? head.split(':') : []
  const ts = tail ? tail.split(':') : []
  const missing = 8 - hs.length - ts.length
  if (missing < 0 || (missing > 0 && !t.includes('::'))) throw new Error(`bad ipv6: ${text}`)
  const groups = [...hs, ...Array(t.includes('::') ? missing : 0).fill('0'), ...ts]
  const out = Buffer.alloc(16)
  groups.forEach((g, i) => out.writeUInt16BE(parseInt(g || '0', 16), i * 2))
  return out
}

const encodeRecord = (rr) => {
  let rdata
  if (rr.type === QTYPE.A) rdata = ipv4ToBytes(rr.data)
  else if (rr.type === QTYPE.AAAA) rdata = ipv6ToBytes(rr.data)
  else if (rr.type === QTYPE.CNAME) rdata = encodeName(rr.data)
  else throw new Error(`unsupported rr type ${rr.type}`)
  const head = Buffer.alloc(10)
  head.writeUInt16BE(rr.type, 0)
  head.writeUInt16BE(1, 2)
  head.writeUInt32BE(Math.max(0, Math.min(0x7fffffff, Math.floor(rr.ttl))), 4)
  head.writeUInt16BE(rdata.length, 8)
  return Buffer.concat([encodeName(rr.name), head, rdata])
}

// 应答:沿用请求的 id / 问题段,AA 置位(答案由我们决定),RA 置位;超过 UDP 上限就丢掉尾部记录并置 TC
export const buildResponse = (query, { rcode = RCODE.NOERROR, answers = [] } = {}) => {
  const encodedAnswers = answers.map(encodeRecord)
  const limit = query.udpSize || 512
  let kept = encodedAnswers.length
  let truncated = false
  const size = (n) => 12 + query.questionRaw.length + encodedAnswers.slice(0, n).reduce((s, b) => s + b.length, 0)
  while (kept > 0 && size(kept) > limit) { kept -= 1; truncated = true }
  const header = Buffer.alloc(12)
  header.writeUInt16BE(query.id, 0)
  let flags = 0x8000 | 0x0400 | 0x0080 // QR | AA | RA
  if (query.rd) flags |= 0x0100
  if (truncated) flags |= 0x0200
  flags |= rcode & 0x0f
  header.writeUInt16BE(flags, 2)
  header.writeUInt16BE(1, 4)
  header.writeUInt16BE(kept, 6)
  header.writeUInt16BE(0, 8)
  header.writeUInt16BE(0, 10)
  return Buffer.concat([header, query.questionRaw, ...encodedAnswers.slice(0, kept)])
}

// ---------- 解析目标域名:回头问内核 :7853(目标走现有的分流 DNS 策略) ----------
const rcodeOfError = (err) => {
  const code = err && err.code
  if (code === 'ENOTFOUND') return RCODE.NXDOMAIN
  if (code === 'ENODATA') return RCODE.NOERROR
  if (code === 'EREFUSED') return RCODE.REFUSED
  return RCODE.SERVFAIL
}
export const makeResolver = (servers, { timeoutMs = 4000 } = {}) => {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 })
  resolver.setServers(servers)
  return async (name, qtype) => {
    try {
      const list = qtype === QTYPE.AAAA ? await resolver.resolve6(name, { ttl: true }) : await resolver.resolve4(name, { ttl: true })
      return { rcode: RCODE.NOERROR, records: list.map((x) => ({ address: x.address, ttl: Number.isFinite(x.ttl) ? x.ttl : DNS_REWRITE_FIXED_TTL })) }
    } catch (err) {
      return { rcode: rcodeOfError(err), records: [], error: err && err.code ? err.code : String(err) }
    }
  }
}

// ---------- 答案 ----------
// 纯函数,便于测试:query + 规则 + 档案 + 解析函数 → { rcode, answers, matched }
// suppressAAAA:async (源域名) → 是否要压掉这个源的 AAAA(代理 v6 降为 IPv4 且源域名按现有分流走代理)
export const answerQuery = async (query, { rules, ipv6 = true, resolveKernel, resolveFallback, suppressAAAA = null, log = () => {} }) => {
  const qname = normalizeDomain(query.qname)
  if (query.qclass !== 1 || !qname) return { rcode: RCODE.NOTIMP, answers: [], matched: null }
  const want4 = query.qtype === QTYPE.A
  const want6 = query.qtype === QTYPE.AAAA
  const wantCname = query.qtype === QTYPE.CNAME
  const rule = matchRewrite(rules, qname)
  if (!rule) {
    // 内核只送命中过的域名过来;到这里说明规则刚被改掉、内核还没重启。按直连侧上游解析一次,
    // 不能再交回内核——它会按旧规则再送回来
    if (!(want4 || want6) || !resolveFallback) return { rcode: RCODE.NOERROR, answers: [], matched: null }
    const r = await resolveFallback(qname, query.qtype)
    log(`[dns-rewrite] ${qname} 没有命中任何规则(规则改了内核还没重启?),按直连上游解析:rcode ${r.rcode}`)
    return { rcode: r.rcode, answers: r.records.map((x) => ({ name: qname, type: query.qtype, ttl: x.ttl, data: x.address })), matched: null }
  }
  const answers = []
  const chain = [qname]
  let owner = qname
  let current = rule
  // 域名型:接 CNAME 链,直到落到固定地址规则或不在规则里的外部域名
  while (current && current.domain) {
    const target = current.domain
    if (chain.includes(target)) {
      log(`[dns-rewrite] ${qname} 的重写成环:${[...chain, target].join(' → ')}`)
      return { rcode: RCODE.SERVFAIL, answers: [], matched: rule, error: 'loop' }
    }
    if (chain.length > MAX_CHAIN) {
      log(`[dns-rewrite] ${qname} 的重写链超过 ${MAX_CHAIN} 跳`)
      return { rcode: RCODE.SERVFAIL, answers: [], matched: rule, error: 'too-long' }
    }
    answers.push({ name: owner, type: QTYPE.CNAME, ttl: DNS_REWRITE_FIXED_TTL, data: target })
    chain.push(target)
    owner = target
    current = matchRewrite(rules, target)
  }
  if (wantCname) return { rcode: RCODE.NOERROR, answers, matched: rule, chain }
  // AAAA 给不给:档案关着 IPv6 不给;「代理 v6 降为 IPv4」且这个源域名按现有分流走代理也不给(和没重写时
  // 内核对它的处理一致);直连域名的 IPv6 照常
  let give6 = ipv6
  if (want6 && give6 && suppressAAAA) {
    try { if (await suppressAAAA(qname)) give6 = false } catch { /* 判不出来就按档案的 IPv6 开关 */ }
  }
  if (current) {
    // 落在固定地址规则上:按查询类型给地址,所有者是链尾的名字(直接命中就是被查的名字本身)
    if (want4) for (const a of current.addresses) if (net.isIP(a) === 4) answers.push({ name: owner, type: QTYPE.A, ttl: DNS_REWRITE_FIXED_TTL, data: a })
    if (want6 && give6) for (const a of current.addresses) if (net.isIP(a) === 6) answers.push({ name: owner, type: QTYPE.AAAA, ttl: DNS_REWRITE_FIXED_TTL, data: a })
    return { rcode: RCODE.NOERROR, answers, matched: rule, chain, suppressedAAAA: want6 && ipv6 && !give6 }
  }
  // 链尾是外部域名:A / AAAA 回头问内核;别的类型只给 CNAME 链
  if (!(want4 || want6)) return { rcode: RCODE.NOERROR, answers, matched: rule, chain }
  if (want6 && !give6) return { rcode: RCODE.NOERROR, answers, matched: rule, chain, suppressedAAAA: ipv6 }
  const r = await resolveKernel(owner, query.qtype)
  if (r.rcode !== RCODE.NOERROR && r.rcode !== RCODE.NXDOMAIN) {
    log(`[dns-rewrite] ${qname} → ${owner} 解析失败:${r.error || r.rcode}`)
  }
  for (const x of r.records) answers.push({ name: owner, type: query.qtype, ttl: x.ttl, data: x.address })
  // CNAME 的 TTL 跟着目标记录里最短的那条走,目标的地址变了链也一起过期
  const minTtl = r.records.reduce((m, x) => Math.min(m, x.ttl), Infinity)
  if (Number.isFinite(minTtl)) for (const a of answers) if (a.type === QTYPE.CNAME) a.ttl = Math.max(1, Math.min(a.ttl, minTtl))
  return { rcode: r.rcode, answers, matched: rule, chain, resolved: r }
}

// ---------- UDP 服务 ----------
// sourceViaProxy:async (域名) → true / false / null(判不出)。「代理 v6 降为 IPv4」时按它决定压不压 AAAA;
// 判定按内核已部署的 DNS 规则走(api/route-test.mjs 的 decideDnsServer,跳过重写规则本身),结果按域名缓存
export const createDnsRewriteServer = ({
  store, host = '127.0.0.1', port = DNS_REWRITE_PORT, kernelDns = `127.0.0.1:${DNS_INBOUND_PORT}`,
  resolveKernel, fallbackServers = async () => [], sourceViaProxy = null, policyCacheMs = 300_000,
  log = () => {}, now = () => Date.now(),
} = {}) => {
  const kernelResolve = resolveKernel || makeResolver([kernelDns])
  let fallbackResolve = null
  let fallbackKey = ''
  const resolveFallback = async (name, qtype) => {
    let servers = []
    try { servers = (await fallbackServers()) || [] } catch { servers = [] }
    const profile = store.getProfile ? store.getProfile() : {}
    const direct = profile && profile.dns && typeof profile.dns.direct === 'string' ? profile.dns.direct : ''
    const list = [...servers, direct].filter((s) => typeof s === 'string' && net.isIP(s) !== 0)
    if (!list.length) return { rcode: RCODE.SERVFAIL, records: [], error: 'no-upstream' }
    const key = list.join(',')
    if (!fallbackResolve || fallbackKey !== key) { fallbackResolve = makeResolver(list); fallbackKey = key }
    return fallbackResolve(name, qtype)
  }
  // 规则从档案读,2 秒缓存:每条查询都解析整份档案没必要(服务端这一层两秒内看到新规则;内核 / 终端里已有
  // 的答案仍按 TTL 过期)
  let cache = null
  const liveConfig = () => {
    const t = now()
    if (cache && t - cache.at < 2000) return cache
    const profile = store.getProfile ? store.getProfile() : {}
    cache = { at: t, rules: normalizeDnsRewrite(profile.dns).rules, ipv6: Boolean(profile.ipv6), proxyV4Only: ipv6ProxyMode(profile) === 'ipv4' }
    return cache
  }
  // 源域名走不走代理:按域名缓存,规则集匹配要 exec 内核,不能每条查询都算
  const policyCache = new Map()
  const suppressAAAAFor = async (qname) => {
    if (!sourceViaProxy) return false
    const t = now()
    const hit = policyCache.get(qname)
    if (hit && t - hit.at < policyCacheMs) return hit.value
    const via = await sourceViaProxy(qname)
    const value = via === true
    if (via !== null && via !== undefined) {
      if (policyCache.size > 500) policyCache.clear()
      policyCache.set(qname, { at: t, value })
    }
    return value
  }

  let socket = null
  let tcpServer = null
  const answerFor = async (query) => {
    const { rules, ipv6, proxyV4Only } = liveConfig()
    return answerQuery(query, { rules, ipv6, resolveKernel: kernelResolve, resolveFallback, suppressAAAA: proxyV4Only ? suppressAAAAFor : null, log })
  }
  // tcp:整段报文不按 UDP 上限裁剪
  const handle = async (msg, { tcp = false } = {}) => {
    let query
    try { query = parseQuery(msg) } catch { return null }
    if (tcp) query = { ...query, udpSize: 65535 }
    try {
      const r = await answerFor(query)
      return buildResponse(query, { rcode: r.rcode, answers: r.answers })
    } catch (err) {
      log(`[dns-rewrite] 处理 ${query.qname} 出错:${err instanceof Error ? err.message : err}`)
      return buildResponse(query, { rcode: RCODE.SERVFAIL })
    }
  }

  const startUdp = (bindPort) => new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4')
    s.on('message', (msg, rinfo) => {
      handle(msg).then((buf) => { if (buf) s.send(buf, rinfo.port, rinfo.address, () => {}) }).catch(() => {})
    })
    s.once('error', (err) => reject(err))
    s.bind(bindPort, host, () => { socket = s; resolve(s.address().port) })
  })
  // TCP:两字节长度前缀,一个连接上可以连着来几条查询;10 秒没动静就关
  const startTcp = (bindPort) => new Promise((resolve, reject) => {
    const srv = net.createServer((conn) => {
      let pending = Buffer.alloc(0)
      conn.setTimeout(10_000, () => conn.destroy())
      conn.on('error', () => {})
      conn.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk])
        while (pending.length >= 2) {
          const len = pending.readUInt16BE(0)
          if (pending.length < 2 + len) break
          const msg = pending.subarray(2, 2 + len)
          pending = pending.subarray(2 + len)
          handle(msg, { tcp: true }).then((buf) => {
            if (!buf || conn.destroyed) return
            const head = Buffer.alloc(2)
            head.writeUInt16BE(buf.length, 0)
            conn.write(Buffer.concat([head, buf]))
          }).catch(() => {})
        }
      })
    })
    srv.once('error', (err) => reject(err))
    srv.listen(bindPort, host, () => { tcpServer = srv; resolve(srv.address().port) })
  })
  const start = async () => {
    if (socket) return
    try {
      // port 为 0 时先让 UDP 挑一个端口,TCP 再绑同一个(端口只是给测试用;正式用固定的 7854)
      const udpPort = await startUdp(port)
      await startTcp(udpPort)
      log(`[dns-rewrite] 监听 ${host}:${udpPort}(UDP + TCP)`)
    } catch (err) {
      log(`[dns-rewrite] 监听 ${host}:${port} 失败:${err.message}`)
      stop()
      throw err
    }
  }
  const stop = () => {
    if (socket) { try { socket.close() } catch { /* 已关 */ } socket = null }
    if (tcpServer) { try { tcpServer.close() } catch { /* 已关 */ } tcpServer = null }
  }
  const address = () => (socket ? socket.address() : null)
  return { start, stop, address, handle, answerQuery: (q, opts) => answerFor({ ...q, ...(opts || {}) }) }
}
