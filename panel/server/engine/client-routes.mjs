// 终端分流:按局域网来源 IP / 网段指定出口。档案里存 profile.clientRoutes,这里把它
// 整理成路由规则要的形状:只留启用的、来源合法的;裸 IP 补成 /32、/128 方便统一走
// source_ip_cidr。出口不存在的规则由 routing.mjs 按 knownOutbounds 丢掉(不然内核
// 会因为 outbound not found 起不来)。

import net from 'node:net'

// 地址合法性交给 node:net 判:以前的正则只看字符集,"1:2:3""12345::1""2001:db8:0:0:0:0:0:0:1"
// 这种都会被放过,到部署时 sing-box check 才拒(GitHub 审核 B6)。带 zone 的链路本地地址
// (fe80::1%eth0)不当普通网段:规则里写它没有意义,内核也不收。
const isIpv4 = (s) => net.isIPv4(s)
const isIpv6 = (s) => net.isIPv6(s) && !s.includes('%')
export const isIpLiteral = (s) => isIpv4(s) || isIpv6(s)

// 合法就返回规范化后的 CIDR,不合法返回空串
export const normalizeCidr = (raw) => {
  const s = String(raw || '').trim()
  if (!s) return ''
  const [addr, prefix, ...rest] = s.split('/')
  if (rest.length) return ''
  if (isIpv4(addr)) {
    if (prefix === undefined) return `${addr}/32`
    const n = Number(prefix)
    return /^\d+$/.test(prefix) && n >= 0 && n <= 32 ? `${addr}/${n}` : ''
  }
  if (isIpv6(addr)) {
    if (prefix === undefined) return `${addr}/128`
    const n = Number(prefix)
    return /^\d+$/.test(prefix) && n >= 0 && n <= 128 ? `${addr}/${n}` : ''
  }
  return ''
}

export const isIpOrCidr = (raw) => normalizeCidr(raw) !== ''

export const normalizeClientRoutes = (list) => {
  if (!Array.isArray(list)) return []
  const out = []
  for (const r of list) {
    if (!r || typeof r !== 'object' || r.enabled === false) continue
    const sources = (Array.isArray(r.sources) ? r.sources : []).map(normalizeCidr).filter(Boolean)
    const outbound = typeof r.outbound === 'string' ? r.outbound.trim() : ''
    if (!sources.length || !outbound) continue
    out.push({ id: String(r.id || ''), name: String(r.name || ''), sources, outbound })
  }
  return out
}
