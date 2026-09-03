import express from 'express'
import net from 'node:net'
import tls from 'node:tls'
import { PANEL_INBOUND_PORT } from '../engine/config.mjs'
import { CLASH_API_BASE, matchLocalConditions, matchRuleSetList } from './penetration.mjs'
import { fetchSelections } from './deploy-runner.mjs'
import { builtinTags } from '../engine/user-groups.mjs'
import { normalizeRouting } from '../engine/routing-model.mjs'

// 「真实路由」:不只按规则推,而是真的走一遍——
//   1. DNS 用哪台服务器:按生成配置里 dns.rules 的顺序判(规则集用内核 rule-set match,
//      域名条件本地比),得到 dns-direct(直连解析)还是某个带 detour 的代理 DNS;
//   2. 解析结果:问内核自己的 DNS(clash_api /dns/query),拿到的就是内核会用的答案;
//   3. 实际出口:面板进程在路由器上真发一个 HTTPS 请求(会经过 tun 进内核),然后到
//      clash_api /connections 里找这条连接,读它实际走的链路和命中的规则;顺带记耗时。
const TARGET_PATTERN = /^[A-Za-z0-9._:-]+$/
const isValidTarget = (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('-') && TARGET_PATTERN.test(v)
const isIp = (v) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v) || v.includes(':')
const errorMessage = (err) => (err instanceof Error ? err.message : String(err))

const fetchWithTimeout = async (fetchImpl, url, init = {}, timeoutMs = 8000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// dns.rules 里每条的条件和 route.rules 同一套写法(rule_set / domain / domain_suffix / domain_keyword)
export const decideDnsServer = async (ctx, paths, config, target) => {
  const dns = config.dns || {}
  const servers = new Map((dns.servers || []).map((s) => [s.tag, s]))
  const srsPathByTag = new Map(((config.route || {}).rule_set || []).map((r) => [r.tag, r.path]))
  const rules = dns.rules || []
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (!rule || typeof rule !== 'object') continue
    let hit = false
    if (matchLocalConditions(rule, target)) hit = true
    else if (Object.prototype.hasOwnProperty.call(rule, 'rule_set')) {
      const r = await matchRuleSetList(ctx, paths, srsPathByTag, rule.rule_set, target)
      if (r.error) return { error: `dns rule #${i + 1}: ${r.error}` }
      hit = r.hit
    }
    if (!hit) continue
    if (rule.action === 'reject') return { ruleIndex: i, rejected: true }
    const server = servers.get(rule.server) || { tag: rule.server }
    return { ruleIndex: i, server, viaProxy: Boolean(server.detour) }
  }
  const server = servers.get(dns.final) || { tag: dns.final || '' }
  return { ruleIndex: null, server, viaProxy: Boolean(server.detour) }
}

const clashHeaders = (secret) => (secret ? { Authorization: `Bearer ${secret}` } : {})

