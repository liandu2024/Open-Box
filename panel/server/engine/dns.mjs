import { DEFAULT_BUILTIN, customOutboundTag, customPolicyActive, customRuleTag, dnsRulesetTags, normalizeRouting, policyOutboundOptions, policyGoesDirect, splitRuleSetConditions } from './routing-model.mjs'
import { normalizeDnsRewrite, rewriteDnsRules, rewriteDnsServer } from './dns-rewrite.mjs'

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

// 仅代理域名 FakeIP(原型,档案开关 dns.fakeIpForProxy):走代理的域名 A / AAAA 查询由内核返回
// 占位地址,真实解析完全不在本地发生——连接进内核时按占位地址找回域名,把域名交给选中的节点,
// 由节点那头解析并连接。于是 (1) 代理域名的解析和连接天然在同一个实际节点上(不再是"DNS detour
// 到组、连接又落到组里另一个叶子");(2) 客户端拿到的是占位地址,永远不会落进 geoip-cn 这种
// 直连集合,入口旁路就不会被"域名规则解析出来的 IP"误放行。直连域名照旧真实解析。
// 占位段用 sing-box 默认:198.18.0.0/15(RFC 2544 保留段)、fc00::/18。
export const FAKEIP_V4 = '198.18.0.0/15'
export const FAKEIP_V6 = 'fc00::/18'
export const FAKEIP_TAG = 'dns-fakeip'
export const dnsFakeIpEnabled = (profile) => Boolean(profile && profile.dns && profile.dns.split !== false && profile.dns.fakeIpForProxy === true)

// IPv6 分层(第三轮 阶段 5):
//   off    —— 档案 ipv6 关着:老语义原样保留,DNS 只解析 A、tun 不给 v6、防火墙 REJECT 局域网→WAN 的 v6
//   node   —— ipv6 开着、走代理的 v6 目标和 v4 一样交给节点(老"开启"语义)
//   ipv4   —— ipv6 开着,但代理线路不管 v6:走代理的域名不给 AAAA(终端自然用 v4 连),裸 v6 目标要走
//             代理时在内核里明确拒绝(engine/routing.mjs),不悄悄从 WAN 直出;直连的 v6 照常解析、照常走
//   bypass —— ipv6 开着,v6 流量根本不进内核(tun 不给 v6 地址、不劫 v6 路由、防火墙不拦),按系统路由
//             直接从 WAN 出去——和 OpenClash / DAE 默认行为一样(GitHub #36:用户要的就是 test-ipv6 能过);
//             DNS 照常给 AAAA,走代理的域名终端会先试 v6 直连、不通再退回 v4 走代理
export const ipv6ProxyMode = (profile) => (!profile || !profile.ipv6 ? 'off' : profile.ipv6Proxy === 'ipv4' ? 'ipv4' : profile.ipv6Proxy === 'bypass' ? 'bypass' : 'node')
// v6 要不要进 tun:开着 ipv6 且不是「不进内核」
export const ipv6InTun = (profile) => Boolean(profile && profile.ipv6) && ipv6ProxyMode(profile) !== 'bypass'

// 前置自定义分流的一行 → 一条 DNS 规则的匹配部分。只按 IP 分流的行(ip_cidr / geoip /
// 只编出 IP 那份的规则集链接)不进 DNS:解析的时候还没有 IP,拿什么都匹配不上。
// 端口同理:DNS 查询里没有目标端口。
const customDnsMatch = (rule, ruleLists) => {
  if (rule.type === 'ipCidr' || rule.type === 'geoip' || rule.type === 'port') return null
  const tag = customRuleTag(rule)
  if (tag) {
    const tags = dnsRulesetTags({ rulesets: [tag] }, ruleLists)
    return tags.length ? { rule_set: tags } : null
  }
  const field = { domain: 'domain', domainSuffix: 'domain_suffix', domainKeyword: 'domain_keyword' }[rule.type]
  return field ? { [field]: [rule.value] } : null
}

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
  const rule = server ? { server } : {}
  const rulesets = dnsRulesetTags(policy, ruleLists)
  if (rulesets.length) rule.rule_set = rulesets
  if (policy.domain.length) rule.domain = policy.domain
  if (policy.domainSuffix.length) rule.domain_suffix = policy.domainSuffix
  if (policy.domainKeyword.length) rule.domain_keyword = policy.domainKeyword
  return rule
}

const hasDomainCondition = (p, ruleLists) =>
  dnsRulesetTags(p, ruleLists).length > 0 || p.domain.length > 0 || p.domainSuffix.length > 0 || p.domainKeyword.length > 0

export const buildDns = (profile, options = {}) => buildDnsWithResolvers(profile, options).dns

