import { customOutboundTag, customPolicyActive, customRuleTag, normalizeRouting, routeRulesetTags } from './routing-model.mjs'

// 一条策略的匹配条件 → 一条 sing-box 路由规则。
// 同一条规则里的多个字段是「或」的关系(sing-box 规则内部各字段取并集),所以一条策略
// 写了域名后缀又写了 IP 段时,任一命中即算这条策略命中——和用户在界面上的理解一致。
// 规则集链接是域名 / IP 两份 .srs,路由规则两份都引用(见 routing-model.mjs 的 routeRulesetTags)
const policyRule = (policy, ruleLists) => {
  const rule = {}
  const rulesets = routeRulesetTags(policy, ruleLists)
  if (rulesets.length) rule.rule_set = rulesets
  if (policy.domain.length) rule.domain = policy.domain
  if (policy.domainSuffix.length) rule.domain_suffix = policy.domainSuffix
  if (policy.domainKeyword.length) rule.domain_keyword = policy.domainKeyword
  if (policy.ipCidr.length) rule.ip_cidr = policy.ipCidr
  rule.outbound = policy.name
  return rule
}

// 前置自定义分流的一行 → 一条 sing-box 路由规则。一行只有一个条件,出口是这行自己选的。
// 规则集那几档要按 ruleLists 折算成域名 / IP 两份 .srs(和站点集同一套)。
const customRule = (rule, ruleLists, outbound) => {
  const tag = customRuleTag(rule)
  if (tag) {
    const tags = routeRulesetTags({ rulesets: [tag] }, ruleLists)
    return tags.length ? { rule_set: tags, outbound } : null
  }
  const field = {
    domain: 'domain', domainSuffix: 'domain_suffix',
    domainKeyword: 'domain_keyword', ipCidr: 'ip_cidr',
  }[rule.type]
  return field ? { [field]: [rule.value], outbound } : null
}