// 经内核的回环 mixed 入站发一次真实请求:CONNECT host:port → (443 时再套 TLS)→ HEAD /。
// 走这条路请求才会像客户端流量一样过内核的分流规则,连接表里也就能找到它。
// 只读响应首行,拿到状态码就断开。
export const probeViaKernel = (host, { port = 443, secure = port !== 80, proxyPort = PANEL_INBOUND_PORT, timeoutMs = 10000 } = {}) =>
  new Promise((resolve) => {
    const t0 = Date.now()
    let done = false
    const finish = (r) => { if (!done) { done = true; resolve({ ...r, ms: Date.now() - t0 }) } }
    const socket = net.connect({ host: '127.0.0.1', port: proxyPort })
    const timer = setTimeout(() => { finish({ ok: false, error: 'timeout' }); socket.destroy() }, timeoutMs)
    socket.once('error', (err) => { clearTimeout(timer); finish({ ok: false, error: `inbound: ${err.message}` }) })
    socket.once('connect', () => {
      socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`)
    })
    let buf = ''
    const onConnectData = (chunk) => {
      buf += chunk.toString('latin1')
      const end = buf.indexOf('\r\n\r\n')
      if (end === -1) return
      socket.removeListener('data', onConnectData)
      const line = buf.slice(0, buf.indexOf('\r\n'))
      if (!/^HTTP\/1\.[01] 200/.test(line)) { clearTimeout(timer); finish({ ok: false, error: `CONNECT: ${line}` }); socket.destroy(); return }
      // keep-alive:带 Connection: close 的话对端一答完就关,内核随即把它从连接表里删掉,
      // 后面就查不到了。连接由调用方 close() 收尾。
      const request = `HEAD / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: open-box-route-test\r\nConnection: keep-alive\r\n\r\n`
      const readStatus = (stream) => {
        let head = ''
        stream.on('data', (c) => {
          head += c.toString('latin1')
          const i = head.indexOf('\r\n')
          if (i === -1) return
          const m = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(head.slice(0, i))
          clearTimeout(timer)
          // 先不断开:调用方要趁连接还在的时候去内核连接表里找它,找完再 close()。
          // 兜底 15 秒后自动断,免得调用方忘了。
          const close = () => { try { stream.destroy() } catch { /* ignore */ } try { socket.destroy() } catch { /* ignore */ } }
          setTimeout(close, 15000).unref?.()
          finish(m ? { ok: true, status: Number(m[1]), close } : { ok: false, error: `bad response: ${head.slice(0, i)}`, close })
        })
        stream.once('error', (err) => { clearTimeout(timer); finish({ ok: false, error: err.message }) })
        stream.once('close', () => { clearTimeout(timer); finish({ ok: false, error: 'connection closed' }) })
      }
      if (secure) {
        const secureStream = tls.connect({ socket, servername: host, rejectUnauthorized: false }, () => secureStream.write(request))
        readStatus(secureStream)
      } else {
        socket.write(request)
        readStatus(socket)
      }
    }
    socket.on('data', onConnectData)
  })

export const registerRouteTestRoutes = (app, { store, ctx, paths, fetchImpl = globalThis.fetch, probe = probeViaKernel } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '16kb' }))

  router.post('/route-test', async (req, res) => {
    const target = String((req.body || {}).target || '').trim().toLowerCase()
    if (!isValidTarget(target)) return res.status(400).json({ message: 'target must be a domain or IP' })
    let config
    try {
      config = JSON.parse(await ctx.readFile(paths.configPath))
    } catch {
      return res.status(503).json({ message: '还没有生成过配置(内核没启动过)' })
    }
    const secret = store.getClashSecret ? store.getClashSecret() : ''
    const routingConf = normalizeRouting((store.getProfile ? store.getProfile() : {}).routing)
    const out = { target }

    // 1. DNS 决策
    if (isIp(target)) {
      out.dns = { skipped: true }
    } else {
      try {
        out.dns = await decideDnsServer(ctx, paths, config, target)
      } catch (err) {
        out.dns = { error: errorMessage(err) }
      }
    }

    // 1b. 内核配置是不是旧的:DoH 的 detour 顺着内核里当前的选择下钻,落到直连出站就说明
    //     该站点集已经切到直连了,重启内核后 DNS 规则会改成本地解析。反过来(dns-direct 但
    //     站点集已切到代理)同样标出来。
    if (out.dns && out.dns.server) {
      try {
        const selections = await fetchSelections(fetchImpl, secret)
        const leafOf = (name) => {
          let cur = name
          const seen = new Set()
          for (let i = 0; i < 16 && Object.prototype.hasOwnProperty.call(selections, cur) && !seen.has(cur); i++) { seen.add(cur); cur = selections[cur] }
          return cur
        }
        const directTag = builtinTags(store.getGroups ? store.getGroups() : []).direct
        const detour = out.dns.server.detour
        if (detour) {
          const leaf = leafOf(detour)
          out.dns.runtimeLeaf = leaf
          if (leaf === directTag) out.dns.stale = 'direct'
        } else if (out.dns.ruleIndex !== null && out.dns.ruleIndex !== undefined) {
          // dns-direct 规则来自某个站点集:看它现在是否已切到代理
          const rule = (config.dns.rules || [])[out.dns.ruleIndex] || {}
          const policy = (routingConf.activePolicies || []).find((p) => (rule.rule_set && p.rulesets.join() === [].concat(rule.rule_set).join()) || (rule.domain_suffix && p.domainSuffix.join() === [].concat(rule.domain_suffix).join()))
          if (policy && Object.prototype.hasOwnProperty.call(selections, policy.name) && leafOf(policy.name) !== directTag) out.dns.stale = 'proxy'
        }
      } catch { /* 拿不到内核状态就不标 */ }
    }

    // 2. 内核解析
    if (!isIp(target)) {
      const t0 = Date.now()
      try {
        const r = await fetchWithTimeout(fetchImpl, `${CLASH_API_BASE}/dns/query?name=${encodeURIComponent(target)}&type=A`, { headers: clashHeaders(secret) }, 8000)
        const body = await r.json().catch(() => null)
        const answers = ((body && body.Answer) || []).map((a) => a && a.data).filter(Boolean)
        out.resolve = { ok: r.ok, status: r.status, answers, ms: Date.now() - t0 }
      } catch (err) {
        out.resolve = { ok: false, answers: [], ms: Date.now() - t0, error: errorMessage(err) }
      }
    }

    // 3. 经内核的回环入站真实访问一次 + 从连接表里找这条连接
    // 端口:调用方给了就用(格式化查询会把 URL 里的端口带过来),没给按 域名 443 / IP 80。
    // 80 以外一律按 TLS 处理(4433、8443 这类都是 https)。
    const bodyPort = Number((req.body || {}).port)
    const port = Number.isInteger(bodyPort) && bodyPort >= 1 && bodyPort <= 65535 ? bodyPort : isIp(target) ? 80 : 443
    const secure = port !== 80
    let exit = { url: `${secure ? 'https' : 'http'}://${target}${(secure && port === 443) || (!secure && port === 80) ? '' : `:${port}`}/` }
    const r = await probe(target, { port, secure })
    exit = { ...exit, ok: r.ok, status: r.status, ms: r.ms }
    if (!r.ok) exit.error = r.error
    try {
      const resolvedIps = new Set(((out.resolve && out.resolve.answers) || []).map(String))
      let hit = null
      let total = 0
      let sample = []
      for (let attempt = 0; attempt < 4 && !hit; attempt++) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 200))
        const c = await fetchWithTimeout(fetchImpl, `${CLASH_API_BASE}/connections`, { headers: clashHeaders(secret) }, 5000)
        const body = await c.json()
        const list = (body && body.connections) || []
        total = list.length
        sample = list.slice(-5).map((x) => (x && x.metadata ? `${x.metadata.host || ''}|${x.metadata.destinationIP || ''}` : '?'))
        const mine = list
          .filter((x) => x && x.metadata && (
            String(x.metadata.host || '').toLowerCase() === target ||
            x.metadata.destinationIP === target ||
            // 对端不带域名(或内核没记 host)时,退一步按解析到的 IP 对
            (resolvedIps.size > 0 && resolvedIps.has(String(x.metadata.destinationIP || '')))
          ))
          .sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')))
        hit = mine[0] || null
      }
      if (hit) {
        exit.chains = Array.isArray(hit.chains) ? hit.chains.slice().reverse() : []
        exit.rule = hit.rule || ''
        exit.rulePayload = hit.rulePayload || ''
        exit.destinationIP = hit.metadata.destinationIP || ''
      } else if (r.ok) {
        exit.notSeen = true
        exit.debug = { connections: total, sample }
      }
    } catch (err) {
      exit.connectionsError = errorMessage(err)
    } finally {
      if (typeof r.close === 'function') r.close()
    }
    out.exit = exit
    res.json(out)
  })

  app.use('/api/openbox', router)
}
