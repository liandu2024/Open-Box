const extractHost = (url) => {
  // "https://1.1.1.1/dns-query" -> "1.1.1.1";裸 host 原样返回
  try {
    if (/^[a-z]+:\/\//i.test(url)) return new URL(url).hostname
  } catch { /* fall through */ }
  return url
}

export const buildDns = (profile) => {
  const strategy = profile.ipv6 ? 'prefer_ipv4' : 'ipv4_only'
  const directServer = { type: 'udp', tag: 'dns-direct', server: profile.dns.direct }

  if (!profile.dns.split) {
    return { servers: [directServer], final: 'dns-direct', strategy }
  }

  const proxyTag = profile.routing.proxyTag || 'PROXY'
  const proxyServer = { type: 'https', tag: 'dns-proxy', server: extractHost(profile.dns.proxy), detour: proxyTag }

  const rules = []
  if (profile.routing.adBlock) {
    rules.push({ rule_set: profile.routing.adRuleset || 'geosite-category-ads-all', action: 'reject' })
  }
  for (const cat of profile.routing.categories || []) {
    // 代理侧类别域名 → 代理 DNS
    rules.push({ rule_set: cat.ruleset, server: 'dns-proxy' })
  }
  for (const tag of profile.routing.directRulesets || []) {
    rules.push({ rule_set: tag, server: 'dns-direct' })
  }

  return { servers: [directServer, proxyServer], rules, final: 'dns-proxy', strategy }
}
