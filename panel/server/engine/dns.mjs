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
  return { type: 'udp', tag: 'dns-direct', server, detour: 'direct' }
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
  const servers = [directServer, { type: 'https', tag: 'dns-proxy', server: proxyHost, detour: conf.proxyTag }]

  const rules = []
  if (conf.adBlock) {
    rules.push({ rule_set: conf.adRuleset, action: 'reject' })
  }

  // 每条策略一台自己的 DNS 服务器,detour 指向同名 selector——「代理的 DNS 要到具体
  // 指定的节点」就是靠这个:用户在代理页把策略切到哪条线路,它的域名解析也跟着走那条。
  conf.policies.forEach((policy, index) => {
    if (!hasDomainCondition(policy)) return
    const tag = `dns-policy-${index}`
    servers.push({ type: 'https', tag, server: proxyHost, detour: policy.name })
    rules.push(policyDnsRule(policy, tag))
  })

  // 地区层,和路由规则一一对应:那个地区的规则集走哪个出站,它的域名就用哪边的 DNS。
  const region = conf.region
  const regionServer = region && region.target === 'proxy' ? 'dns-proxy' : 'dns-direct'
  for (const tag of (region ? region.rulesets : [])) rules.push({ rule_set: tag, server: regionServer })

  return {
    servers,
    rules,
    final: region && region.fallback === 'proxy' ? 'dns-proxy' : 'dns-direct',
    strategy,
  }
}
