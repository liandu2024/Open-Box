import { DEFAULT_BUILTIN, effectiveOutbound, normalizeRouting, policyOutboundOptions } from './routing-model.mjs'

const extractHost = (url) => {
  // "https://1.1.1.1/dns-query" -> "1.1.1.1";裸 host 原样返回
  try {
    if (/^[a-z]+:\/\//i.test(url)) return new URL(url).hostname
  } catch { /* fall through */ }
  return url
}

// 直连侧的 DNS。要求是"交回系统默认,不经过 Open-Box 的代理",但两种接管模式下
// "系统默认"指的不是同一个东西:
//   hijack   —— 路由器的 /etc/resolv.conf 指向 dnsmasq,dnsmasq 的上游是 WAN。
//               直接用 sing-box 的 local 类型(走系统解析器)即可,没有回环。
//   dnsmasq  —— 此时 dnsmasq 的上游**就是 sing-box 自己**。再用 local 就成了
//               sing-box → dnsmasq → sing-box 的死循环,解析会直接超时。所以必须
//               拿 WAN 下发的上游 IP(部署时从 resolv.conf.auto 读,见
//               system/resolv.mjs),经 direct 出站去查。
const directServerFor = (profile, options) => {
  const dnsMode = (profile.dns && profile.dns.mode) || 'hijack'
  if (dnsMode !== 'dnsmasq') return { type: 'local', tag: 'dns-direct' }

  const systemDns = Array.isArray(options.systemDns) ? options.systemDns.filter(Boolean) : []
  const server = systemDns[0] || profile.dns.direct
  // 不写 detour:不写就是走默认出站,而默认出站正是 direct。显式写 detour:'direct'
  // 会被内核在**启动时**拒绝——"detour to an empty direct outbound makes no sense",
  // 而 `sing-box check` 不查这一条,所以校验过了、一跑就 FATAL(真机上就是这样死循环的)。
  return { type: 'udp', tag: 'dns-direct', server }
}

// 策略的域名类条件 → 一条 DNS 规则。ip_cidr 不进来:DNS 查询阶段还没有 IP,
// 拿它当条件永远不会命中,写进去只会让人以为生效了。
const policyDnsRule = (policy, server) => {
  const rule = { server }
  if (policy.rulesets.length) rule.rule_set = policy.rulesets
  if (policy.domain.length) rule.domain = policy.domain
  if (policy.domainSuffix.length) rule.domain_suffix = policy.domainSuffix
  if (policy.domainKeyword.length) rule.domain_keyword = policy.domainKeyword
  return rule
}

const hasDomainCondition = (p) =>
  p.rulesets.length > 0 || p.domain.length > 0 || p.domainSuffix.length > 0 || p.domainKeyword.length > 0

export const buildDns = (profile, options = {}) => {
  const strategy = profile.ipv6 ? 'prefer_ipv4' : 'ipv4_only'
  const directServer = directServerFor(profile, options)

  if (!profile.dns.split) {
    return { servers: [directServer], final: 'dns-direct', strategy }
  }

  const conf = normalizeRouting(profile.routing)
  const proxyHost = extractHost(profile.dns.proxy)
  // 代理侧的解析 detour 到兜底站点集「其他」:上面没被任何站点集挑走的域名,走哪条线路
  // 就用哪条线路解析,和各站点集各自 detour 到自己的 selector 是同一个道理。
  const servers = [directServer, { type: 'https', tag: 'dns-proxy', server: proxyHost, detour: conf.fallback.name }]

  const rules = []
  if (conf.adBlock) {
    rules.push({ rule_set: conf.adRuleset, action: 'reject' })
  }

  // 每个站点集的域名怎么解析,看它此刻实际走哪:
  //   · 走直连 → dns-direct(本地/直连解析,国内站点才拿得到就近的 CDN 地址)
  //   · 走代理 → 一台专属 DoH,detour 指向同名 selector,解析和流量同一条路
  // "此刻走哪"优先用内核里当前的选择(options.selections:生成配置时从跑着的内核读
  // 出来的各 selector 的 now,顺着 now 一路下钻到叶子),内核没在跑时才退回档案里的默认。
  // 这样重启内核会按用户在代理页选好的线路重新生成 DNS 规则;两次重启之间切换了
  // 直连/代理,DNS 侧要等下次重启才跟上——这是配置层的取舍。
  const builtin = options.builtin || DEFAULT_BUILTIN
  const members = policyOutboundOptions(conf.outboundOptions, options.groupTags || [], builtin)
  const selections = options.selections && typeof options.selections === 'object' ? options.selections : {}
  const leafOf = (name) => {
    let current = name
    const seen = new Set()
    for (let i = 0; i < 16 && Object.prototype.hasOwnProperty.call(selections, current) && !seen.has(current); i++) {
      seen.add(current)
      current = selections[current]
    }
    return current
  }
  const goesDirect = (name, fallbackDefault) => {
    const chosen = Object.prototype.hasOwnProperty.call(selections, name)
      ? leafOf(name)
      : effectiveOutbound(fallbackDefault, members, builtin)
    return chosen === builtin.direct
  }
  conf.activePolicies.forEach((policy, index) => {
    if (!hasDomainCondition(policy)) return
    if (goesDirect(policy.name, policy.default)) {
      rules.push(policyDnsRule(policy, 'dns-direct'))
      return
    }
    const tag = `dns-policy-${index}`
    servers.push({ type: 'https', tag, server: proxyHost, detour: policy.name })
    rules.push(policyDnsRule(policy, tag))
  })

  return {
    servers,
    rules,
    // 兜底:上面都没命中的域名,按兜底站点集此刻走哪来定用哪边解析
    final: goesDirect(conf.fallback.name, conf.fallback.default) ? 'dns-direct' : 'dns-proxy',
    strategy,
  }
}
