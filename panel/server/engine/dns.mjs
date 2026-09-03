import { normalizeRouting } from './routing-model.mjs'

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

  // 每个站点集一台自己的 DoH 服务器,detour 指向同名 selector:用户在代理页把站点集切到
  // 哪条线路,这个站点集的域名解析就走哪条——切到直连就经直连出站去问 DoH,切到代理就经
  // 代理去问。以前按"默认走哪"在生成配置时二选一(直连的用本地解析),但默认值和代理页
  // 上的实际选择经常不一致(默认是直连、用户切到了代理),结果解析还走本地上游,答案被
  // 污染/劫持;现在解析和流量永远同一条路,不用重启内核就跟着变。
  conf.activePolicies.forEach((policy, index) => {
    if (!hasDomainCondition(policy)) return
    const tag = `dns-policy-${index}`
    servers.push({ type: 'https', tag, server: proxyHost, detour: policy.name })
    rules.push(policyDnsRule(policy, tag))
  })

  return {
    servers,
    rules,
    // 兜底:上面都没命中的域名经兜底站点集 detour 去问 DoH,同样跟着它在代理页的选择走
    final: 'dns-proxy',
    strategy,
  }
}
