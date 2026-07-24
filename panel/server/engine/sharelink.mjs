import { createNode } from './node-model.mjs'
import { decodeBase64, parseUri } from './codec.mjs'

export const SHARELINK_SCHEMES = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic']

const parseSs = (uri) => {
  // ss://<...>#name  两种形态:SIP002(userinfo@host:port)或整体 base64
  let rest = uri.slice('ss://'.length)
  let fragment = ''
  const hashIdx = rest.indexOf('#')
  if (hashIdx >= 0) {
    fragment = decodeURIComponent(rest.slice(hashIdx + 1))
    rest = rest.slice(0, hashIdx)
  }
  const qIdx = rest.indexOf('?')
  if (qIdx >= 0) rest = rest.slice(0, qIdx) // 忽略 plugin 参数(P2a 不做插件)

  let method, password, server, port
  if (rest.includes('@')) {
    // SIP002: base64(method:password)@host:port
    const at = rest.lastIndexOf('@')
    const userinfo = rest.slice(0, at)
    const hostport = rest.slice(at + 1)
    const creds = decodeBase64(userinfo)
    const ci = creds.indexOf(':')
    method = creds.slice(0, ci)
    password = creds.slice(ci + 1)
    const colon = hostport.lastIndexOf(':')
    server = hostport.slice(0, colon)
    port = hostport.slice(colon + 1)
  } else {
    // 旧格式: base64(method:password@host:port)
    const decoded = decodeBase64(rest)
    const at = decoded.lastIndexOf('@')
    const creds = decoded.slice(0, at)
    const hostport = decoded.slice(at + 1)
    const ci = creds.indexOf(':')
    method = creds.slice(0, ci)
    password = creds.slice(ci + 1)
    const colon = hostport.lastIndexOf(':')
    server = hostport.slice(0, colon)
    port = hostport.slice(colon + 1)
  }
  return createNode({
    tag: fragment, type: 'shadowsocks', server, server_port: port,
    fields: { method, password }, source: 'sharelink',
  })
}

const parseVmess = (uri) => {
  const conf = JSON.parse(decodeBase64(uri.slice('vmess://'.length)))
  const net = conf.net || 'tcp'
  const fields = {
    uuid: conf.id,
    alter_id: Number.parseInt(conf.aid ?? 0, 10) || 0,
    security: conf.scy || 'auto',
  }
  if (net === 'ws' || net === 'grpc' || net === 'http') {
    const transport = { type: net }
    if (conf.path) transport.path = conf.path
    if (conf.host) transport.headers = { Host: conf.host }
    fields.transport = transport
  }
  if (conf.tls === 'tls' || conf.tls === 'reality') {
    fields.tls = { enabled: true }
    if (conf.sni) fields.tls.server_name = conf.sni
  }
  return createNode({
    tag: conf.ps || '', type: 'vmess', server: conf.add, server_port: conf.port,
    fields, source: 'sharelink',
  })
}

const buildTransportFromQuery = (query) => {
  const type = query.get('type')
  if (!type || type === 'tcp') return undefined
  const transport = { type }
  const path = query.get('path')
  if (path) transport.path = path
  const host = query.get('host')
  if (host) transport.headers = { Host: host }
  const serviceName = query.get('serviceName')
  if (serviceName) transport.service_name = serviceName
  return transport
}

const buildTlsFromQuery = (query, fallbackSni) => {
  const security = query.get('security')
  if (security !== 'tls' && security !== 'reality' && security !== 'xtls') return undefined
  const tls = { enabled: true }
  const sni = query.get('sni') || fallbackSni
  if (sni) tls.server_name = sni
  const alpn = query.get('alpn')
  if (alpn) tls.alpn = alpn.split(',').map((s) => s.trim()).filter(Boolean)
  return tls
}

const parseVless = (uri) => {
  const u = parseUri(uri)
  const fields = { uuid: u.userinfo }
  const flow = u.query.get('flow')
  if (flow) fields.flow = flow
  const transport = buildTransportFromQuery(u.query)
  if (transport) fields.transport = transport
  const tls = buildTlsFromQuery(u.query, u.host)
  if (tls) fields.tls = tls
  return createNode({ tag: u.fragment, type: 'vless', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}

const parseTrojan = (uri) => {
  const u = parseUri(uri)
  const fields = { password: u.userinfo }
  const transport = buildTransportFromQuery(u.query)
  if (transport) fields.transport = transport
  // trojan 默认走 TLS;security 缺省也视为 tls
  const tls = buildTlsFromQuery(u.query, u.host) || { enabled: true, ...(u.host ? { server_name: u.host } : {}) }
  fields.tls = tls
  return createNode({ tag: u.fragment, type: 'trojan', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}

const parseHysteria2 = (uri) => {
  const u = parseUri(uri)
  const fields = { password: u.userinfo }
  const tls = { enabled: true }
  const sni = u.query.get('sni')
  if (sni) tls.server_name = sni
  fields.tls = tls
  const obfs = u.query.get('obfs')
  if (obfs) {
    fields.obfs = { type: obfs }
    const op = u.query.get('obfs-password')
    if (op) fields.obfs.password = op
  }
  return createNode({ tag: u.fragment, type: 'hysteria2', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}

const parseTuic = (uri) => {
  const u = parseUri(uri)
  const ci = u.userinfo.indexOf(':')
  const fields = {
    uuid: ci >= 0 ? u.userinfo.slice(0, ci) : u.userinfo,
    password: ci >= 0 ? u.userinfo.slice(ci + 1) : '',
  }
  const cc = u.query.get('congestion_control')
  if (cc) fields.congestion_control = cc
  const tls = { enabled: true }
  const sni = u.query.get('sni')
  if (sni) tls.server_name = sni
  const alpn = u.query.get('alpn')
  if (alpn) tls.alpn = alpn.split(',').map((s) => s.trim()).filter(Boolean)
  fields.tls = tls
  return createNode({ tag: u.fragment, type: 'tuic', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}

export const parseShareLink = (uri) => {
  if (typeof uri !== 'string') return null
  try {
    if (uri.startsWith('ss://')) return parseSs(uri)
    if (uri.startsWith('vmess://')) return parseVmess(uri)
    if (uri.startsWith('vless://')) return parseVless(uri)
    if (uri.startsWith('trojan://')) return parseTrojan(uri)
    if (uri.startsWith('hysteria2://')) return parseHysteria2(uri)
    if (uri.startsWith('hy2://')) return parseHysteria2('hysteria2://' + uri.slice('hy2://'.length))
    if (uri.startsWith('tuic://')) return parseTuic(uri)
    return null
  } catch {
    return null
  }
}
