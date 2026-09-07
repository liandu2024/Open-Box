import { DEFAULT_BUILTIN, customOutboundTag, customPolicyActive, dnsRulesetTags, normalizeRouting, policyOutboundOptions, policyGoesDirect } from './routing-model.mjs'

const extractHost = (url) => {
  // "https://1.1.1.1/dns-query" -> "1.1.1.1";裸 host 原样返回
  try {
    if (/^[a-z]+:\/\//i.test(url)) return new URL(url).hostname
  } catch { /* fall through */ }
  return url
}

// 直连侧的 DNS。要求是"交回系统默认,不经过 Open-Box 的代理",但两种接管模式下
// 直连侧解析器:三种模式都不再用 sing-box 的 local(系统解析器 → dnsmasq → dnsmasq 的上游)。
// 路由器 dnsmasq 的上游是局域网里的 AdGuard / Pi-hole 时,它们的查询会再次被劫持进
// sing-box,形成 sing-box → dnsmasq → AdGuard → sing-box 的死循环(正式路由器上实测,
// 直连域名全部超时);dnsmasq 转发模式下 dnsmasq 的上游更是 sing-box 自己。所以一律拿
// WAN 下发的上游 IP(部署时从 resolv.conf.auto 读,见 system/resolv.mjs)经直连出站去查,
// 读不到才退回档案里填的那台。
// 不写 detour:不写就是走默认出站,而默认出站正是 direct。显式写 detour:'direct'
// 会被内核在**启动时**拒绝——"detour to an empty direct outbound makes no sense",
// 而 `sing-box check` 不查这一条,所以校验过了、一跑就 FATAL(真机上就是这样死循环的)。
const directServerFor = (profile, options) => {
  const systemDns = Array.isArray(options.systemDns) ? options.systemDns.filter(Boolean) : []
  const server = systemDns[0] || (profile.dns && profile.dns.direct) || '223.5.5.5'
  return { type: 'udp', tag: 'dns-direct', server }
}

// 代理侧的解析器:明文 DNS over TCP,detour 到某条代理线路。
// 用 TCP 而不是 DoH:这台服务器的查询整段都封在代理隧道里,出了节点才是明文——路上没人
// 看得见,再套一层 TLS 只是每次查询多一次握手。DoH 还有两处实打实的坏处:一是节点到
// DoH 站点这一段偶尔被对端拒(实测 1.12.12.12 经香港节点 EOF、经美国节点正常),二是
// 用域名形态的 DoH 地址会引出"解析 DoH 域名"的自举问题。TCP 而不是 UDP:UDP 经代理常被
// 截断/丢包,TCP 的可靠性正好抵掉它多出来的那次握手。端口不写就是 53。
const proxyServerFor = (server, tag, detour) => ({ type: 'tcp', tag, server, detour })

// 劫持模式下局域网的查询根本到不了 dnsmasq,而本地主机名(DHCP 租约名、/etc/hosts、
// *.lan)只有 dnsmasq 认得:这类名字交给 local(→ 路由器自己的 dnsmasq),其余一律不走
// local。dnsmasq 转发模式不需要:客户端本来就先经过 dnsmasq。禁用模式 sing-box 不答 DNS。
const LOCAL_SUFFIXES = ['.lan', '.local', '.home', '.internal', '.home.arpa']
const localNameRules = (dnsMode) => (dnsMode === 'hijack'
  ? [{ domain_suffix: LOCAL_SUFFIXES, server: 'dns-local' }, { domain_regex: ['^[^.]+$'], server: 'dns-local' }]
  : [])
const localServer = { type: 'local', tag: 'dns-local' }

// 策略的域名类条件 → 一条 DNS 规则。ip_cidr 不进来:DNS 查询阶段还没有 IP,
// 拿它当条件永远不会命中,写进去只会让人以为生效了。
// 规则集同理,只收纯域名的那些(geosite-*、规则集链接的域名那份):含 IP 的规则集进了 DNS 规则
// 不是"不命中",而是更糟的"每个域名都先按这条查一遍再扔掉"——见 routing-model.mjs 的 dnsRulesetTags。
const policyDnsRule = (policy, server, ruleLists) => {
  const rule = { server }
  const rulesets = dnsRulesetTags(policy, ruleLists)
  if (rulesets.length) rule.rule_set = rulesets
  if (policy.domain.length) rule.domain = policy.domain
  if (policy.domainSuffix.length) rule.domain_suffix = policy.domainSuffix
  if (policy.domainKeyword.length) rule.domain_keyword = policy.domainKeyword
  return rule
}

const hasDomainCondition = (p, ruleLists) =>
  dnsRulesetTags(p, ruleLists).length > 0 || p.domain.length > 0 || p.domainSuffix.length > 0 || p.domainKeyword.length > 0

export const buildDns = (profile, options = {}) => {
  const strategy = profile.ipv6 ? 'prefer_ipv4' : 'ipv4_only'
  const dnsMode = (profile.dns && profile.dns.mode) || 'hijack'
  const directServer = directServerFor(profile, options)
  const localRules = localNameRules(dnsMode)
  const localServers = localRules.length ? [localServer] : []

  // reverse_mapping:内核记住"这个 IP 是哪个域名解析出来的",客户端随后按 IP 去连时把域名
  // 找回来再匹配规则。没有它,SSH / 游戏这类嗅不出域名的连接永远命中不了域名规则(比如
  // 「订阅和节点站点直连」),全落到兜底走代理。
  if (!profile.dns.split) {
    const only = { servers: [directServer, ...localServers], final: 'dns-direct', strategy, reverse_mapping: true }
    if (localRules.length) only.rules = localRules
    return only
  }

  const conf = normalizeRouting(profile.routing)
  const proxyHost = extractHost(profile.dns.proxy)
  // 代理侧的解析 detour 到兜底站点集「其他」:上面没被任何站点集挑走的域名,走哪条线路
  // 就用哪条线路解析,和各站点集各自 detour 到自己的 selector 是同一个道理。
  const servers = [directServer, proxyServerFor(proxyHost, 'dns-proxy', conf.fallback.name)]

  // 本地主机名最前(劫持模式才有),然后是订阅和节点站点直连:它们的域名也用直连侧解析
  const rules = [...localRules]
  const dh = options.directHosts
  if (dh && dh.domains && dh.domains.length) {
    rules.push({ domain: dh.domains, server: 'dns-direct' })
  }
  if (conf.adBlock) {
    rules.push({ rule_set: conf.adRuleset, action: 'reject' })
  }

  // 每个站点集的域名怎么解析,看它此刻实际走哪:
  //   · 走直连 → dns-direct(本地/直连解析,国内站点才拿得到就近的 CDN 地址)
  //   · 走代理 → 一台专属的 TCP 解析器,detour 指向同名 selector,解析和流量同一条路
  // "此刻走哪"优先用内核里当前的选择(options.selections:生成配置时从跑着的内核读
  // 出来的各 selector 的 now,顺着 now 一路下钻到叶子),内核没在跑时才退回档案里的默认。
  // 这一判断只在生成配置时做一次,之后就定死在 dns.rules 里了:代理页把某个站点集从
  // 直连改成代理(或反过来),这份规则就过期了。所以每次部署都把这张"谁走直连、谁走代理"
  // 的表落进 config.meta.json(见 system/deploy.mjs),代理页一改动就比对一次,真的翻面
  // 了才在后台重新生成配置(见 index.mjs)——用户不用自己去点重启。
  // 反过来,在代理线路之间换(香港 → 美国)不影响这张表:代理侧的解析器 detour 的是站点集
  // 自己的 selector,换线路它跟着换,不用重新生成。
  const builtin = options.builtin || DEFAULT_BUILTIN
  const members = policyOutboundOptions(conf.outboundOptions, options.groupTags || [], builtin)
  const selections = options.selections && typeof options.selections === 'object' ? options.selections : {}
  const goesDirect = (name, fallbackDefault) => policyGoesDirect(name, fallbackDefault, members, builtin, selections)
  // 规则集链接的形状表(哪些有域名那份),部署时从 rule-lists.json 得来;没有就按老样子引用
  const ruleLists = options.ruleLists && typeof options.ruleLists === 'object' ? options.ruleLists : {}
  // 前置自定义分流的解析跟着它的固定出口走:出口定死了,不随代理页的点选变化,所以
  // 这里直接按出口判——走代理时 detour 到出口本身(节点或节点组都行),让解析和流量同一条路。
  // 少了这段,被强制送到某个节点的域名仍会在本地解析,拿到的是本地就近的 CDN 地址。
  const custom = conf.custom
  if (customPolicyActive(custom) && hasDomainCondition(custom, ruleLists)) {
    const target = customOutboundTag(custom, builtin)
    if (target === builtin.direct || target === builtin.block) {
      rules.push(policyDnsRule(custom, 'dns-direct', ruleLists))
    } else {
      servers.push(proxyServerFor(proxyHost, 'dns-custom', target))
      rules.push(policyDnsRule(custom, 'dns-custom', ruleLists))
    }
  }

  conf.activePolicies.forEach((policy, index) => {
    if (!hasDomainCondition(policy, ruleLists)) return
    if (goesDirect(policy.name, policy.default)) {
      rules.push(policyDnsRule(policy, 'dns-direct', ruleLists))
      return
    }
    const tag = `dns-policy-${index}`
    servers.push(proxyServerFor(proxyHost, tag, policy.name))
    rules.push(policyDnsRule(policy, tag, ruleLists))
  })

  servers.push(...localServers)
  return {
    servers,
    rules,
    // 兜底:上面都没命中的域名,按兜底站点集此刻走哪来定用哪边解析
    final: goesDirect(conf.fallback.name, conf.fallback.default) ? 'dns-direct' : 'dns-proxy',
    strategy,
    reverse_mapping: true,
  }
}

// 这次生成把每个站点集(以及兜底)判成了"直连解析"还是"代理解析"。落进 config.meta.json,
// 下次代理页有人改出口时拿它比对:同一个名字两边不一样,说明磁盘上那份 dns.rules 已经
// 过期,要重新生成配置(见 api/deploy-runner.mjs 的 dnsClassesFlipped)。
// 只收有域名条件的站点集:只按 IP 分流的那些本来就不进 DNS 规则,改它不会让规则过期。
// 规则集链接这里一律当作有域名那份(不传形状表):写表和比对的两边都这么算,才不会因为
// 一边知道形状、一边不知道而误判"翻面"。多算一个站点集只是多比对一次,没有代价。
export const dnsPolicyClasses = (routing, members = ['direct'], builtin = DEFAULT_BUILTIN, selections = {}) => {
  const conf = normalizeRouting(routing)
  const klass = (name, def) => (policyGoesDirect(name, def, members, builtin, selections) ? 'direct' : 'proxy')
  const out = {}
  for (const p of conf.activePolicies) {
    if (!hasDomainCondition(p, {})) continue
    out[p.name] = klass(p.name, p.default)
  }
  out[conf.fallback.name] = klass(conf.fallback.name, conf.fallback.default)
  return out
}
