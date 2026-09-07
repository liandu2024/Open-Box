import { emitOutbound } from './emit-outbound.mjs'
import { emitEndpoint } from './emit-endpoint.mjs'
import { emitUserGroups } from './user-groups.mjs'
import { effectiveOutbound, normalizeRouting, policyOutboundOptions } from './routing-model.mjs'
import { buildRoute } from './routing.mjs'
import { buildServerInbounds } from './servers.mjs'
import { normalizeClientRoutes } from './client-routes.mjs'
import { buildDns } from './dns.mjs'
import { collectDirectHosts } from './direct-hosts.mjs'
import { subtractCidrs } from '../system/local-subnets.mjs'

// 面板专用回环入站的端口(见下方 inbounds 注释)
export const PANEL_INBOUND_PORT = 7891
// 面板自己的回环 mixed 入站标签;连接表里这类连接的 metadata.type 是 `mixed/<标签>`(route-test 靠它认出探测连接)
export const PANEL_INBOUND_TAG = 'panel-in'

const TUN_V4 = '172.19.0.1/30'
const TUN_V6 = 'fdfe:dcba:9876::1/126'
// 上面两个地址所在的网段,给路由规则做防回环用(见 routing.mjs)
const TUN_V4_NET = '172.19.0.0/30'
const TUN_V6_NET = 'fdfe:dcba:9876::/126'

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
export const buildConfig = ({ nodes, profile, userGroups, systemDns, localSubnets = [], directHostCidrs = [], subscriptions = [], ruleLists = {}, cacheFilePath = '/opt/open-box/data/cache.db', selections = {}, tlsCert = { certPath: '/opt/open-box/etc/certs/server.crt', keyPath: '/opt/open-box/etc/certs/server.key' } }) => {
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
  const { outbounds: userGroupOutbounds, builtin } = emitUserGroups(userGroups || [], nodes, {
    testUrl: profile.testUrl,
  })

  // 每个站点集在内核里就是一个同名 selector,成员是「出站」页签里选中的那几类
  // (直连 / 各节点组 / 拒绝)。用户在代理页点选,和 Clash 的策略组用法一致——
  // 所以站点集本身不记节点,只记"能选哪些"。最后固定跟一个兜底的「其他」:
  // route.final 指向它,上面都没命中的流量走它。
  const routingConf = normalizeRouting(profile.routing)
  const groupTags = userGroupOutbounds.map((g) => g.tag)
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

  // 策略的规则指向的是策略自己的 selector(上面刚生成),所以路由这边不再需要
  // "悬空目标重映射"那套——真正可能悬空的是 selector 的 default,已经在生成时挡掉了。
  const sanitizedRouting = routingConf

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
  const { route } = buildRoute(sanitizedRouting, profile.rulesetDir, {
    dnsMode, directTag: builtin.direct, blockTag: builtin.block, directHosts,
    tunCidrs: profile.ipv6 ? [TUN_V4_NET, TUN_V6_NET] : [TUN_V4_NET],
    dnsmasqTag: dnsMode === 'dnsmasq' ? DNSMASQ_OUTBOUND_TAG : '',
    // 终端分流(engine/client-routes.mjs);出口只认配置里真有的 outbound
    clientRoutes: normalizeClientRoutes(profile.clientRoutes),
    // wireguard 是 endpoint 不是 outbound,但路由规则一样能指向它的 tag
    knownOutbounds: new Set([...outbounds, ...endpoints].map((o) => o.tag)),
    // 规则集链接各自有没有域名 / IP 那份 .srs(见 system/rule-lists.mjs)
    ruleLists,
  })
  // groupTags 传给 DNS:它要按"这个站点集默认走哪"决定用直连还是代理侧解析,
  // 而"默认走哪"在 default 为空时取决于成员表的第一项(见 effectiveOutbound)。
  const dns = buildDns(profile, { systemDns, groupTags, builtin, selections, directHosts, ruleLists })

  const tunAddress = profile.ipv6 ? [TUN_V4, TUN_V6] : [TUN_V4]

  // auto_redirect 自带 nft 层的 DNS 劫持(局域网发往任何 53 端口的查询都改写进 tun),
  // 关不掉劫持只留 redirect;所以 DNS「禁用」模式只能把它一起关掉,流量靠 auto_route 进 tun。
  const autoRedirect = Boolean(profile.tun && profile.tun.autoRedirect && dnsMode !== 'off')
  // 本机接口网段只在 auto_redirect 开着时才从排除表里挖出来:挖它是为了 nft 里 DNS 改写规则
  // 能碰到发给路由器的查询,而 nft 另有 local_address_set 的 return 保证这些网段不进 tun。
  // 没有 auto_redirect 时只剩路由规则(strict_route),排除表就是唯一的"本机网段不进 tun"
  // 依据——挖掉之后路由器回给局域网的每个包都被路由进 tun 吞掉,LuCI / 面板 / DNS 全部失联,
  // 重启后内核自启立刻复现(v0.1.65–v0.1.70 的「禁用」模式,正式路由器和开发路由器都实测)。
  const holes = autoRedirect ? [...localSubnets, TUN_V4_NET, TUN_V6_NET] : [TUN_V4_NET, TUN_V6_NET]
  const tunInbound = {
    type: 'tun', tag: 'tun-in', address: tunAddress,
    auto_route: true, strict_route: true, stack: 'mixed',
    route_exclude_address: subtractCidrs(profile.ipv6 ? [...TUN_EXCLUDE_V4, ...TUN_EXCLUDE_V6] : TUN_EXCLUDE_V4, holes),
    udp_timeout: TUN_UDP_TIMEOUT,
  }
  if (autoRedirect) tunInbound.auto_redirect = true

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
      cache_file: { enabled: true, path: cacheFilePath, store_fakeip: false },
    },
  }
  if (endpoints.length) config.endpoints = endpoints
  return config
}
