import { createNode } from './node-model.mjs'
import { decodeBase64, parseUri } from './codec.mjs'

export const SHARELINK_SCHEMES = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic']

// decodeURIComponent 失败(非法 % 序列)时回退原值,而不是抛异常
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// 判断字符串是否"可打印"(不含控制字符),用于校验 base64 解码结果确实是文本凭据而非乱码
const isPrintable = (s) => typeof s === 'string' && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(s)

// 拆分 host:port,IPv6 主机形如 [::1]:port 需剥括号(与 codec.parseUri 保持一致)
const splitHostPort = (hostport) => {
  if (hostport.startsWith('[')) {
    const close = hostport.indexOf(']')
    const host = hostport.slice(1, close)
    const after = hostport.slice(close + 1)
    const port = after.startsWith(':') ? after.slice(1) : ''
    return [host, port]
  }
  const colon = hostport.lastIndexOf(':')
  if (colon < 0) return [hostport, '']
  return [hostport.slice(0, colon), hostport.slice(colon + 1)]
}

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
    // SIP002: userinfo@host:port。userinfo 可能是 base64(method:password),
    // 也可能是 SS-2022 的明文(可能 percent-encoded)method:password —— 先按明文尝试,
    // 含 ':' 才当明文,否则再走 base64 并要求结果含 ':' 且可打印。
    const at = rest.lastIndexOf('@')
    const userinfo = rest.slice(0, at)
    const hostport = rest.slice(at + 1)
    const plain = safeDecode(userinfo)
    let creds
    if (plain.includes(':')) {
      creds = plain
    } else {
      const decoded = decodeBase64(userinfo)
      if (!decoded.includes(':') || !isPrintable(decoded)) return null
      creds = decoded
    }
    const ci = creds.indexOf(':')
    method = creds.slice(0, ci)
    password = creds.slice(ci + 1)
    ;[server, port] = splitHostPort(hostport)
  } else {
    // 旧格式: base64(method:password@host:port)
    const decoded = decodeBase64(rest)
    const at = decoded.lastIndexOf('@')
    const creds = decoded.slice(0, at)
    const hostport = decoded.slice(at + 1)
    const ci = creds.indexOf(':')
    method = creds.slice(0, ci)
    password = creds.slice(ci + 1)
    ;[server, port] = splitHostPort(hostport)
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
  let type = query.get('type')
  if (!type || type === 'tcp') return undefined
  if (type === 'h2') type = 'http'
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
  if (query.get('allowInsecure') === '1' || query.get('insecure') === '1') tls.insecure = true
  const fp = query.get('fp')
  if (fp) tls.utls = { enabled: true, fingerprint: fp }
  if (security === 'reality') {
    tls.reality = { enabled: true }
    const pbk = query.get('pbk')
    if (pbk) tls.reality.public_key = pbk
    const sid = query.get('sid')
    if (sid) tls.reality.short_id = sid
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: 'chrome' }  // reality 需要 utls
  }
  return tls
}

const parseVless = (uri) => {
  const u = parseUri(uri)
  const fields = { uuid: safeDecode(u.userinfo) }
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
  const fields = { password: safeDecode(u.userinfo) }
  const transport = buildTransportFromQuery(u.query)
  if (transport) fields.transport = transport
  // trojan 默认走 TLS;security 缺省也视为 tls,以便 insecure/reality/utls 等 tls 字段仍被采集
  if (!u.query.get('security')) u.query.set('security', 'tls')
  const tls = buildTlsFromQuery(u.query, u.host) || { enabled: true, ...(u.host ? { server_name: u.host } : {}) }
  fields.tls = tls
  return createNode({ tag: u.fragment, type: 'trojan', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}

const parseHysteria2 = (uri) => {
  const u = parseUri(uri)
  const fields = { password: safeDecode(u.userinfo) }
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
  // 先 split ':' 再逐段 decode,避免 uuid/password 中的 percent-encoded ':' 干扰分隔
  const ci = u.userinfo.indexOf(':')
  const fields = {
    uuid: safeDecode(ci >= 0 ? u.userinfo.slice(0, ci) : u.userinfo),
    password: ci >= 0 ? safeDecode(u.userinfo.slice(ci + 1)) : '',
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
