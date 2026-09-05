// 「订阅和节点站点直连」:订阅链接的主机名、各节点的服务器地址,一律直连,不看站点集。
// 节点服务器本身如果被路由进代理,就是拿代理去连代理;订阅链接也经常和节点同域。
// 域名进 domain,IP 进 ip_cidr(/32、/128)。
const isIpv4 = (v) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v)
const isIpv6 = (v) => v.includes(':') && /^[0-9a-f:.]+$/i.test(v)

export const collectDirectHosts = (nodes = [], subscriptions = []) => {
  const domains = new Set()
  const cidrs = new Set()
  const add = (host) => {
    const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
    if (!h || h === 'localhost') return
    if (isIpv4(h)) cidrs.add(`${h}/32`)
    else if (isIpv6(h)) cidrs.add(`${h}/128`)
    else if (/^[a-z0-9.-]+$/.test(h) && h.includes('.')) domains.add(h)
  }
  for (const n of nodes) add(n && n.server)
  for (const s of subscriptions) {
    // 一条订阅可以有多个地址(urls);老记录只有 url
    const urls = s && Array.isArray(s.urls) && s.urls.length ? s.urls : [s && s.url]
    for (const raw of urls) {
      const url = typeof raw === 'string' ? raw.trim() : ''
      if (!url) continue
      try { add(new URL(url).hostname) } catch { /* 不是合法 URL 就跳过 */ }
    }
  }
  return { domains: [...domains], cidrs: [...cidrs] }
}
