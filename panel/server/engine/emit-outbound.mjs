export const buildTransport = (t) => {
  if (!t || !t.type || t.type === 'tcp') return undefined
  const out = { type: t.type }
  if (t.path) out.path = t.path
  if (t.headers) out.headers = t.headers
  if (t.service_name) out.service_name = t.service_name
  return out
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
