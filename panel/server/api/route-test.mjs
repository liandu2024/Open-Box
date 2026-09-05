import express from 'express'
import net from 'node:net'
import tls from 'node:tls'
import { PANEL_INBOUND_PORT, PANEL_INBOUND_TAG } from '../engine/config.mjs'
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
    // 只有连回环入站本身失败才是「入站没开」;连上之后再出错(比如内核拨号失败把连接 RST 掉)
    // 是这条线路的问题,不能扣到入站头上
    let connected = false
    socket.once('error', (err) => { clearTimeout(timer); finish({ ok: false, error: connected ? err.message : `inbound: ${err.message}` }) })
    socket.once('connect', () => {
      connected = true
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

    // 1b. 内核配置是不是旧的:配置里这条 DNS 决策是"直连解析"还是"代理解析",是生成配置
    //     那一刻按站点集走哪定死的。拿它和内核里此刻的选择比——两边不一样就说明这份
    //     dns.rules 过期了。正常情况下面板在代理页改完出口就会在后台重新生成(见
    //     server/index.mjs),所以这里标出来的只有那几秒窗口、或者后台那次生成失败了。
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
        if (detour) out.dns.runtimeLeaf = leafOf(detour)
        // 这条决策归谁管:一条规则都没命中就是兜底,命中了就按条件反查是哪个站点集写的
        const hitRule = out.dns.ruleIndex === null || out.dns.ruleIndex === undefined
          ? null
          : (config.dns.rules || [])[out.dns.ruleIndex] || {}
        const owner = hitRule
          ? (routingConf.activePolicies || []).find((p) => (hitRule.rule_set && p.rulesets.join() === [].concat(hitRule.rule_set).join()) || (hitRule.domain_suffix && p.domainSuffix.join() === [].concat(hitRule.domain_suffix).join()))
          : routingConf.fallback
        if (owner && Object.prototype.hasOwnProperty.call(selections, owner.name)) {
          // 带 detour 的解析器 = 当时判成走代理;dns-direct / dns-local 没有 detour = 判成走直连
          const baked = detour ? 'proxy' : 'direct'
          const now = leafOf(owner.name) === directTag ? 'direct' : 'proxy'
          if (now !== baked) out.dns.stale = now
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

    // 3. 经内核的回环入站真实访问一次,同时在连接表里找这条连接
    // 端口:调用方给了就用(格式化查询会把 URL 里的端口带过来),没给按 域名 443 / IP 80。
    // 80 以外一律按 TLS 处理(4433、8443 这类都是 https)。
    const bodyPort = Number((req.body || {}).port)
    const port = Number.isInteger(bodyPort) && bodyPort >= 1 && bodyPort <= 65535 ? bodyPort : isIp(target) ? 80 : 443
    const secure = port !== 80
    let exit = { url: `${secure ? 'https' : 'http'}://${target}${(secure && port === 443) || (!secure && port === 80) ? '' : `:${port}`}/` }
    // 查连接表和访问并行,而不是访问完再查:访问失败(对端关连接、超时)的那一刻这条连接就从内核
    // 连接表里消失了,事后什么都查不到;趁请求还挂着的时候找到它,失败了也知道是从哪个节点出去的。
    // 探测连接认得很准:入站是面板的回环 mixed(metadata.type = mixed/panel-in)、目标端口对得上、
    // 主机名或 IP 对得上。连接表里没有入站信息的老内核,等访问结束后退一步只按主机名 / IP 对;
    // 有入站信息但不是面板入站的(别的终端到同一目标的连接)一律不算,免得把别人的线路当成自己的。
    let settled = false
    const probing = probe(target, { port, secure }).then((r) => { settled = true; return r })
    const resolvedIps = new Set(((out.resolve && out.resolve.answers) || []).map(String))
    const sameTarget = (m) => String(m.host || '').toLowerCase() === target ||
      m.destinationIP === target ||
      (resolvedIps.size > 0 && resolvedIps.has(String(m.destinationIP || '')))
    const viaPanelInbound = (m) => String(m.type || '').endsWith(`/${PANEL_INBOUND_TAG}`) && String(m.destinationPort || '') === String(port)
    const newestFirst = (a, b) => String(b.start || '').localeCompare(String(a.start || ''))
    const lookup = async () => {
      const delays = [100, 200, 300, 500, 800, 1000]
      let total = 0
      let sample = []
      let after = 0
      for (let i = 0; ; i++) {
        const c = await fetchWithTimeout(fetchImpl, `${CLASH_API_BASE}/connections`, { headers: clashHeaders(secret) }, 5000)
        const body = await c.json()
        const list = ((body && body.connections) || []).filter((x) => x && x.metadata)
        total = list.length
        sample = list.slice(-5).map((x) => `${x.metadata.host || ''}|${x.metadata.destinationIP || ''}`)
        const mine = list.filter((x) => sameTarget(x.metadata)).sort(newestFirst)
        const exact = mine.find((x) => viaPanelInbound(x.metadata))
        if (exact) return { hit: exact, total, sample }
        if (settled) {
          const loose = mine.find((x) => !x.metadata.type)
          if (loose) return { hit: loose, total, sample }
          if (++after >= 3) return { hit: null, total, sample }
        }
        await new Promise((resolve) => setTimeout(resolve, delays[Math.min(i, delays.length - 1)]))
      }
    }
    let found = { hit: null, total: 0, sample: [] }
    let connectionsError = ''
    const looking = lookup().then((f) => { found = f }, (err) => { connectionsError = errorMessage(err) })
    const r = await probing
    await looking
    exit = { ...exit, ok: r.ok, status: r.status, ms: r.ms }
    if (!r.ok) exit.error = r.error
    if (found.hit) {
      exit.chains = Array.isArray(found.hit.chains) ? found.hit.chains.slice().reverse() : []
      exit.rule = found.hit.rule || ''
      exit.rulePayload = found.hit.rulePayload || ''
      exit.destinationIP = found.hit.metadata.destinationIP || ''
    } else if (connectionsError) {
      exit.connectionsError = connectionsError
    } else {
      exit.notSeen = true
      exit.debug = { connections: found.total, sample: found.sample }
    }
    if (typeof r.close === 'function') r.close()
    out.exit = exit
    res.json(out)
  })

  app.use('/api/openbox', router)
}
