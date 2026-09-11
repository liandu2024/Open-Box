import { normalizeRealityShortId, normalizeUtlsFingerprint, normalizeVlessFlow } from './node-fields.mjs'
// sing-box 1.13 各传输层的字段互不相同:ws 有 path/headers/early data,http 是 host 列表 +
// path,grpc 只有 service_name,httpupgrade 是单个 host + path。分享链接 / Clash 的字段
// 原样照搬(比如 grpc 带 path、http 带 headers.Host)会被内核以 unknown field 拒收,
// 一个节点就让整份配置过不了 check。这里按类型只输出合法字段;存库里的节点形状不变,
// 老记录也一并修正。不认识的类型(xhttp / kcp / splithttp 内核根本没有)按 tcp 处理,
// 解析层已经把这类节点跳过了,这里只是给老记录兜底不炸配置。
export const TRANSPORT_TYPES = new Set(['ws', 'http', 'grpc', 'httpupgrade', 'quic'])

const hostList = (v) => {
  if (v === undefined || v === null) return undefined
  const list = (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean)
  return list.length ? list : undefined
}
const headersWithoutHost = (headers) => {
  if (!headers || typeof headers !== 'object') return undefined
  const rest = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'host'))
  return Object.keys(rest).length ? rest : undefined
}
const hostFromHeaders = (headers) => (headers && typeof headers === 'object' ? headers.Host || headers.host : undefined)

export const buildTransport = (t) => {
  if (!t || !t.type || t.type === 'tcp') return undefined
  switch (t.type) {
    case 'ws': {
      const out = { type: 'ws' }
      let path = t.path ? String(t.path) : ''
      // v2rayN 把 early data 写在 path 的 query 里:/ws?ed=2048
      const ed = path.match(/^(.*?)\?ed=(\d+)$/)
      if (ed) {
        path = ed[1]
        out.max_early_data = Number(ed[2])
        out.early_data_header_name = 'Sec-WebSocket-Protocol'
      }
      if (path) out.path = path
      if (t.headers && typeof t.headers === 'object' && Object.keys(t.headers).length) out.headers = t.headers
      if (t.max_early_data) out.max_early_data = t.max_early_data
      if (t.early_data_header_name) out.early_data_header_name = t.early_data_header_name
      return out
    }
    case 'http': {
      const out = { type: 'http' }
      const host = hostList(t.host ?? hostFromHeaders(t.headers))
      if (host) out.host = host
      if (t.path) out.path = t.path
      if (t.method) out.method = t.method
      const headers = headersWithoutHost(t.headers)
      if (headers) out.headers = headers
      return out
    }
    case 'grpc': {
      const out = { type: 'grpc' }
      // v2rayN 的 vmess 把 serviceName 放在 path 里
      const name = t.service_name || t.path
      if (name) out.service_name = String(name).replace(/^\/+/, '')
      return out
    }
    case 'httpupgrade': {
      const out = { type: 'httpupgrade' }
      const host = t.host ?? hostFromHeaders(t.headers)
      if (host) out.host = Array.isArray(host) ? String(host[0]) : String(host)
      if (t.path) out.path = t.path
      const headers = headersWithoutHost(t.headers)
      if (headers) out.headers = headers
      return out
    }
    case 'quic':
      return { type: 'quic' }
    default:
      return undefined
  }
}

// options.quic:tuic / hysteria2 这类基于 QUIC 的出站。
// 它们的 TLS 握手在 QUIC 里做,内核不支持在这条路径上用 uTLS 指纹伪装,配置里写了就
// 每次拨号直接失败(实测正式路由器:"open connection: unsupported usage for uTLS",
// 而机场发的 tuic:// / hysteria2:// 链接普遍带 fp=chrome)。所以 QUIC 出站一律不写 utls。
// mihomo 是直接忽略这个字段,所以同样的订阅在 OpenClash 里能用、在这里全挂——差别就在这。
//
// insecure 恒开:节点服务器用自签、过期、或者干脆是别人家域名的证书是常态(实测有节点
// 发的是 www.tesla.com 的证书,而链接里写 sni=kami.im),而分享链接里带不带 insecure=1
// 全看机场心情。校验失败的表现是"这个节点就是连不上",用户无从判断。节点本身有密码 /
// UUID 认证,这里放宽的是"服务器证书归谁"这一层。REALITY 例外:它本来就不靠证书链,
// 而是用公钥验证,不需要也不该写 insecure。
export const buildTls = (tls, options = {}) => {
  if (!tls || !tls.enabled) return undefined
  const out = { enabled: true }
  if (tls.server_name) out.server_name = tls.server_name
  if (Array.isArray(tls.alpn) && tls.alpn.length) out.alpn = tls.alpn
  if (tls.reality && tls.reality.enabled) {
    out.reality = { enabled: true }
    if (tls.reality.public_key) out.reality.public_key = tls.reality.public_key
    // 库里存的老节点也可能带着 "null" 这种 short_id(GitHub #19),生成时再过一遍
    const sid = normalizeRealityShortId(tls.reality.short_id)
    if (sid !== undefined) out.reality.short_id = sid
    // reality 硬约束:必须有 utls
    out.utls = tls.utls && tls.utls.enabled
      ? { enabled: true, fingerprint: normalizeUtlsFingerprint(tls.utls.fingerprint) || 'chrome' }
      : { enabled: true, fingerprint: 'chrome' }
    return out
  }
  if (!options.quic && tls.utls && tls.utls.enabled) {
    out.utls = { enabled: true, fingerprint: normalizeUtlsFingerprint(tls.utls.fingerprint) || 'chrome' }
  }
  out.insecure = true
  return out
}