export const buildRoute = (routing, rulesetDir, options = {}) => {
  const conf = normalizeRouting(routing)
  const rulesetTags = new Set()
  const addTag = (tag) => { if (tag) rulesetTags.add(tag) }

  const dnsMode = options.dnsMode || 'hijack'
  // 出口必须是配置里真有的 outbound(内核 outbound not found 会起不来),前置自定义分流和
  // 终端分流都按这张表筛;规则集链接的形状表决定引用域名那份还是 IP 那份
  const known = options.knownOutbounds instanceof Set ? options.knownOutbounds : null
  const ruleLists = options.ruleLists || {}
  const rules = [{ action: 'sniff' }]
  // off:Open-Box 不劫持任何 DNS——不改写、不回交,局域网的 53 端口流量当普通 UDP 按规则走
  // (配合 config.mjs 里关掉 auto_redirect,它自带 nft 层的 DNS 劫持,关不掉)。但内核 DNS 入站
  // dns-in 仍开着,主动发到 <路由器 IP>:7853 的查询(AdGuard Home / Pi-hole 的上游)照常解析。
  // hijack 模式靠 {protocol:'dns'} 一并接住 dns-in 收到的查询(sniff 对 direct 入站同样生效)。
  if (dnsMode === 'hijack') {
    rules.push({ protocol: 'dns', action: 'hijack-dns' })
  } else if (dnsMode === 'off') {
    rules.push({ inbound: ['dns-in'], action: 'hijack-dns' })
  } else if (dnsMode === 'dnsmasq') {
    // dnsmasq 接管模式下不能全局劫持 DNS 协议流量:tun 里到 dns-in 的转发查询也会
    // 匹配 {protocol:'dns'},被劫持回同一个 dns-in 入站,形成自环导致解析超时。
    // 仅劫持 dns-in 自身收到的查询,其余 DNS 流量按普通路由走(交给 dnsmasq 上游)。
    rules.push({ inbound: ['dns-in'], action: 'hijack-dns' })
    // sing-box 开了 auto_redirect 时会自带一条 nft DNAT:局域网发给任何 53 端口的查询
    // (包括发给路由器自己 dnsmasq 的)统统改写到 tun 对端 172.19.0.2:53 送进 tun。
    // hijack 模式靠 {protocol:'dns'} 把它们接住;dnsmasq 模式只劫持 dns-in,这些查询会
    // 落到 ip_is_private → 直连 → 再拨 172.19.0.2 → 又进 tun,自环(真机上就是这么卡死的)。
    // 这里把它们交回本机 dnsmasq(override 到 127.0.0.1:53),dnsmasq 再按它的上游配置
    // 转给 dns-in,局域网客户端仍然走 dnsmasq 这一层(本地主机名、按域名分流都保留)。
    // 出站必须是绑定 lo 的专用直连(见 config.mjs):全局 auto_detect_interface 会把
    // 普通直连绑到 WAN 口,拨 127.0.0.1 不通。
    if (Array.isArray(options.tunCidrs) && options.tunCidrs.length && options.dnsmasqTag) {
      rules.push({
        ip_cidr: options.tunCidrs, port: [53], action: 'route',
        outbound: options.dnsmasqTag, override_address: '127.0.0.1',
      })
    }
  }
  // 防回环:目标是 tun 自己的网段(172.19.0.0/30 等)的连接直接拒绝。tun 的对端地址
  // 172.19.0.2 只是路由下一跳,没有任何合法流量会以它为目标;可一旦有(真机上出现过
  // 对 172.19.0.2:53 的 TCP DNS 查询),ip_is_private 会把它交给直连出站,直连再拨
  // 172.19.0.2 又会回到 tun,sing-box 自己喂自己,每一跳新开一个连接,几十秒就把
  // 句柄和内存吃光、整机卡死。必须排在 ip_is_private 前面。
  if (Array.isArray(options.tunCidrs) && options.tunCidrs.length) {
    rules.push({ ip_cidr: options.tunCidrs, action: 'reject' })
  }
  // 前置自定义分流:用户手写的强制通道,"不管别的规则怎么写,这些目标就走这个出口"。
  // 所以它排在所有规则最前面,只让上面那条 tun 防回环走在它前头——那条挡的是内核自己
  // 喂自己(真机上出现过几十秒把整机吃死),不是分流,不能被任何规则盖过。
  // 排在 ip_is_private 之前是有意的:否则"把某个内网段送到某个节点"(比如经 WireGuard
  // 访问对端局域网)永远写不出来,会被局域网直连那条先接走。
  // 一行一条规则、一行一个出口,按行的先后进配置(内核首条命中生效)。
  // 出口必须是配置里真有的 outbound,指向已删掉的节点的那一行跳过,其余行照常生效。
  const custom = conf.custom
  if (customPolicyActive(custom)) {
    const builtinTags = { direct: options.directTag || 'direct', block: options.blockTag || 'block' }
    for (const rule of custom.rules) {
      const target = customOutboundTag(rule, builtinTags)
      if (known && !known.has(target)) continue
      const emitted = customRule(rule, ruleLists, target)
      if (!emitted) continue
      for (const tag of emitted.rule_set || []) addTag(tag)
      rules.push(emitted)
    }
  }

  // 内置的直连出站可以改名,tag 从调用方传进来
  rules.push({ ip_is_private: true, outbound: options.directTag || 'direct' })

  // 订阅和节点站点直连(开关在后端设置):排在所有站点集之前,不受它们影响
  const dh = options.directHosts
  if (dh && ((dh.domains && dh.domains.length) || (dh.cidrs && dh.cidrs.length))) {
    const rule = { outbound: options.directTag || 'direct' }
    if (dh.domains && dh.domains.length) rule.domain = dh.domains
    if (dh.cidrs && dh.cidrs.length) rule.ip_cidr = dh.cidrs
    rules.push(rule)
  }

  // 终端分流:指定来源 IP / 网段的全部流量走某个出口,排在站点集之前(优先级高于按目标
  // 分流),但在前置自定义分流 / ip_is_private / 直连站点之后。
  // 出口必须是配置里真有的 outbound,否则内核 outbound not found 起不来,这种规则直接丢掉。
  for (const cr of Array.isArray(options.clientRoutes) ? options.clientRoutes : []) {
    if (!cr || !Array.isArray(cr.sources) || !cr.sources.length || !cr.outbound) continue
    if (known && !known.has(cr.outbound)) continue
    rules.push({ source_ip_cidr: cr.sources, outbound: cr.outbound })
  }

  if (conf.adBlock) {
    addTag(conf.adRuleset)
    rules.push({ rule_set: conf.adRuleset, action: 'reject' })
  }

  // 站点集按用户排的顺序逐条匹配,首条命中生效。
  for (const policy of conf.activePolicies) {
    for (const tag of routeRulesetTags(policy, ruleLists)) addTag(tag)
    rules.push(policyRule(policy, ruleLists))
  }

  // 上面都没命中的流量交给兜底站点集(它也是一个 selector,见 config.mjs);
  // 内核的 final 必须指向某个存在的出站,所以这条永远有。
  const rule_set = [...rulesetTags].map((tag) => ({
    type: 'local', tag, format: 'binary', path: `${rulesetDir}/${tag}.srs`,
  }))

  const route = {
    auto_detect_interface: true,
    default_domain_resolver: 'dns-direct',
    rule_set,
    rules,
    final: conf.fallback.name,
  }
  return { route, rulesetTags }
}
