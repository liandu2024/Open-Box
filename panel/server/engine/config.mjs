import { emitOutbound } from './emit-outbound.mjs'
import { emitEndpoint } from './emit-endpoint.mjs'
import { emitUserGroups } from './user-groups.mjs'
import { customOutboundTag, customPolicyActive, effectiveOutbound, nativeBypassPlan, normalizeRouting, policyClasses, policyOutboundOptions } from './routing-model.mjs'
import { buildRoute } from './routing.mjs'
import { buildServerInbounds } from './servers.mjs'
import { normalizeClientRoutes } from './client-routes.mjs'
import { buildDnsWithResolvers, dnsFakeIpEnabled, ipv6InTun, ipv6ProxyMode, FAKEIP_V6 } from './dns.mjs'
import { collectDirectHosts } from './direct-hosts.mjs'
import { cidrsOverlap, parseCidr, subtractCidrs } from '../system/local-subnets.mjs'
import { buildFilterConfig } from './dns-filter.mjs'

// 面板专用回环入站的端口(见下方 inbounds 注释)
export const PANEL_INBOUND_PORT = 7891
// 面板自己的回环 mixed 入站标签;连接表里这类连接的 metadata.type 是 `mixed/<标签>`(route-test 靠它认出探测连接)
export const PANEL_INBOUND_TAG = 'panel-in'

const TUN_V4 = '172.19.0.1/30'
const TUN_V6 = 'fdfe:dcba:9876::1/126'
// 上面两个地址所在的网段,给路由规则做防回环用(见 routing.mjs)
export const TUN_V4_NET = '172.19.0.0/30'
export const TUN_V6_NET = 'fdfe:dcba:9876::/126'
// tun 的对端地址(网段里的第二个地址):sing-box 1.14 起 tun 自己的 DNS 劫持(dns_mode)把 53 端口改写到这里,
// 和 1.13 隐含的做法同一个地址;显式写出来是为了关掉它顺带的「发到这个地址的连接自动交给 DNS 模块」
// (见下面 tunInbound.dns_address 处的说明)
const TUN_V4_PEER = '172.19.0.2'
const TUN_V6_PEER = 'fdfe:dcba:9876::2'

