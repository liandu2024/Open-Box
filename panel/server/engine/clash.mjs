import YAML from 'yaml'
import { createNode } from './node-model.mjs'

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

const buildClashTransport = (p) => {
  let net = p.network
  if (!net || net === 'tcp') return undefined
  if (net === 'h2') net = 'http'
  const transport = { type: net }
  if (net === 'ws') {
    const opts = p['ws-opts'] || {}
    if (opts.path) transport.path = opts.path
    if (opts.headers && opts.headers.Host) transport.headers = { Host: opts.headers.Host }
  } else if (net === 'grpc') {
    const opts = p['grpc-opts'] || {}
    if (opts['grpc-service-name']) transport.service_name = opts['grpc-service-name']
  } else if (net === 'http') {
    const opts = p['h2-opts'] || p['http-opts'] || {}
    if (opts.path) transport.path = Array.isArray(opts.path) ? opts.path[0] : opts.path
    const host = opts.host
    if (host) transport.headers = { Host: Array.isArray(host) ? host[0] : host }
  }
  return transport
}

const buildClashTls = (p) => {
  if (!p.tls && !p.sni && !p.servername && !p['reality-opts']) return undefined
  const tls = { enabled: p.tls === true || !!p['reality-opts'] }
  const sni = p.servername || p.sni
  if (sni) tls.server_name = sni
  if (p.alpn) tls.alpn = toArray(p.alpn)
  if (p['skip-cert-verify'] === true) tls.insecure = true
  if (p['client-fingerprint']) tls.utls = { enabled: true, fingerprint: p['client-fingerprint'] }
  if (p['reality-opts']) {
    const ro = p['reality-opts']
    tls.reality = { enabled: true }
    if (ro['public-key']) tls.reality.public_key = ro['public-key']
    if (ro['short-id'] !== undefined) tls.reality.short_id = String(ro['short-id'])
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: 'chrome' }
  }
  if (!tls.enabled) return undefined
  return tls
}

const MAPPERS = {
  ss: (p) => {
    if (p.plugin) throw new Error('ss plugin unsupported')
    return { type: 'shadowsocks', fields: { method: p.cipher, password: p.password } }
  },
  vmess: (p) => ({
    type: 'vmess',
    fields: {
      uuid: p.uuid, alter_id: Number.parseInt(p.alterId ?? 0, 10) || 0, security: p.cipher || 'auto',
      ...(buildClashTransport(p) ? { transport: buildClashTransport(p) } : {}),
      ...(buildClashTls(p) ? { tls: buildClashTls(p) } : {}),
    },
  }),
  vless: (p) => ({
    type: 'vless',
    fields: {
      uuid: p.uuid, ...(p.flow ? { flow: p.flow } : {}),
      ...(buildClashTransport(p) ? { transport: buildClashTransport(p) } : {}),
      ...(buildClashTls(p) ? { tls: buildClashTls(p) } : {}),
    },
  }),
  trojan: (p) => ({
    type: 'trojan',
    fields: {
      password: p.password,
      ...(buildClashTransport(p) ? { transport: buildClashTransport(p) } : {}),
      tls: buildClashTls(p) || { enabled: true, ...(p.sni ? { server_name: p.sni } : {}) },
    },
  }),
  hysteria2: (p) => ({
    type: 'hysteria2',
    fields: {
      password: p.password,
      tls: { enabled: true, ...(p.sni || p.servername ? { server_name: p.sni || p.servername } : {}) },
      ...(p.obfs ? { obfs: { type: p.obfs, ...(p['obfs-password'] ? { password: p['obfs-password'] } : {}) } } : {}),
    },
  }),
  tuic: (p) => ({
    type: 'tuic',
    fields: {
      uuid: p.uuid, password: p.password,
      ...(p['congestion-controller'] ? { congestion_control: p['congestion-controller'] } : {}),
      tls: { enabled: true, ...(p.sni || p.servername ? { server_name: p.sni || p.servername } : {}), ...(p.alpn ? { alpn: toArray(p.alpn) } : {}) },
    },
  }),
  wireguard: (p) => ({
    type: 'wireguard',
    fields: {
      private_key: p['private-key'], peer_public_key: p['public-key'],
      local_address: [p.ip, p.ipv6].filter(Boolean),
      ...(p['preshared-key'] ? { pre_shared_key: p['preshared-key'] } : {}),
    },
  }),
}

export const parseClashProxies = (yamlText) => {
  const nodes = []
  const skipped = []
  let doc
  try {
    doc = YAML.parse(yamlText)
  } catch {
    return { nodes, skipped }
  }
  const proxies = doc && Array.isArray(doc.proxies) ? doc.proxies : []
  for (const p of proxies) {
    if (!p || typeof p !== 'object') continue
    const mapper = MAPPERS[p.type]
    if (!mapper) {
      skipped.push({ name: p.name, type: p.type })
      continue
    }
    try {
      const { type, fields } = mapper(p)
      nodes.push(createNode({ tag: p.name, type, server: p.server, server_port: p.port, fields, source: 'clash' }))
    } catch {
      skipped.push({ name: p.name, type: p.type })
    }
  }
  return { nodes, skipped }
}
