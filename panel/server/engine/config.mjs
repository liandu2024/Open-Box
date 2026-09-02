import { emitOutbound } from './emit-outbound.mjs'
import { emitEndpoint } from './emit-endpoint.mjs'
import { emitUserGroups } from './user-groups.mjs'
import { effectiveOutbound, normalizeRouting, policyOutboundOptions } from './routing-model.mjs'
import { buildRoute } from './routing.mjs'
import { buildDns } from './dns.mjs'

const TUN_V4 = '172.19.0.1/30'
const TUN_V6 = 'fdfe:dcba:9876::1/126'

// systemDns:路由器 WAN 下发的 DNS 上游(部署时从 resolv.conf.auto 读,见
// system/resolv.mjs)。只有 dnsmasq 接管模式用得上——那时不能让 sing-box 去问
// 系统解析器,会绕回 dnsmasq 形成死循环。预览/测试不传就回落到档案里填的那台。
// regionGroups 参数已经退役(以前按国家自动分的 urltest 组 + 一个 PROXY 聚合 selector,
// 那是节点组功能出现之前的东西);留着这个参数名只是让老调用方不报错。
export const buildConfig = ({ nodes, profile, userGroups, systemDns }) => {
  const wireguardNodes = nodes.filter((n) => n.type === 'wireguard')
  const outboundNodes = nodes.filter((n) => n.type !== 'wireguard')

  // 节点组只有用户自己建的这一种:emitUserGroups 已经保证了成员非空、无悬空引用、
  // 无环(sing-box check 只能挡住第一条,见 user-groups.mjs 的说明)。
  // 内置的直连/拒绝也从这里出(它们和节点组同在「节点管理」列表里,按那里的顺序)
  const { outbounds: userGroupOutbounds, builtin } = emitUserGroups(userGroups || [], nodes)

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
    ...routingConf.policies.map((p) => asSelector(p.name, p.default)),
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
  const { route } = buildRoute(sanitizedRouting, profile.rulesetDir, { dnsMode, directTag: builtin.direct })
  // groupTags 传给 DNS:它要按"这个站点集默认走哪"决定用直连还是代理侧解析,
  // 而"默认走哪"在 default 为空时取决于成员表的第一项(见 effectiveOutbound)。
  const dns = buildDns(profile, { systemDns, groupTags, builtin })

  const tunAddress = profile.ipv6 ? [TUN_V4, TUN_V6] : [TUN_V4]

  const tunInbound = {
    type: 'tun', tag: 'tun-in', address: tunAddress,
    auto_route: true, strict_route: true, stack: 'mixed',
  }
  if (profile.tun && profile.tun.autoRedirect) tunInbound.auto_redirect = true

  const inbounds = [tunInbound]
  if (dnsMode === 'dnsmasq') {
    inbounds.push({ type: 'direct', tag: 'dns-in', listen: '127.0.0.1', listen_port: 7853 })
  }

  const config = {
    log: { level: 'warn' },
    dns,
    inbounds,
    outbounds,
    route,
    experimental: {
      clash_api: { external_controller: '127.0.0.1:9095', secret: profile.clashApiSecret },
    },
  }
  if (endpoints.length) config.endpoints = endpoints
  return config
}