const base = (node) => ({ tag: node.tag, server: node.server, server_port: node.server_port })
const withTransport = (o, f) => { const t = buildTransport(f.transport); if (t) o.transport = t; return o }
const withTls = (o, f, options) => { const t = buildTls(f.tls, options); if (t) o.tls = t; return o }
const QUIC = { quic: true }

const EMITTERS = {
  shadowsocks: (n) => {
    const o = { type: 'shadowsocks', ...base(n), method: n.fields.method, password: n.fields.password }
    if (n.fields.plugin) {
      o.plugin = n.fields.plugin
      if (n.fields.plugin_opts) o.plugin_opts = n.fields.plugin_opts
    }
    return o
  },
  vmess: (n) => withTls(withTransport({ type: 'vmess', ...base(n), uuid: n.fields.uuid, alter_id: n.fields.alter_id ?? 0, security: n.fields.security || 'auto' }, n.fields), n.fields),
  vless: (n) => {
    const o = { type: 'vless', ...base(n), uuid: n.fields.uuid }
    // 老订阅存下来的 xtls-rprx-vision-udp443 这类 flow 内核不认(GitHub #23),生成时归一
    const flow = normalizeVlessFlow(n.fields.flow)
    if (flow) o.flow = flow
    return withTls(withTransport(o, n.fields), n.fields)
  },
  trojan: (n) => withTls(withTransport({ type: 'trojan', ...base(n), password: n.fields.password }, n.fields), n.fields),
  anytls: (n) => withTls({ type: 'anytls', ...base(n), password: n.fields.password }, n.fields),
  hysteria2: (n) => {
    const o = withTls({ type: 'hysteria2', ...base(n), password: n.fields.password }, n.fields, QUIC)
    if (n.fields.obfs) o.obfs = n.fields.obfs
    // sing-box 1.14 起 hysteria2 默认模仿 Chrome 的 QUIC 握手指纹;Chrome 不声明 Ed25519,服务端用 Ed25519 证书的
    // 握手会失败,官方给的开关是 disable_chrome_parrot。订阅里没有这个信息,节点自带这个字段(手写配置 / 导入的
    // sing-box 出站)时原样带过去,其余节点按内核默认
    if (n.fields.disable_chrome_parrot === true || n.fields.disableChromeParrot === true) o.disable_chrome_parrot = true
    return o
  },
  // socks 出站只有版本和账号密码:内核这一项没有 tls / transport 字段,多写就 unknown field。
  // version 缺省是 5,只有 socks4 / 4a 才写出来。
  socks: (n) => {
    const o = { type: 'socks', ...base(n) }
    if (n.fields.version && String(n.fields.version) !== '5') o.version = String(n.fields.version)
    if (n.fields.username) o.username = String(n.fields.username)
    if (n.fields.password) o.password = String(n.fields.password)
    return o
  },
  tuic: (n) => {
    const o = { type: 'tuic', ...base(n), uuid: n.fields.uuid, password: n.fields.password }
    if (n.fields.congestion_control) o.congestion_control = n.fields.congestion_control
    return withTls(o, n.fields, QUIC)
  },
}

export const emitOutbound = (node) => {
  if (node.type === 'wireguard') throw new Error('wireguard must be emitted as an endpoint (use emitEndpoint)')
  const emitter = EMITTERS[node.type]
  if (!emitter) throw new Error(`no outbound emitter for type: ${node.type}`)
  return emitter(node)
}
