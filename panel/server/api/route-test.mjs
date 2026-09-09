import express from 'express'
import net from 'node:net'
import tls from 'node:tls'
import { PANEL_INBOUND_PORT, PANEL_INBOUND_TAG } from '../engine/config.mjs'
import { CLASH_API_BASE, hasDestinationCondition, matchLocalConditions, matchRuleSetList } from './penetration.mjs'
import { cidrContains } from '../system/local-subnets.mjs'
import { fetchSelections } from './deploy-runner.mjs'
import { flushDnsCache } from '../system/dns-cache.mjs'
import { builtinTags } from '../engine/user-groups.mjs'
import { normalizeRouting } from '../engine/routing-model.mjs'
import { DNS_REWRITE_TAG, matchRewrite, normalizeDnsRewrite } from '../engine/dns-rewrite.mjs'

// 「真实路由」:不只按规则推,而是真的走一遍——
//   1. DNS 用哪台服务器:按生成配置里 dns.rules 的顺序判(规则集用内核 rule-set match,
//      域名条件本地比),得到 dns-direct(直连解析)还是某个带 detour 的代理 DNS;
//   2. 解析结果:问内核自己的 DNS(clash_api /dns/query),拿到的就是内核会用的答案;
//   3. 实际出口:面板进程在路由器上真发一个 HTTPS 请求(会经过 tun 进内核),然后到
//      clash_api /connections 里找这条连接,读它实际走的链路和命中的规则;顺带记耗时。
const TARGET_PATTERN = /^[A-Za-z0-9._:-]+$/
const isValidTarget = (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('-') && TARGET_PATTERN.test(v)
const isIp = (v) => net.isIP(String(v)) !== 0
// host:port 的写法:IPv6 字面量要加方括号(RFC 3986 §3.2.2),否则 "2001:db8::1:80" 分不出端口
export const hostPort = (host, port) => (net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`)
// URL 里的 host 部分:IPv6 同样加括号;默认端口不写
export const targetUrl = (host, port, secure) => {
  const h = net.isIPv6(host) ? `[${host}]` : host
  const defaultPort = secure ? 443 : 80
  return `${secure ? 'https' : 'http'}://${h}${port === defaultPort ? '' : `:${port}`}/`
}
// fake-ip 的地址段:sing-box / Clash / OpenClash 默认都在 198.18.0.0/15(RFC 2544 保留段,公网上
// 不会有),sing-box 的 IPv6 默认 fc00::/18。解析结果落在这里面,只可能是某个做 fake-ip 的
// 客户端替真正的 DNS 答的:查询是往 1.1.1.1 发的,却在半路(线路对端的透明代理)被截下来。
export const isFakeIp = (ip) => /^198\.1[89]\.\d{1,3}\.\d{1,3}$/.test(String(ip)) || /^fc[0-3][0-9a-f]:/i.test(String(ip))
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

// dns.rules 里每条的条件和 route.rules 同一套写法(rule_set / domain / domain_suffix / domain_keyword /
// source_ip_cidr)。带来源条件的规则要有终端来源 IP 才判得了;没给时不中断,记成前提(按不在该来源里的
// 终端推算)继续往下,前提原样回给前端列出来
// rewriteRules:档案里的 DNS 重写规则(engine/dns-rewrite.mjs 归一化后的);命中 dns-rewrite 服务器时把命中的
// 那条(源 / 目标)一并回给前端,规则页画成「原域名 → 目标」
// ignoreServers:跳过指向这些解析器的规则——重写服务要知道「没有重写时这个域名会怎么判」,就把 dns-rewrite 那条跳过
export const decideDnsServer = async (ctx, paths, config, target, { sourceIp = '', rewriteRules = [], ignoreServers = [] } = {}) => {
  const dns = config.dns || {}
  const ignored = new Set(ignoreServers)
  const servers = new Map((dns.servers || []).map((s) => [s.tag, s]))
  const srsPathByTag = new Map(((config.route || {}).rule_set || []).map((r) => [r.tag, r.path]))
  const rules = dns.rules || []
  // 内核自己的 fakeip 规则(engine/dns.mjs 的 FakeIP 原型):A / AAAA 先拿占位地址,真正的解析发生在
  // 连接时选中的节点那头。判定时把它记成 fakeIpRule 后继续往下找同一个匹配的真解析器(其它查询
  // 类型仍走它),两边一起给前端画
  let fakeIpRule
  const assumed = []
  // 返回时给每条前提标 sameOutcome:它命中时用的解析器 / 拒绝,和这里判出来的结果是不是一样(一样的前端不提示)
  const withFake = (r0) => {
    let r = r0
    if (r.server && r.server.tag === DNS_REWRITE_TAG) {
      const hit = matchRewrite(rewriteRules, target)
      r = { ...r, rewrite: hit ? { source: hit.source, domain: hit.domain, addresses: hit.addresses } : { source: '', domain: '', addresses: [] } }
    }
    const out = fakeIpRule === undefined ? r : { ...r, fakeIpRule }
    if (!assumed.length) return out
    const finalized = assumed.map((a) => ({ ...a, sameOutcome: a.action === 'reject' ? Boolean(r.rejected) : Boolean(r.server && a.server === r.server.tag) }))
    return { ...out, assumed: finalized }
  }
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (!rule || typeof rule !== 'object') continue
    if (rule.server && ignored.has(rule.server)) continue
    // 只管某些查询类型、又不含 A 的规则(代理 v6 降为 IPv4 时给走代理的域名回空 AAAA 的 predefined 那条)和这里
    // 无关:规则页推算的是「这个域名的 A 查询由谁解析」
    if (Array.isArray(rule.query_type) && rule.query_type.length && !rule.query_type.includes('A')) continue
    const hasDest = hasDestinationCondition(rule)
    const hasSource = Object.prototype.hasOwnProperty.call(rule, 'source_ip_cidr')
    const fake = rule.server && (servers.get(rule.server) || {}).type === 'fakeip'
    if (!hasDest && !hasSource && !fake) continue
    if (hasSource && sourceIp) {
      const list = Array.isArray(rule.source_ip_cidr) ? rule.source_ip_cidr : [rule.source_ip_cidr]
      if (!list.some((c) => cidrContains(c, sourceIp))) continue
    }
    let hit = !hasDest
    if (hasDest && matchLocalConditions(rule, target)) hit = true
    else if (hasDest && Object.prototype.hasOwnProperty.call(rule, 'rule_set')) {
      const r = await matchRuleSetList(ctx, paths, srsPathByTag, rule.rule_set, target)
      if (r.error) return { error: `dns rule #${i + 1}: ${r.error}` }
      hit = r.hit
    }
    if (!hit) continue
    // 目标这一组命中了、但规则还要看来源而这次没给:记成前提,按不在该来源里的终端继续
    if (hasSource && !sourceIp) {
      const a = { ruleIndex: i, needs: ['sourceIp'], sourceIpCidr: [].concat(rule.source_ip_cidr) }
      if (rule.server !== undefined) a.server = rule.server
      if (rule.action !== undefined) a.action = rule.action
      assumed.push(a)
      continue
    }
    if (rule.action === 'reject') return withFake({ ruleIndex: i, rejected: true })
    if (fake) {
      if (fakeIpRule === undefined) fakeIpRule = i
      continue
    }
    const server = servers.get(rule.server) || { tag: rule.server }
    return withFake({ ruleIndex: i, server, viaProxy: Boolean(server.detour) })
  }
  const server = servers.get(dns.final) || { tag: dns.final || '' }
  return withFake({ ruleIndex: null, server, viaProxy: Boolean(server.detour) })
}