// 生成 DNS 配置,同时交出"谁用哪台解析器"的映射:站点集名 → 解析器 tag、前置自定义分流每一行 → 解析器 tag
// (拒绝行 / 纯 IP 行为 null)、指定终端的来源 → 解析器 tag、兜底 → 解析器 tag。engine/routing.mjs 按它给
// 路由规则加"先解析再判 IP 规则"的 resolve 动作(第五轮 任务 4)
export const buildDnsWithResolvers = (profile, options = {}) => {
  const strategy = profile.ipv6 ? 'prefer_ipv4' : 'ipv4_only'
  const dnsMode = (profile.dns && profile.dns.mode) || 'hijack'
  const directServer = directServerFor(profile, options)
  const localRules = localNameRules(dnsMode)
  const localServers = localRules.length ? [localServer] : []

  // reverse_mapping:内核记住"这个 IP 是哪个域名解析出来的",客户端随后按 IP 去连时把域名
  // 找回来再匹配规则。没有它,SSH / 游戏这类嗅不出域名的连接永远命中不了域名规则(比如
  // 「订阅和节点站点直连」),全落到兜底走代理。
  const resolvers = { policies: {}, custom: [], clients: [], fallback: 'dns-direct' }
  // DNS 重写(engine/dns-rewrite.mjs):命中源域名的查询交给面板进程在 127.0.0.1:7854 上开的重写服务,排在所有
  // 规则最前面——先定命中哪条重写,再谈别的
  const rewriteRules = rewriteDnsRules(normalizeDnsRewrite(profile.dns).rules)
  const filterRules = options.filterRules || []
  const rewriteServers = rewriteRules.length ? [rewriteDnsServer()] : []
  if (!profile.dns.split) {
    const only = { servers: [directServer, ...rewriteServers, ...localServers], final: 'dns-direct', strategy, reverse_mapping: true }
    if (rewriteRules.length || localRules.length || filterRules.length) only.rules = [...rewriteRules, ...localRules, ...filterRules]
    return { dns: only, resolvers }
  }

  const conf = normalizeRouting(profile.routing)
  const proxyHost = extractHost(profile.dns.proxy)
  // 代理侧的解析 detour 到兜底站点集「其他」:上面没被任何站点集挑走的域名,走哪条线路
  // 就用哪条线路解析,和各站点集各自 detour 到自己的 selector 是同一个道理。
  const servers = [directServer, ...rewriteServers, proxyServerFor(proxyHost, 'dns-proxy', conf.fallback.name)]

  // 规则顺序和连接侧(routing.mjs)对齐:DNS 重写 → 本地主机名 → 前置自定义分流 → 订阅 / 节点站点直连 →
  // 终端分流 → 广告拦截 → 站点集 → 兜底。以前直连站点和广告拦截排在前置自定义分流前面,
  // 用户明确放行的域名会先被广告规则拒掉(审核 B4)。
  const rules = [...rewriteRules, ...localRules, ...filterRules]

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
  // 前置自定义分流的解析跟着每一行自己的出口走:出口是设置里定死的,不随代理页的点选变化。
  // 少了这段,被强制送到某个节点的域名仍会在本地解析,拿到的是本地就近的 CDN 地址。
  // 每个用到的代理出口开一台解析器,同一个出口的多行共用一台。
  // 走代理的匹配:开了 FakeIP 就先给 A / AAAA 一条占位地址规则,其它查询类型(HTTPS / TXT …)仍走
  // 代理侧真实解析器
  const fakeIp = dnsFakeIpEnabled(profile)
  // 代理 v6 降为 IPv4:走代理的匹配 AAAA 直接回空(NOERROR、没有记录),终端就不会拿着 v6 地址去连代理线路。
  // 以前写在规则动作上的 strategy: ipv4_only 在 sing-box 1.14 里是遗留写法,和同一份 DNS 配置里的 query_type
  // (FakeIP 那条、兜底那条)不能共存、启动直接 FATAL(migration:ip_version and query_type behavior changes);
  // 改成 predefined 动作明确回空答案,语义和原来一样、和 1.13 也兼容(predefined 1.12 起就有)
  const proxyV4Only = ipv6ProxyMode(profile) === 'ipv4'
  // FakeIP 的占位只在「代理也管 v6」(交给节点)时连 AAAA 一起给;降级时 AAAA 已经回空,不进内核(bypass)时
  // 占位服务器没有 v6 段,AAAA 落到它上面只会回空——要让 AAAA 继续交给真实解析器(复核 F2)
  const fakeIpTypes = ipv6ProxyMode(profile) === 'node' ? ['A', 'AAAA'] : ['A']
  const emptyAAAA = (match) => ({ ...match, query_type: ['AAAA'], action: 'predefined', rcode: 'NOERROR' })
  // 规则集 + 域名的匹配拆成两条(1.14 的规则集语义,见 routing-model.mjs 的 splitRuleSetConditions),每一半各带
  // 同一套 AAAA / FakeIP / 真实解析器规则
  const pushProxyRule = (match, tag) => {
    for (const part of splitRuleSetConditions(match)) {
      if (proxyV4Only) rules.push(emptyAAAA(part))
      if (fakeIp) rules.push({ ...part, query_type: fakeIpTypes, server: FAKEIP_TAG })
      rules.push({ ...part, server: tag })
    }
  }
  const custom = conf.custom
  if (customPolicyActive(custom)) {
    const serverByTarget = new Map()
    for (const rule of custom.rules) {
      const match = customDnsMatch(rule, ruleLists)
      if (!match) { resolvers.custom.push(null); continue }
      const target = customOutboundTag(rule, builtin)
      if (target === builtin.direct) {
        rules.push({ ...match, server: 'dns-direct' })
        resolvers.custom.push('dns-direct')
        continue
      }
      // 出口是拒绝的行:解析也拒,和连接侧一致(明确拒绝不能变成"先解析再说")
      if (target === builtin.block) {
        rules.push({ ...match, action: 'reject' })
        resolvers.custom.push(null)
        continue
      }
      let tag = serverByTarget.get(target)
      if (!tag) {
        tag = `dns-custom-${serverByTarget.size}`
        serverByTarget.set(target, tag)
        servers.push(proxyServerFor(proxyHost, tag, target))
      }
      pushProxyRule(match, tag)
      resolvers.custom.push(tag)
    }
  }

  // 订阅和节点站点直连:它们的域名也用直连侧解析
  const dh = options.directHosts
  if (dh && dh.domains && dh.domains.length) {
    rules.push({ domain: dh.domains, server: 'dns-direct' })
  }

  // 终端分流:指定来源的终端,解析也跟着它的出口走。只有劫持模式内核才看得到终端的来源地址
  // (dnsmasq 转发模式下查询是 dnsmasq 转来的,来源一律是本机,写了也永远不命中——审核 B3),
  // 所以只在劫持模式生成。各解析器的缓存本来就要分开(同一域名两台终端会互相拿到对方出口的答案):
  // sing-box 1.14 起缓存一律按解析器分,以前为此写的 independent_cache 已弃用,不再生成
  if (dnsMode === 'hijack') {
    const serverByTarget = new Map()
    for (const cr of Array.isArray(options.clientRoutes) ? options.clientRoutes : []) {
      if (!cr || !Array.isArray(cr.sources) || !cr.sources.length || !cr.outbound) continue
      if (cr.outbound === builtin.block) {
        rules.push({ source_ip_cidr: cr.sources, action: 'reject' })
        continue
      }
      if (cr.outbound === builtin.direct) {
        rules.push({ source_ip_cidr: cr.sources, server: 'dns-direct' })
        resolvers.clients.push({ sources: cr.sources, server: 'dns-direct' })
        continue
      }
      if (options.knownOutbounds instanceof Set && !options.knownOutbounds.has(cr.outbound)) continue
      let tag = serverByTarget.get(cr.outbound)
      if (!tag) {
        tag = `dns-client-${serverByTarget.size}`
        serverByTarget.set(cr.outbound, tag)
        servers.push(proxyServerFor(proxyHost, tag, cr.outbound))
      }
      pushProxyRule({ source_ip_cidr: cr.sources }, tag)
      resolvers.clients.push({ sources: cr.sources, server: tag })
    }
  }

  if (conf.adBlock) {
    rules.push({ rule_set: conf.adRuleset, action: 'reject' })
  }

  conf.activePolicies.forEach((policy, index) => {
    if (!hasDomainCondition(policy, ruleLists)) return
    if (goesDirect(policy.name, policy.default)) {
      rules.push(...splitRuleSetConditions(policyDnsRule(policy, 'dns-direct', ruleLists)))
      resolvers.policies[policy.name] = 'dns-direct'
      return
    }
    const tag = `dns-policy-${index}`
    servers.push(proxyServerFor(proxyHost, tag, policy.name))
    pushProxyRule(policyDnsRule(policy, '', ruleLists), tag)
    resolvers.policies[policy.name] = tag
  })

  const fallbackDirect = goesDirect(conf.fallback.name, conf.fallback.default)
  resolvers.fallback = fallbackDirect ? 'dns-direct' : 'dns-proxy'
  // 兜底走代理 + 代理 v6 降为 IPv4:没命中的域名 AAAA 也回空(final 本身带不了条件,单独一条排在最后;
  // 要在 FakeIP 兜底那条前面,不然 AAAA 先被占位服务器接走)
  if (!fallbackDirect && proxyV4Only) rules.push(emptyAAAA({}))
  if (fakeIp) {
    // v6 占位段只在"代理也管 v6"时给;降为 IPv4 时 AAAA 已经在上面回空了,占位只管 A
    // v6 占位段只在「代理也管 v6」(交给节点)时给;降级和不进内核都不给——不进内核时终端拿到占位 v6 会直接
    // 往 WAN 发,哪都到不了
    servers.push({ type: 'fakeip', tag: FAKEIP_TAG, inet4_range: FAKEIP_V4, ...(ipv6ProxyMode(profile) === 'node' ? { inet6_range: FAKEIP_V6 } : {}) })
    // 兜底走代理:上面都没命中的域名 A(交给节点时连 AAAA)也发占位地址
    if (!fallbackDirect) rules.push({ query_type: fakeIpTypes, server: FAKEIP_TAG })
  }
  servers.push(...localServers)
  const dns = {
    servers,
    rules,
    // 兜底:上面都没命中的域名,按兜底站点集此刻走哪来定用哪边解析
    final: fallbackDirect ? 'dns-direct' : 'dns-proxy',
    strategy,
    reverse_mapping: true,
  }
  return { dns, resolvers }
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
