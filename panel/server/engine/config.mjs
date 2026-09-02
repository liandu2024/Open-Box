import { emitOutbound } from './emit-outbound.mjs'
import { emitEndpoint } from './emit-endpoint.mjs'
import { emitGroupOutbounds } from './emit-groups.mjs'
import { emitUserGroups } from './user-groups.mjs'
import { REJECT_TAG, normalizeRouting, policyOutboundOptions } from './routing-model.mjs'
import { buildRoute } from './routing.mjs'
import { buildDns } from './dns.mjs'

const TUN_V4 = '172.19.0.1/30'
const TUN_V6 = 'fdfe:dcba:9876::1/126'

// systemDns:路由器 WAN 下发的 DNS 上游(部署时从 resolv.conf.auto 读,见
// system/resolv.mjs)。只有 dnsmasq 接管模式用得上——那时不能让 sing-box 去问
// 系统解析器,会绕回 dnsmasq 形成死循环。预览/测试不传就回落到档案里填的那台。
export const buildConfig = ({ nodes, regionGroups, profile, userGroups, systemDns }) => {
  const proxyTag = profile.routing.proxyTag || 'PROXY'
  const wireguardNodes = nodes.filter((n) => n.type === 'wireguard')
  const outboundNodes = nodes.filter((n) => n.type !== 'wireguard')

  // 用户自定义节点组排在自动生成的地区组之后:emitUserGroups 已经保证了成员非空、
  // 无悬空引用、无环(sing-box check 只能挡住第一条,见 user-groups.mjs 的说明)。
  // proxyTag 传下去是给"一个节点都没命中"的组当占位成员用的:那种组照样写进配置,
  // 等订阅刷出节点自动接管(理由见 user-groups.mjs)。
  const { outbounds: userGroupOutbounds } = emitUserGroups(userGroups || [], nodes, { proxyTag })

  // 每条策略在内核里就是一个同名 selector,成员是「出站」页签里选中的那几类
  // (直连 / 各节点组 / 拒绝)。用户在代理页点选,和 Clash 的策略组用法一致——
  // 所以策略本身不记节点,只记"能选哪些"。
  const routingConf = normalizeRouting(profile.routing)
  const groupTags = [...regionGroups.map((g) => g.name), ...userGroupOutbounds.map((g) => g.tag)]
  const policyMemberTags = policyOutboundOptions(routingConf.outboundOptions, groupTags)
  const policyOutbounds = routingConf.policies.map((policy) => {
    const out = { type: 'selector', tag: policy.name, outbounds: policyMemberTags }
    // default 必须是成员之一,否则内核启动时找不到;不合法就让它自然落到第一个成员
    if (policy.default && policyMemberTags.includes(policy.default)) out.default = policy.default
    return out
  })
  // 「拒绝」只在真被用到时才生成:没有策略能选它的话,配置里多一个用不上的出站
  const needsReject = policyMemberTags.includes(REJECT_TAG)

  const outbounds = [
    { type: 'direct', tag: 'direct' },
    ...(needsReject ? [{ type: 'block', tag: REJECT_TAG }] : []),
    ...emitGroupOutbounds(regionGroups, { proxyTag }),
    ...userGroupOutbounds,
    ...policyOutbounds,
    ...outboundNodes.map(emitOutbound),
  ]
  const endpoints = wireguardNodes.map(emitEndpoint)

  // 策略的规则指向的是策略自己的 selector(上面刚生成),所以路由这边不再需要
  // "悬空目标重映射"那套——真正可能悬空的是 selector 的 default,已经在生成时挡掉了。
  const sanitizedRouting = routingConf

  const dnsMode = (profile.dns && profile.dns.mode) || 'hijack'
  const { route } = buildRoute(sanitizedRouting, profile.rulesetDir, { dnsMode })
  const dns = buildDns(profile, { systemDns })

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
