// 把「订阅和节点站点直连」里的域名在部署时解析成 IP,一并写进直连规则的 ip_cidr。
//
// 直连规则按域名匹配,靠的是从流量里嗅出来的域名(TLS SNI / HTTP Host / QUIC);SSH、
// 游戏、各种按裸 IP 直连的客户端没有域名可嗅,规则匹配不上就落到兜底走了代理——正式路由器
// 实测:节点写的是 hk-node.angeworld.xyz,SSH 到它的 IP 却经香港节点转发。这里把域名此刻
// 的解析结果也写进去,裸 IP 连接也能命中。
//
// 解析直接问 WAN 下发的上游(servers,和内核自己直连解析用的是同一批),不走路由器的系统
// resolver:内核刚被停掉时 dnsmasq 的上游已还原成路由器原来的那台(可能是局域网里一台挂了的
// AdGuard),经它解析全部超时,正式路由器上实测 45 个域名只解出 8 个。没有上游时才退回系统
// resolver。失败或超时一律跳过,不能让部署失败。
import dns from 'node:dns/promises'
import net from 'node:net'

// 直接向指定上游查 A / AAAA(node:dns 的 Resolver 不经 /etc/resolv.conf)
const makeUpstreamLookup = (servers) => {
  const resolver = new dns.Resolver()
  resolver.setServers(servers)
  return async (host) => {
    const [v4, v6] = await Promise.all([
      resolver.resolve4(host).catch(() => []),
      resolver.resolve6(host).catch(() => []),
    ])
    return [...v4.map((a) => ({ address: a, family: 4 })), ...v6.map((a) => ({ address: a, family: 6 }))]
  }
}

const withTimeout = (p, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve([]), ms)
  p.then((v) => { clearTimeout(timer); resolve(v) }, () => { clearTimeout(timer); resolve([]) })
})

export const resolveHostsToCidrs = async (domains, { servers = [], lookup, timeoutMs = 3000 } = {}) => {
  const list = [...new Set((domains || []).map((d) => String(d || '').trim().toLowerCase()).filter(Boolean))]
  // 只认真正的 IP:resolv.conf 里的 fe80::1%wan6 这类带 zone 的地址会让 setServers 同步抛错
  const upstreams = (Array.isArray(servers) ? servers : []).filter((s) => typeof s === 'string' && net.isIP(s) !== 0)
  let doLookup = lookup
  if (!doLookup && upstreams.length) {
    try {
      doLookup = makeUpstreamLookup(upstreams)
    } catch {
      // 上游列表有问题也不能让部署失败:退回系统 resolver
      doLookup = null
    }
  }
  if (!doLookup) doLookup = (h, o) => dns.lookup(h, o)
  const results = await Promise.all(list.map((host) => withTimeout(Promise.resolve().then(() => doLookup(host, { all: true })), timeoutMs)))
  const cidrs = new Set()
  for (const answers of results) {
    for (const a of Array.isArray(answers) ? answers : []) {
      const address = a && typeof a === 'object' ? a.address : a
      if (typeof address !== 'string' || !address) continue
      if (a.family === 6 || address.includes(':')) cidrs.add(`${address}/128`)
      else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) cidrs.add(`${address}/32`)
    }
  }
  return [...cidrs]
}
