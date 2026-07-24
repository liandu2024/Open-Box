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

  const { route } = buildRoute(profile.routing, profile.rulesetDir)
  const dns = buildDns(profile)

  const tunAddress = profile.ipv6 ? [TUN_V4, TUN_V6] : [TUN_V4]

  const config = {
    log: { level: 'warn' },
    dns,
    inbounds: [
      { type: 'tun', tag: 'tun-in', address: tunAddress, auto_route: true, strict_route: true, stack: 'mixed' },
    ],
    outbounds,
    route,
    experimental: {
      clash_api: { external_controller: '127.0.0.1:9095', secret: profile.clashApiSecret },
    },
  }
  if (endpoints.length) config.endpoints = endpoints
  return config
}
