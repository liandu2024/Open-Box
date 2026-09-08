// 「共享网络」服务器的分享链接和随机凭据。链接格式对齐主流客户端(SIP002 / v2rayN 系):
//   ss://base64(method:password)@host:port#name
//   vless://uuid@host:port?encryption=none&security=tls&sni=…&allowInsecure=1&type=tcp#name
//   tuic://uuid:password@host:port?congestion_control=bbr&alpn=h3&allow_insecure=1&sni=…#name
//   hysteria2://password@host:port/?insecure=1&sni=…[&obfs=salamander&obfs-password=…]#name
//   socks5://[user:pass@]host:port#name(mixed:同一个口也接 HTTP 代理)
// TLS 是自签的(server/system/tls-keypair.mjs),所以链接里都带上"允许不安全证书"。
import type { OpenboxServer } from '@/api/openbox'

export const TLS_SERVER_NAME = 'open-box.local'

const hostPart = (address: string) => (address.includes(':') && !address.startsWith('[') ? `[${address}]` : address)

export const buildShareLink = (s: OpenboxServer): string => {
  const address = (s.address || '').trim()
  if (!address) return ''
  const host = hostPart(address)
  const name = encodeURIComponent(s.name || s.id)
  switch (s.protocol) {
    case 'shadowsocks': {
      const userinfo = btoa(unescape(encodeURIComponent(`${s.method || ''}:${s.password || ''}`)))
      return `ss://${userinfo}@${host}:${s.port}#${name}`
    }
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
    case 'mixed': {
      const auth = s.username ? `${encodeURIComponent(s.username)}:${encodeURIComponent(s.password || '')}@` : ''
      return `socks5://${auth}${host}:${s.port}#${name}`
    }
    default:
      return ''
  }
}

// 不能用 crypto.randomUUID():它只在安全上下文(https / localhost)里有,面板通常是
// http://路由器IP 打开的,一调就抛错。getRandomValues 没这个限制,自己拼 v4。
export const randomUuid = () => {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// 16 字节随机数转成 URL 安全的 base64(去掉 =),够长、不含会让链接出问题的字符
export const randomPassword = (bytes = 16) => {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// SS 2022 的密钥必须是 32 字节 base64(带 =)
export const randomSs2022Key = () => {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return btoa(String.fromCharCode(...buf))
}

export const randomServerId = () => `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

// 默认取当前打开面板用的主机名
export const defaultHost = () => location.hostname
