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

export const buildTls = (tls) => {
  if (!tls || !tls.enabled) return undefined
  const out = { enabled: true }
  if (tls.server_name) out.server_name = tls.server_name
  if (Array.isArray(tls.alpn) && tls.alpn.length) out.alpn = tls.alpn
  if (tls.insecure) out.insecure = true
  if (tls.reality && tls.reality.enabled) {
    out.reality = { enabled: true }
    if (tls.reality.public_key) out.reality.public_key = tls.reality.public_key
    if (tls.reality.short_id !== undefined) out.reality.short_id = tls.reality.short_id
    // reality 硬约束:必须有 utls
    out.utls = tls.utls && tls.utls.enabled
      ? { enabled: true, fingerprint: tls.utls.fingerprint || 'chrome' }
      : { enabled: true, fingerprint: 'chrome' }
  } else if (tls.utls && tls.utls.enabled) {
    out.utls = { enabled: true, fingerprint: tls.utls.fingerprint || 'chrome' }
  }
  return out
}

const base = (node) => ({ tag: node.tag, server: node.server, server_port: node.server_port })
const withTransport = (o, f) => { const t = buildTransport(f.transport); if (t) o.transport = t; return o }
const withTls = (o, f) => { const t = buildTls(f.tls); if (t) o.tls = t; return o }

const EMITTERS = {
  shadowsocks: (n) => ({ type: 'shadowsocks', ...base(n), method: n.fields.method, password: n.fields.password }),
  vmess: (n) => withTls(withTransport({ type: 'vmess', ...base(n), uuid: n.fields.uuid, alter_id: n.fields.alter_id ?? 0, security: n.fields.security || 'auto' }, n.fields), n.fields),
  vless: (n) => {
    const o = { type: 'vless', ...base(n), uuid: n.fields.uuid }
    if (n.fields.flow) o.flow = n.fields.flow
    return withTls(withTransport(o, n.fields), n.fields)
  },
  trojan: (n) => withTls(withTransport({ type: 'trojan', ...base(n), password: n.fields.password }, n.fields), n.fields),
  anytls: (n) => withTls({ type: 'anytls', ...base(n), password: n.fields.password }, n.fields),
  hysteria2: (n) => {
    const o = withTls({ type: 'hysteria2', ...base(n), password: n.fields.password }, n.fields)
    if (n.fields.obfs) o.obfs = n.fields.obfs
    return o
  },
  tuic: (n) => {
    const o = { type: 'tuic', ...base(n), uuid: n.fields.uuid, password: n.fields.password }
    if (n.fields.congestion_control) o.congestion_control = n.fields.congestion_control
    return withTls(o, n.fields)
  },
}

export const emitOutbound = (node) => {
  if (node.type === 'wireguard') throw new Error('wireguard must be emitted as an endpoint (use emitEndpoint)')
  const emitter = EMITTERS[node.type]
  if (!emitter) throw new Error(`no outbound emitter for type: ${node.type}`)
  return emitter(node)
}
