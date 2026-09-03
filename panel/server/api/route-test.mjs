import express from 'express'
import { CLASH_API_BASE, matchLocalConditions, matchRuleSetList } from './penetration.mjs'

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

export const registerRouteTestRoutes = (app, { store, ctx, paths, fetchImpl = globalThis.fetch } = {}) => {
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

    // 3. 真实访问 + 从连接表里找这条连接
    const url = isIp(target) ? `http://${target}/` : `https://${target}/`
    const t1 = Date.now()
    let exit = { url }
    try {
      const r = await fetchWithTimeout(fetchImpl, url, { method: 'GET', redirect: 'manual' }, 10000)
      exit = { ...exit, ok: true, status: r.status, ms: Date.now() - t1 }
      try {
        const c = await fetchWithTimeout(fetchImpl, `${CLASH_API_BASE}/connections`, { headers: clashHeaders(secret) }, 5000)
        const body = await c.json()
        const list = (body && body.connections) || []
        const mine = list
          .filter((x) => x && x.metadata && (String(x.metadata.host || '').toLowerCase() === target || x.metadata.destinationIP === target))
          .sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')))
        const hit = mine[0]
        if (hit) {
          exit.chains = Array.isArray(hit.chains) ? hit.chains.slice().reverse() : []
          exit.rule = hit.rule || ''
          exit.rulePayload = hit.rulePayload || ''
          exit.destinationIP = hit.metadata.destinationIP || ''
        } else {
          exit.notSeen = true
        }
      } catch (err) {
        exit.connectionsError = errorMessage(err)
      }
      try { r.body && r.body.cancel && r.body.cancel() } catch { /* ignore */ }
    } catch (err) {
      exit = { ...exit, ok: false, ms: Date.now() - t1, error: errorMessage(err) }
    }
    out.exit = exit
    res.json(out)
  })

  app.use('/api/openbox', router)
}
