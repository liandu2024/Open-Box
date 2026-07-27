export const buildRoute = (routing, rulesetDir, options = {}) => {
  const rulesetTags = new Set()
  const addTag = (tag) => { if (tag) rulesetTags.add(tag) }

  const dnsMode = options.dnsMode || 'hijack'
  const rules = [{ action: 'sniff' }]
  if (dnsMode === 'hijack') {
    rules.push({ protocol: 'dns', action: 'hijack-dns' })
  } else if (dnsMode === 'dnsmasq') {
    // dnsmasq 接管模式下不能全局劫持 DNS 协议流量:tun 里到 dns-in 的转发查询也会
    // 匹配 {protocol:'dns'},被劫持回同一个 dns-in 入站,形成自环导致解析超时。
    // 仅劫持 dns-in 自身收到的查询,其余 DNS 流量按普通路由走(交给 dnsmasq 上游)。
    rules.push({ inbound: ['dns-in'], action: 'hijack-dns' })
  }
  rules.push({ ip_is_private: true, outbound: 'direct' })

  if (routing.adBlock) {
    const adTag = routing.adRuleset || 'geosite-category-ads-all'
    addTag(adTag)
    rules.push({ rule_set: adTag, action: 'reject' })
  }
  for (const cat of routing.categories || []) {
    addTag(cat.ruleset)
    rules.push({ rule_set: cat.ruleset, outbound: cat.target })
  }
  for (const tag of routing.directRulesets || []) {
    addTag(tag)
    rules.push({ rule_set: tag, outbound: 'direct' })
  }

  const rule_set = [...rulesetTags].map((tag) => ({
    type: 'local', tag, format: 'binary', path: `${rulesetDir}/${tag}.srs`,
  }))

  const route = {
    auto_detect_interface: true,
    default_domain_resolver: 'dns-direct',
    rule_set,
    rules,
    final: routing.fallback || routing.proxyTag || 'PROXY',
  }
  return { route, rulesetTags }
}
