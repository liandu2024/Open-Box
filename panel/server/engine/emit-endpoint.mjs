// Clash/mihomo 的 wireguard 写的是裸 IP(ip: 172.16.0.2),sing-box 的 address 是带前缀的
// netip.Prefix,缺前缀直接 FATAL。单机地址就是 /32、/128。
const withPrefix = (a) => {
  const s = String(a).trim()
  if (!s || s.includes('/')) return s
  return s.includes(':') ? `${s}/128` : `${s}/32`
}

export const emitEndpoint = (node) => {
  if (node.type !== 'wireguard') throw new Error(`emitEndpoint only supports wireguard, got: ${node.type}`)
  const f = node.fields
  const peer = {
    address: node.server,
    port: node.server_port,
    public_key: f.peer_public_key,
    allowed_ips: ['0.0.0.0/0', '::/0'],
  }
  if (f.pre_shared_key) peer.pre_shared_key = f.pre_shared_key
  return {
    type: 'wireguard',
    tag: node.tag,
    system: false,
    address: (Array.isArray(f.local_address) ? f.local_address : []).map(withPrefix),
    private_key: f.private_key,
    peers: [peer],
  }
}
