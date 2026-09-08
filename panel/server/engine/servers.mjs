// 「共享网络」:在路由器上开几个入站(SS / VLESS / TUIC / Hysteria2 / SOCKS5+HTTP),别的设备
// 连上来就经过本机的分流规则上网。档案里存 profile.servers,这里把它们变成 sing-box 入站。
//
// TUIC、Hysteria2 必须 TLS,VLESS 可选;证书用 sing-box 自己签的(system/tls-keypair.mjs),
// 客户端要允许不安全证书。入站 tag 固定为 share-<id>,和 tun-in / panel-in / dns-in 不撞。
//
// mixed 是 SOCKS5 和 HTTP 代理共用一个端口(GitHub #5 / #7:局域网设备填代理地址就能用,
// 常用 7080),明文、可选用户名密码。它只给局域网用:不在 WAN 放行——一个没认证的明文代理
// 开到公网就是给全世界开的免费出口。

export const SERVER_PROTOCOLS = ['shadowsocks', 'vless', 'tuic', 'hysteria2', 'mixed']
export const SS_METHODS = ['aes-256-gcm', 'aes-128-gcm', 'chacha20-ietf-poly1305', '2022-blake3-aes-256-gcm']
export const TLS_SERVER_NAME = 'open-box.local'
// 面板、clash API、dns-in、面板回环入站占着的端口,不能拿来开服务器
export const RESERVED_PORTS = new Set([2026, 9095, 7853, 7891, 53, 22, 80, 443])

export const serverTag = (s) => `share-${s.id}`

export const serverNeedsTls = (s) => s.protocol === 'tuic' || s.protocol === 'hysteria2' || (s.protocol === 'vless' && s.tls === true)

// 防火墙要放行的协议:SS 同时有 TCP/UDP,VLESS / mixed 只有 TCP,TUIC/HY2 是 QUIC(UDP)
export const serverFirewallProto = (s) => {
  if (s.protocol === 'shadowsocks') return 'tcp udp'
  if (s.protocol === 'vless' || s.protocol === 'mixed') return 'tcp'
  return 'udp'
}

// 要不要在 WAN 放行:mixed 只给局域网用(见文件头)
export const serverWanExposed = (s) => s.protocol !== 'mixed'

export const enabledServers = (servers) => (Array.isArray(servers) ? servers.filter((s) => s && s.enabled !== false) : [])

export const buildServerInbounds = (servers, { certPath, keyPath } = {}) => {
  const tls = () => ({ enabled: true, server_name: TLS_SERVER_NAME, certificate_path: certPath, key_path: keyPath })
  return enabledServers(servers).map((s) => {
    const base = { tag: serverTag(s), listen: '::', listen_port: s.port }
    switch (s.protocol) {
      case 'shadowsocks':
        return { type: 'shadowsocks', ...base, method: s.method, password: s.password }
      case 'vless': {
        const inbound = { type: 'vless', ...base, users: [{ uuid: s.uuid }] }
        if (s.tls === true) inbound.tls = tls()
        return inbound
      }
      case 'tuic':
        return {
          type: 'tuic', ...base,
          users: [{ uuid: s.uuid, password: s.password }],
          congestion_control: 'bbr',
          tls: { ...tls(), alpn: ['h3'] },
        }
      case 'hysteria2': {
        const inbound = { type: 'hysteria2', ...base, users: [{ password: s.password }], tls: { ...tls(), alpn: ['h3'] } }
        if (s.obfs) inbound.obfs = { type: 'salamander', password: s.obfs }
        return inbound
      }
      case 'mixed': {
        // 没填用户名就是不认证(sing-box 的 users 留空即可)
        const inbound = { type: 'mixed', ...base }
        if (s.username) inbound.users = [{ username: s.username, password: s.password || '' }]
        return inbound
      }
      default:
        return null
    }
  }).filter(Boolean)
}

export const configNeedsTlsKeypair = (config) =>
  Array.isArray(config && config.inbounds) && config.inbounds.some((i) => i && i.tls && i.tls.certificate_path)
