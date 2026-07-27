import net from 'node:net'
import express from 'express'
import { buildRoute } from '../engine/routing.mjs'
import { groupNodesByRegion } from '../engine/groups.mjs'

// Open-Box 只管理本机唯一的 sing-box,clash_api 固定监听 127.0.0.1:9095(见 engine/config.mjs)。
const CLASH_API_BASE = 'http://127.0.0.1:9095'

const ipv4ToInt = (ip) => ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0

// RFC1918 私有段 + 127.0.0.0/8 回环 + 169.254.0.0/16 链路本地。
const IPV4_PRIVATE_RANGES = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
]

const ipv4InRange = (ipInt, base, bits) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipInt & mask) === (ipv4ToInt(base) & mask)
}

const isPrivateIPv4 = (ip) => {
  const ipInt = ipv4ToInt(ip)
  return IPV4_PRIVATE_RANGES.some(([base, bits]) => ipv4InRange(ipInt, base, bits))
}

const isPrivateIPv6 = (ip) => {
  const lower = ip.toLowerCase()
  if (lower === '::1') return true
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  const firstGroup = lower.split(':').find((g) => g.length > 0)
  if (!firstGroup) return false
  const n = parseInt(firstGroup, 16)
  if (Number.isNaN(n)) return false
  if ((n & 0xfe00) === 0xfc00) return true // fc00::/7 唯一本地地址
  if ((n & 0xffc0) === 0xfe80) return true // fe80::/10 链路本地
  return false
}

// target 若不是合法 IP(即为域名),ip_is_private 规则在未解析前不应命中——
// 只有当用户直接输入一个私有/回环 IP 时才判定命中。
export const isPrivateOrLoopbackIp = (target) => {
  const version = net.isIP(String(target).trim())
  if (version === 4) return isPrivateIPv4(target.trim())
  if (version === 6) return isPrivateIPv6(target.trim())
  return false
}

// 核心回归点:`sing-box rule-set match` 命中与不命中退出码都是 0,
// 命中判定只能看 stdout 是否含 "match rules." 开头的行,严禁用退出码判定。
export const matchRuleSet = async (ctx, paths, srsPath, target) => {
  const { stdout } = await ctx.exec(paths.singbox, ['rule-set', 'match', '-f', 'binary', srsPath, target])
  return /^match rules\./m.test(stdout || '')
}

const errorMessage = (err) => (err instanceof Error ? err.message : String(err))

// target 最终会作为参数传给 `sing-box rule-set match`(execFile,无 shell,不是命令注入),
// 但以 "-" 开头的值会被 CLI 解析成一个 flag(参数注入)。域名/IP 本身的合法字符集里不含
// 空格等 shell 元字符,这里只需要一个宽松但明确的形态校验:允许的字符集 + 不能以 "-" 开头,
// 不需要做完整的域名/IP 语法解析。
const PENETRATION_TARGET_PATTERN = /^[A-Za-z0-9._:-]+$/
const isValidPenetrationTarget = (value) => {
  return typeof value === 'string' && !value.startsWith('-') && PENETRATION_TARGET_PATTERN.test(value)
}

// 沿 clash_api 的 `now` 字段逐层下钻直到叶子节点(响应里不再有 now)。
// 任何一步失败(网络不可达/非 2xx/JSON 解析失败)都不让整个请求失败——
// 降级为只保留已知的 chain(至少含起始的组名本身)+ chainError 说明。
const resolveChain = async ({ tag, fetchImpl, secret }) => {
  const chain = [tag]
  const seen = new Set([tag])
  let current = tag
  const MAX_DEPTH = 16 // 防御性上限,避免 now 字段成环时无限循环

  for (let i = 0; i < MAX_DEPTH; i++) {
    let res
    try {
      res = await fetchImpl(`${CLASH_API_BASE}/proxies/${encodeURIComponent(current)}`, {
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      })
    } catch (err) {
      return { chain, chainError: `clash_api unreachable: ${errorMessage(err)}` }
    }
    if (!res || !res.ok) {
      return { chain, chainError: `clash_api responded HTTP ${res ? res.status : 'unknown'}` }
    }
    let body
    try {
      body = await res.json()
    } catch (err) {
      return { chain, chainError: `clash_api response parse failed: ${errorMessage(err)}` }
    }
    const now = body && typeof body.now === 'string' && body.now ? body.now : null
    if (!now || seen.has(now)) break
    seen.add(now)
    chain.push(now)
    current = now
  }
  return { chain }
}

export const registerPenetrationRoutes = (app, { store, ctx, paths, fetchImpl = globalThis.fetch } = {}) => {
  const router = express.Router()
  router.use(express.json({ limit: '1mb' }))

  router.post('/penetration', async (req, res) => {
    const target = req.body && req.body.target
    if (typeof target !== 'string' || !target.trim()) {
      return res.status(400).json({ message: 'target is required' })
    }
    if (!isValidPenetrationTarget(target)) {
      return res.status(400).json({ message: 'target must be a valid domain or IP address' })
    }

    const profile = store.getProfile()
    const nodes = store.getNodes()
    const { route } = buildRoute(profile.routing, profile.rulesetDir)

    // tag → 本地 .srs 路径:直接复用 buildRoute 已经算好的 rule_set 映射,
    // 不再重复拼接(避免与 buildRoute 内部拼接规则出现两处不一致)。
    const srsPathByTag = new Map(route.rule_set.map((r) => [r.tag, r.path]))

    // 策略组 tag 集合:proxyTag(主 selector)+ 各区域分组名。用来判定
    // 一个 outbound 是"策略组"(需要经 clash_api 下钻)还是叶子节点/direct(无需下钻)。
    const { groups } = groupNodesByRegion(nodes)
    const proxyTag = profile.routing.proxyTag || 'PROXY'
    const groupTags = new Set([proxyTag, ...groups.map((g) => g.name)])

    let matched = null
    for (let i = 0; i < route.rules.length; i++) {
      const rule = route.rules[i]
      let hit = false
      if (Object.prototype.hasOwnProperty.call(rule, 'ip_is_private')) {
        hit = isPrivateOrLoopbackIp(target)
      } else if (Object.prototype.hasOwnProperty.call(rule, 'rule_set')) {
        const srsPath = srsPathByTag.get(rule.rule_set)
        hit = srsPath ? await matchRuleSet(ctx, paths, srsPath, target) : false
      } else {
        continue // action:'sniff' / protocol:'dns' hijack-dns 等无条件规则,不参与穿透判定
      }
      if (hit) {
        matched = { index: i, rule }
        if (rule.outbound !== undefined) matched.outbound = rule.outbound
        if (rule.action !== undefined) matched.action = rule.action
        break
      }
    }

    const finalOutbound = matched ? (matched.outbound !== undefined ? matched.outbound : null) : route.final

    let chain = finalOutbound !== null && finalOutbound !== undefined ? [finalOutbound] : []
    let chainError
    if (finalOutbound && groupTags.has(finalOutbound)) {
      const secret = store.getClashSecret()
      const result = await resolveChain({ tag: finalOutbound, fetchImpl, secret })
      chain = result.chain
      chainError = result.chainError
    }

    const body = { matched, chain, finalOutbound }
    if (chainError) body.chainError = chainError
    res.json(body)
  })

  app.use('/api/openbox', router)
}
