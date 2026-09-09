import { customOutboundTag, customPolicyActive, customRuleTag, normalizeRouting, parsePortSpec, routeRulesetTags, splitRuleSetConditions } from './routing-model.mjs'

// 一条策略的匹配条件 → 一条 sing-box 路由规则。
// 同一条规则里的域名 / IP 字段是「或」的关系(sing-box 规则内部目标地址各字段取并集),所以一条策略
// 写了域名后缀又写了 IP 段时,任一命中即算这条策略命中——和用户在界面上的理解一致。
// 规则集例外:sing-box 1.14 起它和同一条里的域名 / IP 条件不再稳定地「或」,写进配置前要经
// routing-model.mjs 的 splitRuleSetConditions 拆成两条(见那里的说明)
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
  // 端口:TCP / UDP 都算,不限协议——放行 WireGuard 这种 UDP 也就是靠它
  if (rule.type === 'port') {
    const spec = parsePortSpec(rule.value)
    return spec ? { ...spec, outbound } : null
  }
  const field = {
    domain: 'domain', domainSuffix: 'domain_suffix',
    domainKeyword: 'domain_keyword', ipCidr: 'ip_cidr',
  }[rule.type]
  return field ? { [field]: [rule.value], outbound } : null
}

// 一条规则(前置自定义分流的一行 / 站点集)有没有按目标 IP 判的条件
const customRowNeedsIp = (rule, ruleLists) => {
  if (rule.type === 'ipCidr' || rule.type === 'geoip') return true
  const tag = customRuleTag(rule)
  if (!tag) return false
  const shape = ruleLists && ruleLists[tag]
  return !shape || Boolean(shape.ip)
}
const policyNeedsIp = (policy, ruleLists) => policy.ipCidr.length > 0 || routeRulesetTags(policy, ruleLists).some((tag) => /^geoip-/.test(tag) || tag.endsWith('-ip'))
const policyDomainMatch = (policy, ruleLists) => {
  const rule = policyRule(policy, ruleLists)
  delete rule.outbound
  // 只留域名类条件:IP 条件本来就按 IP 判,不需要预解析
  delete rule.ip_cidr
  if (rule.rule_set) {
    rule.rule_set = rule.rule_set.filter((tag) => !/^geoip-/.test(tag) && !tag.endsWith('-ip'))
    if (!rule.rule_set.length) delete rule.rule_set
  }
  return Object.keys(rule).length ? rule : null
}

