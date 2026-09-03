// 共享网络的节点分享链接(服务端版,给订阅接口用;前端 helper/shareLink.ts 是同一套格式)
// 和订阅链接的访问令牌:HMAC(clash secret, id:凭据) 截 24 位十六进制。凭据一换令牌就变,
// 旧订阅链接自然失效;clash secret 每台机器不同,拿不到路由器就猜不出来。
import { createHmac, timingSafeEqual } from 'node:crypto'
import { TLS_SERVER_NAME } from './servers.mjs'

const hostPart = (address) => (address.includes(':') && !address.startsWith('[') ? `[${address}]` : address)

export const buildShareLink = (s) => {
  const address = String(s.address || '').trim()
  if (!address) return ''
  const host = hostPart(address)
  const name = encodeURIComponent(s.name || s.id)
  switch (s.protocol) {
    case 'shadowsocks':
      return `ss://${Buffer.from(`${s.method || ''}:${s.password || ''}`, 'utf8').toString('base64')}@${host}:${s.port}#${name}`
    case 'vless': {
      const q = s.tls
        ? `encryption=none&security=tls&sni=${TLS_SERVER_NAME}&allowInsecure=1&type=tcp`
        : 'encryption=none&security=none&type=tcp'
      return `vless://${s.uuid || ''}@${host}:${s.port}?${q}#${name}`
    }
    case 'tuic':
      return `tuic://${encodeURIComponent(s.uuid || '')}:${encodeURIComponent(s.password || '')}@${host}:${s.port}?congestion_control=bbr&alpn=h3&allow_insecure=1&sni=${TLS_SERVER_NAME}#${name}`
    case 'hysteria2': {
      const obfs = s.obfs ? `&obfs=salamander&obfs-password=${encodeURIComponent(s.obfs)}` : ''
      return `hysteria2://${encodeURIComponent(s.password || '')}@${host}:${s.port}/?insecure=1&sni=${TLS_SERVER_NAME}${obfs}#${name}`
    }
    default:
      return ''
  }
}

const credentialOf = (s) => `${s.password || ''}|${s.uuid || ''}`

export const shareTokenFor = (secret, s) =>
  createHmac('sha256', String(secret || 'open-box')).update(`${s.id}:${credentialOf(s)}`).digest('hex').slice(0, 24)

export const shareTokenMatches = (secret, s, token) => {
  const expected = Buffer.from(shareTokenFor(secret, s))
  const given = Buffer.from(String(token || ''))
  return expected.length === given.length && timingSafeEqual(expected, given)
}
