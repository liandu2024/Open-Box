import { emitOutbound } from './emit-outbound.mjs'
import { emitEndpoint } from './emit-endpoint.mjs'
import { emitGroupOutbounds } from './emit-groups.mjs'
import { buildRoute } from './routing.mjs'
import { buildDns } from './dns.mjs'

const TUN_V4 = '172.19.0.1/30'
const TUN_V6 = 'fdfe:dcba:9876::1/126'

export const buildConfig = ({ nodes, regionGroups, profile }) => {
  const proxyTag = profile.routing.proxyTag || 'PROXY'
  const wireguardNodes = nodes.filter((n) => n.type === 'wireguard')
  const outboundNodes = nodes.filter((n) => n.type !== 'wireguard')

  const outbounds = [
    { type: 'direct', tag: 'direct' },
    ...emitGroupOutbounds(regionGroups, { proxyTag }),
    ...outboundNodes.map(emitOutbound),
  ]
  const endpoints = wireguardNodes.map(emitEndpoint)

  // 合法出站 tag 集合:仅这些 tag 在生成的 outbounds/endpoints 里真实存在。
  // categories[].target / fallback 若引用集合外的 tag,sing-box check 不会报错,
  // 但会在启动时 FATAL(default outbound not found)或让该规则每连接失败,
  // 故此处净化 routing 副本,把悬空引用重映射到 proxyTag(其 PROXY selector 恒被生成)。
  const validTags = new Set([
    'direct',
    proxyTag,
    ...regionGroups.map((g) => g.name),
    ...outboundNodes.map((n) => n.tag),
    ...wireguardNodes.map((n) => n.tag),
  ])
  const sanitizedRouting = {
    ...profile.routing,
    categories: (profile.routing.categories || []).map((cat) => (
      validTags.has(cat.target) ? cat : { ...cat, target: proxyTag }
    )),
    fallback: (profile.routing.fallback && !validTags.has(profile.routing.fallback))
      ? proxyTag
      : profile.routing.fallback,
  }

  const dnsMode = (profile.dns && profile.dns.mode) || 'hijack'
  const { route } = buildRoute(sanitizedRouting, profile.rulesetDir, { dnsMode })
  const dns = buildDns(profile)

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