// "需要真实目标 IP"的范围 → 预解析规则表(见 buildRoute 里的说明)。顺序是内核里的真实顺序:
// 前置自定义分流各行 → 终端分流 → 站点集 → 兜底
export const preResolveRules = (conf, ruleLists, resolvers, options = {}) => {
  const builtinTags = { direct: options.directTag || 'direct', block: options.blockTag || 'block' }
  const known = options.knownOutbounds instanceof Set ? options.knownOutbounds : null
  const out = []
  let ipSeen = false
  if (customPolicyActive(conf.custom)) {
    conf.custom.rules.forEach((rule, i) => {
      const target = customOutboundTag(rule, builtinTags)
      if (known && !known.has(target)) return
      if (customRowNeedsIp(rule, ruleLists)) { ipSeen = true; return }
      const server = resolvers.custom && resolvers.custom[i]
      if (!ipSeen || !server) return
      const row = customRule(rule, ruleLists, target)
      if (!row) return
      delete row.outbound
      out.push({ ...row, action: 'resolve', server })
    })
  }
  // 终端分流按来源判,本身不需要 IP;但它后面的站点集要看它前面有没有 IP 规则——顺序不变,这里只记录
  for (const cr of Array.isArray(resolvers.clients) ? resolvers.clients : []) {
    if (ipSeen && cr && cr.sources && cr.sources.length && cr.server) out.push({ source_ip_cidr: cr.sources, action: 'resolve', server: cr.server })
  }
  for (const policy of conf.activePolicies) {
    // 一条站点集自己的 IP 条件不算它自己域名条件的"前面的 IP 规则":同一条规则里域名 / IP 是"或",域名命中就够了
    const server = resolvers.policies && resolvers.policies[policy.name]
    if (ipSeen && server) {
      const match = policyDomainMatch(policy, ruleLists)
      if (match) for (const part of splitRuleSetConditions(match)) out.push({ ...part, action: 'resolve', server })
    }
    if (policyNeedsIp(policy, ruleLists)) ipSeen = true
  }
  // 兜底:前面有 IP 规则时,没命中任何域名规则的域名目标也先解析(否则它们在 IP 规则处同样没有真实 IP)
  if (ipSeen && resolvers.fallback) out.push({ action: 'resolve', server: resolvers.fallback })
  return out
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
  // IPv6 分层 · 代理 v6 降为 IPv4(engine/dns.mjs 的 ipv6ProxyMode):某条规则的出口此刻是代理线路时,
  // 先插一条同条件 + ip_version 6 的 reject——裸 v6 目标、终端自己解析出来的 v6 地址要走代理线路
  // 时明确失败,不能悄悄从 WAN 直出,也不影响直连出口的 v6(直连规则前面不插)。
  // rejectV6For(出口 tag) 由调用方按此刻的选择算(config.mjs)
  const rejectV6For = typeof options.rejectV6For === 'function' ? options.rejectV6For : null
  const pushRule = (rule) => {
    if (rejectV6For && rule.outbound && rejectV6For(rule.outbound)) {
      const match = { ...rule }
      delete match.outbound
      rules.push({ ...match, ip_version: 6, action: 'reject' })
    }
    rules.push(rule)
  }
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
  // 【本轮不启用】需要真实目标 IP 的范围(第五轮 任务 4):用户配置里按目标 IP 判的规则(前置自定义分流的 ip_cidr / geoip /
  // 规则集行,站点集的 ip_cidr / geoip / 规则集链接的 IP 那份)排在某条域名规则前面时,以域名进内核的连接
  // (面板回环 mixed、共享网络的 SOCKS5h / HTTP 代理、FakeIP 试验找回的域名)在这条 IP 规则那里没有真实 IP,
  // 会直接掠过它、落到后面的域名规则——和终端按 IP 连接的 tun 路径语义不一致。
  // 处理办法:在所有分流规则前面,给"排在第一条 IP 规则之后的域名规则"各插一条同条件的 resolve 动作,用
  // 这条规则自己的解析器(engine/dns.mjs 交出的映射:直连的用 dns-direct,走代理的用它自己 detour 的解析器)
  // 先把域名解析成真实 IP,再往下按原顺序判;没有这种前后关系时一条都不插。resolve 只对域名目标生效,
  // 按 IP 连进来的 tun 流量不受影响;解析走的是站点集自己的线路,和 DNS 规则一致,不是节点自己解析。
  // 收尾验收复现的回归:兜底那条无条件 resolve 排在所有分流规则前面,原本排在 IP 规则前面的域名规则也会先经
  // 它解析,直连解析器对只有节点认得的域名回 NXDOMAIN 时连接被终止(resolve 失败会结束连接)。所以正式生成
  // (engine/config.mjs)现在不传 resolvers,这段只在显式给了映射时生效,留给后续方案验证
  const resolvers = options.resolvers && typeof options.resolvers === 'object' ? options.resolvers : null
  const preResolve = resolvers ? preResolveRules(conf, ruleLists, resolvers, options) : []
  const preResolveAt = rules.length
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
      pushRule(emitted)
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
    pushRule({ source_ip_cidr: cr.sources, outbound: cr.outbound })
  }

  if (conf.adBlock) {
    addTag(conf.adRuleset)
    rules.push({ rule_set: conf.adRuleset, action: 'reject' })
  }

  // 站点集按用户排的顺序逐条匹配,首条命中生效。规则集 + 域名 / IP 的站点集拆成紧邻的两条(1.14 的规则集语义)
  for (const policy of conf.activePolicies) {
    for (const tag of routeRulesetTags(policy, ruleLists)) addTag(tag)
    for (const part of splitRuleSetConditions(policyRule(policy, ruleLists))) pushRule(part)
  }
  // 兜底此刻走代理:没命中的 v6 连接同样明确拒绝(final 写不了条件,单独一条)
  if (rejectV6For && rejectV6For(conf.fallback.name)) rules.push({ ip_version: 6, action: 'reject' })

  if (preResolve.length) rules.splice(preResolveAt, 0, ...preResolve)

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
