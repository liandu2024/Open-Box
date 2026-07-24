export const buildRoute = (routing, rulesetDir) => {
  const rulesetTags = new Set()
  const addTag = (tag) => { if (tag) rulesetTags.add(tag) }

  const rules = [
    { action: 'sniff' },
    { protocol: 'dns', action: 'hijack-dns' },
    { ip_is_private: true, outbound: 'direct' },
  ]

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
