// 把「订阅和节点站点直连」里的域名在部署时解析成 IP,一并写进直连规则的 ip_cidr。
//
// 直连规则按域名匹配,靠的是从流量里嗅出来的域名(TLS SNI / HTTP Host / QUIC);SSH、
// 游戏、各种按裸 IP 直连的客户端没有域名可嗅,规则匹配不上就落到兜底走了代理——正式路由器
// 实测:节点写的是 hk-node.angeworld.xyz,SSH 到它的 IP 却经香港节点转发。这里把域名此刻
// 的解析结果也写进去,裸 IP 连接也能命中。解析走的是路由器自己的 resolver(内核停着时是
// dnsmasq 的上游;跑着时经 dnsmasq → 内核),失败或超时一律跳过,不能让部署失败。
import dns from 'node:dns/promises'

const withTimeout = (p, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve([]), ms)
  p.then((v) => { clearTimeout(timer); resolve(v) }, () => { clearTimeout(timer); resolve([]) })
})

export const resolveHostsToCidrs = async (domains, { lookup = (h, o) => dns.lookup(h, o), timeoutMs = 3000 } = {}) => {
  const list = [...new Set((domains || []).map((d) => String(d || '').trim().toLowerCase()).filter(Boolean))]
  const results = await Promise.all(list.map((host) => withTimeout(Promise.resolve().then(() => lookup(host, { all: true })), timeoutMs)))
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