// 私网 / 链路本地 / 组播目标不进 TUN,由内核按普通路由转发——和 OpenClash 的 localnetwork
// 放行一致。否则局域网里发往任何私网地址(包括指向死网关的静态路由网段)的包都会进 sing-box,
// 按 ip_is_private 交给直连去拨:TCP 每条等 5 秒,UDP 会话默认挂 5 分钟。正式路由器实测:
// AnyDesk 打洞向 10.0.0.x 并发探测几千个地址,sing-box 攒下几万个会话,内核 slab 涨 270MB、
// 自身涨到 200MB,直接被 OOM 杀掉;OpenClash 下同样的包在内核里静默丢掉,毫无影响。
// 排除时要把路由器自己各接口所在的网段挖出来(options.localSubnets,部署时从 ip addr 读,见
// system/local-subnets.mjs):sing-box 生成的 nft 里排除表的 return 排在 DNS 劫持规则之前,
// 把路由器所在网段也排除的话,局域网发给路由器的 DNS 查询就进不了内核,劫持模式的分流解析就废了。
// tun 自己的网段(172.19.0.0/30 / fdfe:dcba:9876::/126)必须无条件挖出来:内核停着的时候(开机、
// 升级后首次启动)tun0 还不存在,从 ip addr 读不到它;若把它连同 172.16/12 一起排除,内核起来后
// 自己的 DNS 交换全部超时、什么都不通(v0.1.64 在开发路由器上升级后实测)。
const TUN_EXCLUDE_V4 = ['10.0.0.0/8', '100.64.0.0/10', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '224.0.0.0/4']
const TUN_EXCLUDE_V6 = ['fc00::/7', 'fe80::/10', 'ff00::/8']
// sing-tun 1.13.14 把排除表编成 nft 区间集合时(auto_redirect),每个区间写成 [起点, 终点+1);"一直到地址
// 空间末尾"的区间(ff00::/8 的末尾就是 ffff:…:ffff,v4 的 240.0.0.0/4 同理)终点+1 溢出,sing-tun 退回用
// 起点当终点键,和别的区间同在一个集合里就 EEXIST、auto_redirect 整个起不来(redirect_nftables_exprs.go
// nftablesCreateIPSet;开发路由器实测 fe80::/10 + ff00::/8 崩、去掉 ff00::/8 正常)。
// 处理办法不是砍掉半段组播(第四轮 T6:ff80::/9 含 RFC 7371 的 ffbx::/32 SSM 等合法范围),而是只把最后
// 一个地址(全 1,任何真实流量都不会以它为目标)从排除段里挖掉,让区间终点可编码;纯 tun 模式没有这个
// 编码问题,排除表原样
const END_OF_ADDRESS_SPACE = ['255.255.255.255/32', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128']
// UDP 会话空闲超时:sing-box 默认 5 分钟,Clash 系默认 60 秒。打洞 / 探测类的一次性 UDP 包
// 没必要挂 5 分钟,60 秒足够覆盖正常的 DNS / QUIC / 游戏心跳。
const TUN_UDP_TIMEOUT = '60s'
// 内核 DNS 入站端口(system/dns-takeover.mjs 的 SINGBOX_DNS_UPSTREAM 与之一致)
export const DNS_INBOUND_PORT = 7853
// dnsmasq 模式下把被 auto_redirect 改写进 tun 的局域网 DNS 交回本机 dnsmasq 用的专用出站
export const findDuplicateTag = (list) => {
  const seen = new Set()
  for (const o of list) {
    const tag = o && o.tag
    if (typeof tag !== 'string') continue
    if (seen.has(tag)) return tag
    seen.add(tag)
  }
  return null
}

// dnsmasq 分流模式专用的回送出站;init 脚本用这个 tag 判断"这份配置需要接管 dnsmasq"
export const DNSMASQ_OUTBOUND_TAG = 'dnsmasq'

// systemDns:路由器 WAN 下发的 DNS 上游(部署时从 resolv.conf.auto 读,见
// system/resolv.mjs)。只有 dnsmasq 接管模式用得上——那时不能让 sing-box 去问
// 系统解析器,会绕回 dnsmasq 形成死循环。预览/测试不传就回落到档案里填的那台。
// regionGroups 参数已经退役(以前按国家自动分的 urltest 组 + 一个 PROXY 聚合 selector,
// 那是节点组功能出现之前的东西);留着这个参数名只是让老调用方不报错。
export const buildConfig = ({ nodes, profile, userGroups, systemDns, localSubnets = [], directHostCidrs = [], subscriptions = [], ruleLists = {}, cacheFilePath = '/opt/open-box/data/cache.db', selections = {}, tlsCert = { certPath: '/opt/open-box/etc/certs/server.crt', keyPath: '/opt/open-box/etc/certs/server.key' }, nativeBypass, dnsFilter }) => {
  // 订阅和节点站点直连(默认开):见 engine/direct-hosts.mjs
  // directHostCidrs:部署时把节点域名解析出来的 IP(见 system/resolve-hosts.mjs),让按裸 IP
  // 直连节点服务器的客户端(SSH 等)也能命中直连规则;预览接口没有这份,只按域名匹配。
  const directHosts = profile.directForNodes === false
    ? null
    : (() => {
        const dh = collectDirectHosts(nodes, subscriptions)
        return { ...dh, cidrs: [...new Set([...dh.cidrs, ...(Array.isArray(directHostCidrs) ? directHostCidrs : [])])] }
      })()
  const wireguardNodes = nodes.filter((n) => n.type === 'wireguard')
  const outboundNodes = nodes.filter((n) => n.type !== 'wireguard')

  // 节点组只有用户自己建的这一种:emitUserGroups 已经保证了成员非空、无悬空引用、
  // 无环(sing-box check 只能挡住第一条,见 user-groups.mjs 的说明)。
  // 内置的直连/拒绝也从这里出(它们和节点组同在「节点管理」列表里,按那里的顺序)
  // 故障转移的内部子组也在 userGroupOutbounds 里(要进内核),但公开的出站清单(站点集出口候选、DNS 分类、
  // 旁路计划)只用 publicTags——内部子组不能漏进候选
  const { outbounds: userGroupOutbounds, builtin, publicTags } = emitUserGroups(userGroups || [], nodes, {
    testUrl: profile.testUrl,
  })

  // 每个站点集在内核里就是一个同名 selector,成员是「出站」页签里选中的那几类
  // (直连 / 各节点组 / 拒绝)。用户在代理页点选,和 Clash 的策略组用法一致——
  // 所以站点集本身不记节点,只记"能选哪些"。最后固定跟一个兜底的「其他」:
  // route.final 指向它,上面都没命中的流量走它。
  const routingConf = normalizeRouting(profile.routing)
  const groupTags = publicTags
  const policyMemberTags = policyOutboundOptions(routingConf.outboundOptions, groupTags, builtin)
  // default 必须是成员之一,否则内核启动时找不到。effectiveOutbound 负责把"不在成员
  // 表里"的情况(空值、已删掉的组、迁移留下的 'proxy' 占位)算成一个真实存在的成员。
  const asSelector = (tag, preferred) => ({
    type: 'selector',
    tag,
    outbounds: policyMemberTags,
    default: effectiveOutbound(preferred, policyMemberTags, builtin),
  })
  const policyOutbounds = [
    ...routingConf.activePolicies.map((p) => asSelector(p.name, p.default)),
    asSelector(routingConf.fallback.name, routingConf.fallback.default),
  ]
  const outbounds = [
    ...userGroupOutbounds,
    ...policyOutbounds,
    ...outboundNodes.map(emitOutbound),
  ]
  const endpoints = wireguardNodes.map(emitEndpoint)

  const dnsMode = (profile.dns && profile.dns.mode) || 'hijack'
  if (dnsMode === 'dnsmasq') {
    // 绑定 lo 才拨得通 127.0.0.1(auto_detect_interface 对写了 bind_interface 的出站不生效)
    outbounds.push({ type: 'direct', tag: DNSMASQ_OUTBOUND_TAG, bind_interface: 'lo' })
  }
  // 出站 / endpoint 的 tag 在内核里是同一个命名空间:节点组、站点集、节点、内置直连/拒绝、
  // dnsmasq 回送出站之间只要有一对同名,内核就 duplicate tag FATAL。API 层各自只查自己那份
  // 列表,这里是最后一道闸——报一句人能看懂的话,而不是让部署死在 check 上。
  const duplicateTag = findDuplicateTag([...outbounds, ...endpoints])
  if (duplicateTag) {
    throw new Error(`出站名称重复:「${duplicateTag}」——节点组、站点集、节点、内置直连/拒绝之间不能同名,请改名后再启动`)
  }
  // 终端分流(engine/client-routes.mjs);出口只认配置里真有的 outbound。
  // wireguard 是 endpoint 不是 outbound,但路由规则一样能指向它的 tag
  const clientRoutes = normalizeClientRoutes(profile.clientRoutes, { directTag: builtin.direct })
  const knownOutbounds = new Set([...outbounds, ...endpoints].map((o) => o.tag))
  // IPv6 分层 · 代理 v6 降为 IPv4:出口此刻落在代理线路(不是直连 / 拒绝;站点集按此刻的选择判,
  // 节点组 / 节点 / 隧道端点都算代理线路)的规则前面插 v6 拒绝(engine/routing.mjs)
  // 站点集(含兜底)此刻的出口类别:和 DNS 分类、入口旁路、选择同步共用同一张表(routing-model.policyClasses)
  const classes = policyClasses(profile.routing, policyMemberTags, builtin, selections)
  const rejectV6For = ipv6ProxyMode(profile) === 'ipv4'
    ? (tag) => {
        if (tag === builtin.direct || tag === builtin.block) return false
        if (Object.prototype.hasOwnProperty.call(classes, tag)) return classes[tag] === 'proxy'
        return true
      }
    : null
  // groupTags 传给 DNS:它要按"这个站点集默认走哪"决定用直连还是代理侧解析,
  // 而"默认走哪"在 default 为空时取决于成员表的第一项(见 effectiveOutbound)。
  // 预解析(engine/routing.mjs 的 preResolveRules)本轮不进正式配置:收尾验收复现了它的回归——兜底那条无条件
  // resolve 会先于排在 IP 规则前面的域名规则执行,直连解析器对只有节点认得的域名回 NXDOMAIN 时连接被终止。
  // 解析器映射先不交给路由(留待后续方案验证),以域名进内核的连接仍按"没有真实目标 IP"处理
  const filtering = buildFilterConfig(profile, dnsFilter)
  const { dns } = buildDnsWithResolvers(profile, { systemDns, groupTags, builtin, selections, directHosts, ruleLists, clientRoutes, knownOutbounds, filterRules: filtering.rules })
  // buildRoute 自己归一化档案;传已归一化的对象会丢掉 fallbackName 等原始字段,
  // 导致 route.final 又变成「其他」,与用户改名后的 selector 不一致(GitHub #46)。
  const { route } = buildRoute(profile.routing, profile.rulesetDir, {
    dnsMode, directTag: builtin.direct, blockTag: builtin.block, directHosts, rejectV6For,
    tunCidrs: ipv6InTun(profile) ? [TUN_V4_NET, TUN_V6_NET] : [TUN_V4_NET],
    dnsmasqTag: dnsMode === 'dnsmasq' ? DNSMASQ_OUTBOUND_TAG : '',
    clientRoutes,
    knownOutbounds,
    // 规则集链接各自有没有域名 / IP 那份 .srs(见 system/rule-lists.mjs)
    ruleLists,
  })
  if (filtering.sets.length) route.rule_set = [...(route.rule_set || []), ...filtering.sets]

  // IPv6「不进内核」模式(engine/dns.mjs 的 ipv6ProxyMode = bypass):tun 不给 v6 地址,auto_route 就不接管 v6,
  // 局域网的 v6 按系统路由直接从 WAN 出去;防火墙那条 v6 拦截只在 ipv6 关着时加(system/deploy.mjs)
  const v6InTun = ipv6InTun(profile)
  const tunAddress = v6InTun ? [TUN_V4, TUN_V6] : [TUN_V4]

  // auto_redirect 自带 nft 层的 DNS 劫持(局域网发往任何 53 端口的查询都改写进 tun),
  // 关不掉劫持只留 redirect;所以 DNS「禁用」模式只能把它一起关掉,流量靠 auto_route 进 tun。
  const autoRedirect = Boolean(profile.tun && profile.tun.autoRedirect && dnsMode !== 'off')
  // 本机接口网段只在「auto_redirect + 劫持模式」下才从排除表里挖出来:挖它是为了 nft 里 DNS 改写
  // 规则能碰到发给路由器的查询(劫持模式靠这个把局域网 DNS 拦进内核),而 nft 另有 local_address_set
  // 的 return 保证这些网段不进 tun。dnsmasq 转发模式不需要:局域网的查询本来就该直接到 dnsmasq,
  // 挖掉只会让每个查询先被改写进 tun、再由内核送回本机 dnsmasq 绕一圈(审核 A2);不挖,发给
  // 路由器的查询在入口就 return,根本不进内核。
  // 没有 auto_redirect 时只剩路由规则(strict_route),排除表就是唯一的"本机网段不进 tun"
  // 依据——挖掉之后路由器回给局域网的每个包都被路由进 tun 吞掉,LuCI / 面板 / DNS 全部失联,
  // 重启后内核自启立刻复现(v0.1.65–v0.1.70 的「禁用」模式,正式路由器和开发路由器都实测)。
  const holes = autoRedirect && dnsMode === 'hijack' ? [...localSubnets, TUN_V4_NET, TUN_V6_NET] : [TUN_V4_NET, TUN_V6_NET]
  // FakeIP 的 v6 占位段 fc00::/18 落在排除表的 fc00::/7 里,不挖出来的话走代理域名的 v6 连接在入口就被
  // 放走了(v4 的 198.18.0.0/15 不在排除表里,不用挖)
  const fakeIp = dnsFakeIpEnabled(profile)
  if (fakeIp && ipv6ProxyMode(profile) === 'node') holes.push(FAKEIP_V6)
  // 用户明确要送去节点的私网段(前置自定义分流的 ip_cidr 行,出口不是直连 / 拒绝)也要挖出来:
  // 不然 10.77.0.0/16 → 节点 这种规则被排除表的 10.0.0.0/8 在入口先放走,永远到不了那条规则
  // (审核 B5,经 WireGuard 访问对端局域网的典型写法)。和排除表有交集的都算——规则比排除段
  // 小(10.77/16 在 10/8 里)和规则比排除段大(10.0.0.0/7 盖住 10/8)是一回事(复审 R6b)。
  // 但本机接口网段、tun 自己的网段、回环、链路本地永远不能被挖走:纯 tun 模式下排除表是唯一的
  // "本机网段不进 tun"依据,10.0.0.0/8 → 节点 这种规则挖掉整个 10/8,路由器回给 10.0.0.x 局域网的
  // 包就全被吞进 tun、面板 / SSH / DNS 失联(复审 R6a)。所以从规则里先扣掉这些保护段,只挖剩下的
  const excludeBase = v6InTun ? [...TUN_EXCLUDE_V4, ...TUN_EXCLUDE_V6] : TUN_EXCLUDE_V4
  const protectedSubnets = [...localSubnets, TUN_V4_NET, TUN_V6_NET, '127.0.0.0/8', '169.254.0.0/16', '::1/128', 'fe80::/10']
  if (customPolicyActive(routingConf.custom)) {
    for (const rule of routingConf.custom.rules) {
      if (rule.type !== 'ipCidr' || !parseCidr(rule.value)) continue
      const target = customOutboundTag(rule, builtin)
      if (target === builtin.direct || target === builtin.block || !knownOutbounds.has(target)) continue
      if (!excludeBase.some((base) => cidrsOverlap(base, rule.value))) continue
      holes.push(...subtractCidrs([rule.value], protectedSubnets))
    }
  }
  const routeExclude = subtractCidrs(excludeBase, holes)
  const tunInbound = {
    type: 'tun', tag: 'tun-in', address: tunAddress,
    // 单栈 tun + strict_route 会在 nft / ip rule 层拒绝未接管的地址族。
    // bypass 要让原生 IPv6（含 DHCPv6、RA）继续按系统路由走;其余模式保留严格路由。
    auto_route: true, strict_route: ipv6ProxyMode(profile) !== 'bypass', stack: 'mixed',
    route_exclude_address: autoRedirect ? subtractCidrs(routeExclude, END_OF_ADDRESS_SPACE) : routeExclude,
    udp_timeout: TUN_UDP_TIMEOUT,
  }
  if (autoRedirect) tunInbound.auto_redirect = true
  // 「不进内核」的终端(engine/client-routes.mjs 的 bypass):按 MAC 在 nft 入口就排除,流量根本不进 tun——
  // sing-box 1.14 起的 exclude_mac_address,只在 auto_route + auto_redirect 下有效;纯 tun 兼容模式下这些
  // 终端按上面已经写成直连的路由规则走
  const bypassMacs = [...new Set(clientRoutes.filter((r) => r.bypass).flatMap((r) => r.macs || []))]
  if (autoRedirect && bypassMacs.length) tunInbound.exclude_mac_address = bypassMacs
  // sing-box 1.14 起 tun 自己管 DNS 接管(dns_mode,缺省 hijack):auto_redirect 下 nft 把 53 端口 DNAT 到 dns_address;
  // 没有 auto_redirect 时另加一条 ip rule 把发往直连网段的 53 端口流量强行送进 tun——后者是 1.13 没有的行为,
  // 不写这个字段就会悄悄多出来。所以:开着 auto_redirect 的劫持 / dnsmasq 模式明确写 hijack,DNAT 目标写死成
  // tun 对端(和 1.13 隐含的一样),这样改写后的查询照旧经路由规则处理——劫持模式由 {protocol:'dns'} 接住,
  // dnsmasq 模式由 engine/routing.mjs 那条 override 交回本机 dnsmasq;dns_address 不写的话 1.14 会把发到对端的
  // 连接直接交给 DNS 模块、越过路由规则,dnsmasq 那一层就被绕开了。「禁用」模式和没有 auto_redirect 的兜底路径
  // (system/deploy.mjs 在 nft 失败时关掉 auto_redirect 重生成)一律 disabled:1.13 在这两种情况下本来就什么都不劫持
  if (autoRedirect && dnsMode !== 'off') {
    tunInbound.dns_mode = 'hijack'
    tunInbound.dns_address = v6InTun ? [TUN_V4_PEER, TUN_V6_PEER] : [TUN_V4_PEER]
  } else {
    tunInbound.dns_mode = 'disabled'
  }
  // 第一层 · 入口原生旁路:此刻走直连的站点集里的 geoip 集合(geoip-cn 之类)编进
  // route_exclude_address_set——命中的目标在系统入口就旁路,不进内核。开 auto_redirect 时
  // 内核把它们写成 nft 集合;不开时等价于加进 route_exclude_address(1.11 起)。条件和
  // 原因见 routing-model.mjs 的 nativeBypassPlan;不满足时直连目标进内核由 direct 出站连(兼容路径)
  // 部署时会带一份已经做过 IP 集合重叠核对的结果(system/native-bypass.mjs);没带(预览 / 测试)就按纯函数
  // 的保守结论——待核对的集合一律不开
  const bypass = nativeBypass && typeof nativeBypass === 'object'
    ? nativeBypass
    : nativeBypassPlan(profile.routing, { members: policyMemberTags, builtin, selections, clientRoutes, fakeIp, dnsMode })
  if (bypass.enabled && bypass.sets.length) tunInbound.route_exclude_address_set = bypass.sets

  // 面板「真实路由」测试用的回环入站:面板进程经它发请求,请求才会真的走内核的分流
  // (路由器自身发出的流量不一定进 tun)。只听 127.0.0.1,外面碰不到。
  const inbounds = [tunInbound, { type: 'mixed', tag: PANEL_INBOUND_TAG, listen: '127.0.0.1', listen_port: PANEL_INBOUND_PORT }]
  // 内核 DNS 入站 :7853,三种模式都开、监听所有地址(防火墙只放行 LAN,见 system/firewall.mjs):
  // dnsmasq 模式下 dnsmasq 的上游指向它;局域网里的 AdGuard Home / Pi-hole 也可以把上游指向
  // <路由器 IP>:7853 用内核的分流解析——尤其是「禁用」模式,不劫持任何 DNS,但把入口留着。
  // 此前只在 dnsmasq 模式开、且只听 127.0.0.1,用户在禁用模式下把 AdGuard 上游指到 7853,
  // 整个局域网的 DNS 就死了(正式路由器实测)。
  // 开了 IPv6 就双栈监听(AdGuard 用路由器的 v6 地址当上游时才到得了);'::' 在 sing-box 里同时收 v4
  inbounds.push({ type: 'direct', tag: 'dns-in', listen: profile.ipv6 ? '::' : '0.0.0.0', listen_port: DNS_INBOUND_PORT })
  // 共享网络:用户在设置里开的服务器入站(engine/servers.mjs)
  inbounds.push(...buildServerInbounds(profile.servers, tlsCert))

  const config = {
    log: { level: 'warn' },
    dns,
    inbounds,
    outbounds,
    route,
    experimental: {
      clash_api: { external_controller: '127.0.0.1:9095', secret: profile.clashApiSecret },
      // 记住每个 selector 的选择:没有它,内核每次重启(包括面板里的「重启」)都会把站点集
      // 和手动组重置回配置里的默认项,用户在代理页选好的线路全部丢掉。文件放在 data/ 下,
      // 重新部署面板不会碰它。
      // FakeIP 开着时占位地址 ↔ 域名的映射也要落盘:重启后客户端缓存里的占位地址还能找回域名
      cache_file: { enabled: true, path: cacheFilePath, store_fakeip: dnsFakeIpEnabled(profile) },
    },
  }
  if (endpoints.length) config.endpoints = endpoints
  return config
}