const clashHeaders = (secret) => (secret ? { Authorization: `Bearer ${secret}` } : {})

// 经内核的回环 mixed 入站发一次真实请求:CONNECT 目标:port → (443 时再套 TLS)→ HEAD /。
// 走这条路请求才会像客户端流量一样过内核的分流规则,连接表里也就能找到它。
// connectTo:终端都是先解析再按 IP 去连的,探测也一样——CONNECT 的目标写解析出来的 IP,
// TLS 的 SNI / HTTP 的 Host 仍是域名,内核靠嗅探拿到域名去匹配规则(和 tun 里的终端流量一样)。
// 这一点决定了节点那头拿到的是 IP 还是域名:内核不改写目标(sniff 不带 override_destination),
// 节点拿到的就是这个 IP,按它直接连,不会再解析一次;拿到域名才会在节点那边再解析。
// 只读响应首行,拿到状态码就断开。
export const probeViaKernel = (host, { port = 443, secure = port !== 80, proxyPort = PANEL_INBOUND_PORT, timeoutMs = 10000, connectTo = '' } = {}) =>
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
      const dest = hostPort(connectTo || host, port)
      socket.write(`CONNECT ${dest} HTTP/1.1\r\nHost: ${dest}\r\n\r\n`)
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
      const hostHeader = net.isIPv6(host) ? `[${host}]` : host
      const request = `HEAD / HTTP/1.1\r\nHost: ${hostHeader}\r\nUser-Agent: open-box-route-test\r\nConnection: keep-alive\r\n\r\n`
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
        // SNI 只能是域名:IP 字面量不能进 SNI(RFC 6066),Node 也会拒
        const secureStream = tls.connect({ socket, ...(isIp(host) ? {} : { servername: host }), rejectUnauthorized: false }, () => secureStream.write(request))
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
        const sourceIp = req.body && typeof req.body.sourceIp === 'string' && net.isIP(req.body.sourceIp.trim()) ? req.body.sourceIp.trim() : ''
        out.dns = await decideDnsServer(ctx, paths, config, target, { sourceIp, rewriteRules: typeof store?.getProfile === 'function' ? normalizeDnsRewrite(store.getProfile().dns).rules : [] })
        // 下面的解析和访问都是面板自己发起的:内核的 DNS 查询接口(clash API /dns/query)不带原终端来源,
        // 回环 mixed 入站的探测来源也是本机——指定终端的来源规则在这两步里没有生效,不能把它们画成
        // "该终端的实测"(复审 S4)
        if (sourceIp) out.context = { sourceIp, predictedFor: 'terminal', probeOrigin: 'panel', sourceVerified: false }
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
        // 顺着 selector 的 now 一路下钻:站点集 → 节点组 → 节点。查询实际经过的线路就是这一串
        const chainOf = (name) => {
          const chain = [name]
          const seen = new Set()
          let cur = name
          for (let i = 0; i < 16 && Object.prototype.hasOwnProperty.call(selections, cur) && !seen.has(cur); i++) { seen.add(cur); cur = selections[cur]; chain.push(cur) }
          return chain
        }
        const leafOf = (name) => chainOf(name).at(-1)
        const directTag = builtinTags(store.getGroups ? store.getGroups() : []).direct
        const detour = out.dns.server.detour
        if (detour) {
          out.dns.runtimeChain = chainOf(detour)
          out.dns.runtimeLeaf = out.dns.runtimeChain.at(-1)
        }
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
      // 每次查询都先清掉内核 DNS 缓存:这一页的全部意义就是"看真实路由",拿一份之前
      // 别的线路问出来的缓存答案没有意义(界面上只能标一句"命中缓存",看不到真实答案)。
      // 打字触发的那次也清——输入停下 600ms 才发一次请求,一次查询就是一次,不会被每个
      // 按键牵动。代价是这一趟慢几十到几百毫秒,以及局域网里别的域名要重新解析一次。
      await flushDnsCache(fetchImpl, secret)
      const t0 = Date.now()
      try {
        const r = await fetchWithTimeout(fetchImpl, `${CLASH_API_BASE}/dns/query?name=${encodeURIComponent(target)}&type=A`, { headers: clashHeaders(secret) }, 8000)
        const body = await r.json().catch(() => null)
        const records = ((body && body.Answer) || []).filter((a) => a && a.data)
        const answers = records.map((a) => a.data)
        const ms = Date.now() - t0
        out.resolve = { ok: r.ok, status: r.status, answers, ms }
        const ttl = records.map((a) => Number(a.TTL)).find((n) => Number.isFinite(n))
        if (ttl !== undefined) out.resolve.ttl = ttl
        // 档案开了 IPv6 才问 AAAA:关着时内核 strategy=ipv4_only,问了也是空。分开报,A / AAAA
        // 各自验证(审核 C1:以前只查 A,IPv6 路径完全没看)
        const profile = store.getProfile ? store.getProfile() : null
        if (profile && profile.ipv6) {
          try {
            const r6 = await fetchWithTimeout(fetchImpl, `${CLASH_API_BASE}/dns/query?name=${encodeURIComponent(target)}&type=AAAA`, { headers: clashHeaders(secret) }, 8000)
            const body6 = await r6.json().catch(() => null)
            // 查询本身成没成功(HTTP 状态)和有没有记录分开记:空答案不能盖住"查询失败"
            out.resolve.ok6 = r6.ok
            out.resolve.status6 = r6.status
            out.resolve.answers6 = ((body6 && body6.Answer) || []).filter((a) => a && a.data && String(a.data).includes(':')).map((a) => a.data)
          } catch (err) {
            out.resolve.answers6 = []
            out.resolve.error6 = errorMessage(err)
          }
        }
        // 命中内核 DNS 缓存的判断:代理侧解析要在隧道里新开一条 TCP 到 DNS 服务器再问,至少两个
        // 来回,几十毫秒起步;几毫秒就回来的只能是缓存。缓存不分线路——换了节点,缓存没过期前
        // 拿到的还是上一条线路问出来的答案。直连解析本来就只有几毫秒,分不出来,不标。
        if (out.dns && out.dns.server && out.dns.server.detour && ms < 20 && answers.length) out.resolve.cached = true
      } catch (err) {
        out.resolve = { ok: false, answers: [], ms: Date.now() - t0, error: errorMessage(err) }
      }
      // 2b. 答案是 fake-ip:配置里写的那台 DNS 根本没收到这条查询,是线路对端截下来答的。
      //     代理侧解析时对端就是 detour 此刻落到的那个节点(runtimeLeaf;拿不到内核状态就退回
      //     detour 本身),前端把它画成单独一环;直连解析回 fake-ip 则是上游 DNS 自己在做 fake-ip。
      if (out.resolve.answers.length && out.resolve.answers.every(isFakeIp)) {
        out.resolve.fakeIp = true
        // 内核自己配了 fakeip 服务器(engine/dns.mjs 的 FakeIP 原型):走代理域名的占位地址是内核发的,
        // 不是线路对端截下来答的;连接进内核时会按占位地址找回域名再分流
        if (out.dns && out.dns.fakeIpRule !== undefined) {
          out.resolve.fakeIpLocal = true
        } else {
          const detour = out.dns && out.dns.server && out.dns.server.detour
          if (detour) out.resolve.fakeIpFrom = out.dns.runtimeLeaf || detour
        }
      }
    }

    // 3. 经内核的回环入站真实访问一次,同时在连接表里找这条连接
    // 端口:调用方给了就用(格式化查询会把 URL 里的端口带过来),没给按 域名 443 / IP 80。
    // 80 以外一律按 TLS 处理(4433、8443 这类都是 https)。
    const bodyPort = Number((req.body || {}).port)
    const port = Number.isInteger(bodyPort) && bodyPort >= 1 && bodyPort <= 65535 ? bodyPort : isIp(target) ? 80 : 443
    const secure = port !== 80
    let exit = { url: targetUrl(target, port, secure) }
    // 查连接表和访问并行,而不是访问完再查:访问失败(对端关连接、超时)的那一刻这条连接就从内核
    // 连接表里消失了,事后什么都查不到;趁请求还挂着的时候找到它,失败了也知道是从哪个节点出去的。
    // 探测连接认得很准:入站是面板的回环 mixed(metadata.type = mixed/panel-in)、目标端口对得上、
    // 主机名或 IP 对得上。连接表里没有入站信息的老内核,等访问结束后退一步只按主机名 / IP 对;
    // 有入站信息但不是面板入站的(别的终端到同一目标的连接)一律不算,免得把别人的线路当成自己的。
    let settled = false
    // 像终端一样:解析出了地址就按第一个地址去连(fake-ip 也照连——终端拿到的就是它)
    const connectTo = !isIp(target) && out.resolve && out.resolve.answers.length ? String(out.resolve.answers[0]) : ''
    if (connectTo) exit.connectTo = connectTo
    const probing = probe(target, { port, secure, connectTo }).then((r) => { settled = true; return r })
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
      // 链路末尾是节点还是内置的直连 / 拒绝:走节点的,前端要写明节点拿到的是 IP 还是 fake-ip
      const leaf = exit.chains.at(-1)
      if (leaf) {
        const tags = builtinTags(store.getGroups ? store.getGroups() : [])
        exit.viaProxy = leaf !== tags.direct && leaf !== tags.block
      }
    } else if (connectionsError) {
      exit.connectionsError = connectionsError
    } else {
      exit.notSeen = true
      exit.debug = { connections: found.total, sample: found.sample }
    }
    if (typeof r.close === 'function') r.close()
    out.exit = exit
    // 有 AAAA 记录就按第一个 v6 地址再访问一次,v4 / v6 链路分别验证(只记探测结果,不再查连接表)
    const connectTo6 = !isIp(target) && out.resolve && Array.isArray(out.resolve.answers6) && out.resolve.answers6.length ? String(out.resolve.answers6[0]) : ''
    if (connectTo6) {
      const r6 = await probe(target, { port, secure, connectTo: connectTo6 })
      out.exit6 = { connectTo: connectTo6, ok: r6.ok, status: r6.status, ms: r6.ms }
      if (!r6.ok) out.exit6.error = r6.error
      if (typeof r6.close === 'function') r6.close()
    }
    res.json(out)
  })

  app.use('/api/openbox', router)
}
