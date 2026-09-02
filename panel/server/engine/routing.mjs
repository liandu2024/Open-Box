import { normalizeRouting, regionRuleTag } from './routing-model.mjs'

// 一条策略的匹配条件 → 一条 sing-box 路由规则。
// 同一条规则里的多个字段是「或」的关系(sing-box 规则内部各字段取并集),所以一条策略
// 写了域名后缀又写了 IP 段时,任一命中即算这条策略命中——和用户在界面上的理解一致。
const policyRule = (policy) => {
  const rule = {}
  if (policy.rulesets.length) rule.rule_set = policy.rulesets
  if (policy.domain.length) rule.domain = policy.domain
  if (policy.domainSuffix.length) rule.domain_suffix = policy.domainSuffix
  if (policy.domainKeyword.length) rule.domain_keyword = policy.domainKeyword
  if (policy.ipCidr.length) rule.ip_cidr = policy.ipCidr
  rule.outbound = policy.name
  return rule
}

export const buildRoute = (routing, rulesetDir, options = {}) => {
  const conf = normalizeRouting(routing)
  const proxyTag = conf.proxyTag
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

  if (conf.adBlock) {
    addTag(conf.adRuleset)
    rules.push({ rule_set: conf.adRuleset, action: 'reject' })
  }

  // 策略排在地区规则之前:策略是用户对某一类流量的显式指定,应当盖过"这个地区默认
  // 怎么走"。比如人在国内(CN)但想让某个国内站点走代理,建一条策略就能压过 geosite-cn。
  for (const policy of conf.policies) {
    for (const tag of policy.rulesets) addTag(tag)
    rules.push(policyRule(policy))
  }

  // 地区分流:选中的那条地区,按它自己的规则表逐条来。表里的顺序就是匹配顺序
  // (内核首条命中生效),每条自己带动作,所以"中国站点直连、其余走代理"和
  // "中国站点走代理(回国)、其余直连"是同一套机制、不同的数据。
  const region = conf.region
  for (const rule of (region ? region.rules : [])) {
    const outbound = rule.action === 'proxy' ? proxyTag : 'direct'
    const tag = regionRuleTag(rule)
    if (tag) {
      addTag(tag)
      rules.push({ rule_set: tag, outbound })
    } else if (rule.type === 'ipcidr') {
      rules.push({ ip_cidr: [rule.value], outbound })
    } else if (rule.type === 'domainSuffix') {
      rules.push({ domain_suffix: [rule.value], outbound })
    } else {
      rules.push({ domain: [rule.value], outbound })
    }
  }

  const rule_set = [...rulesetTags].map((tag) => ({
    type: 'local', tag, format: 'binary', path: `${rulesetDir}/${tag}.srs`,
  }))

  const route = {
    auto_detect_interface: true,
    default_domain_resolver: 'dns-direct',
    rule_set,
    rules,
    final: region && region.catchAll === 'proxy' ? proxyTag : 'direct',
  }
  return { route, rulesetTags }
}
