import { createNode } from './node-model.mjs'
import { normalizeRealityShortId, normalizeUtlsFingerprint, normalizeVlessFlow, sip003Plugin } from './node-fields.mjs'
import { decodeBase64, parseUri } from './codec.mjs'

export const SHARELINK_SCHEMES = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'anytls', 'socks', 'socks5']

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
  // SIP002 的 plugin= 参数(obfs-local / v2ray-plugin 内核支持);内核没有的插件返回 null 当作认不出
  let plugin
  const qIdx = rest.indexOf('?')
  if (qIdx >= 0) {
    try {
      plugin = sip003Plugin(new URLSearchParams(rest.slice(qIdx + 1)).get('plugin'))
    } catch {
      return null
    }
    rest = rest.slice(0, qIdx)
  }

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
    fields: { method, password, ...(plugin || {}) }, source: 'sharelink',
  })
}

const parseVmess = (uri) => {
  const conf = JSON.parse(decodeBase64(uri.slice('vmess://'.length)))
  let net = conf.net || 'tcp'
  if (net === 'h2') net = 'http'
  const fields = {
    uuid: conf.id,
    alter_id: Number.parseInt(conf.aid ?? 0, 10) || 0,
    security: conf.scy || 'auto',
  }
  // kcp / xhttp / splithttp 这些 sing-box 没有的传输层直接跳过,别生成一份内核拒收的配置
  if (!SUPPORTED_TRANSPORTS.has(net)) return null
  if (net !== 'tcp') {
    const transport = { type: net }
    if (net === 'grpc') {
      // v2rayN 把 serviceName 放在 path
      if (conf.path) transport.service_name = String(conf.path).replace(/^\/+/, '')
    } else {
      if (conf.path) transport.path = conf.path
      if (conf.host) transport.headers = { Host: conf.host }
    }
    fields.transport = transport
  }
  if (conf.tls === 'tls' || conf.tls === 'reality') {
    fields.tls = { enabled: true }
    // sni 没写按 ws / h2 的 host 兜底(v2rayN 也这么做):CF 优选的 add 是 IP,域名只在 host 里
    const sni = conf.sni || (net !== 'tcp' && conf.host) || ''
    if (sni) fields.tls.server_name = sni
  }
  return createNode({
    tag: conf.ps || '', type: 'vmess', server: conf.add, server_port: conf.port,
    fields, source: 'sharelink',
  })
}

const SUPPORTED_TRANSPORTS = new Set(['tcp', 'ws', 'http', 'grpc', 'httpupgrade', 'quic'])

const buildTransportFromQuery = (query) => {
  let type = query.get('type')
  if (!type || type === 'tcp') return undefined
  if (type === 'h2') type = 'http'
  // xhttp / splithttp / kcp:sing-box 没有对应传输层,整条链接当不支持处理(解析返回 null)
  if (!SUPPORTED_TRANSPORTS.has(type)) throw new Error(`unsupported transport: ${type}`)
  const transport = { type }
  const path = query.get('path')
  if (path) transport.path = path
  const host = query.get('host')
  if (host) transport.headers = { Host: host }
  const serviceName = query.get('serviceName')
  if (serviceName) transport.service_name = serviceName
  return transport
}

// SNI 的兜底顺序:ws / h2 的 Host 头 → 服务器地址。只有 Host 是域名时才用它
const sniFallback = (transport, host) => (transport && transport.headers && transport.headers.Host) || host

const buildTlsFromQuery = (query, fallbackSni) => {
  const security = query.get('security')
  if (security !== 'tls' && security !== 'reality' && security !== 'xtls') return undefined
  const tls = { enabled: true }
  const sni = query.get('sni') || fallbackSni
  if (sni) tls.server_name = sni
  const alpn = query.get('alpn')
  if (alpn) tls.alpn = alpn.split(',').map((s) => s.trim()).filter(Boolean)
  if (query.get('allowInsecure') === '1' || query.get('allowInsecure') === 'true' || query.get('insecure') === '1' || query.get('insecure') === 'true') tls.insecure = true
  const fp = query.get('fp')
  if (fp) tls.utls = { enabled: true, fingerprint: normalizeUtlsFingerprint(fp) }
  if (security === 'reality') {
    tls.reality = { enabled: true }
    const pbk = query.get('pbk')
    if (pbk) tls.reality.public_key = pbk
    const sid = normalizeRealityShortId(query.get('sid'))
    if (sid !== undefined) tls.reality.short_id = sid
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: 'chrome' }  // reality 需要 utls
  }
  return tls
}

const parseVless = (uri) => {
  const u = parseUri(uri)
  const fields = { uuid: safeDecode(u.userinfo) }
  const flow = normalizeVlessFlow(u.query.get('flow'))
  if (flow) fields.flow = flow
  const transport = buildTransportFromQuery(u.query)
  if (transport) fields.transport = transport
  // sni 没写时先按 ws / h2 的 host 兜底,再退到服务器地址:CF 优选的服务器是 IP,域名只在 host 里
  const tls = buildTlsFromQuery(u.query, sniFallback(transport, u.host))
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
  const fallback = sniFallback(transport, u.host)
  const tls = buildTlsFromQuery(u.query, fallback) || { enabled: true, ...(fallback ? { server_name: fallback } : {}) }
  fields.tls = tls
  return createNode({ tag: u.fragment, type: 'trojan', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}

// anytls://<password>@host:port?sni=...&insecure=1#name
// 与 trojan 同构:userinfo 就是密码,且协议本身强制 TLS,所以 security 缺省也按 tls
// 处理——否则 insecure/sni/alpn/fp 这些查询参数会被 buildTlsFromQuery 整个丢掉,
// 而机场发的 anytls 链接基本都带 insecure=1 和一个伪装 sni,丢了就连不上。
const parseAnytls = (uri) => {
  const u = parseUri(uri)
  const fields = { password: safeDecode(u.userinfo) }
  if (!u.query.get('security')) u.query.set('security', 'tls')
  fields.tls = buildTlsFromQuery(u.query, u.host) || { enabled: true, ...(u.host ? { server_name: u.host } : {}) }
  return createNode({ tag: u.fragment, type: 'anytls', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}

// hysteria2 与 tuic 都强制 TLS,和 trojan / anytls 一样把 security 缺省视为 tls,
// 再走公共的 buildTlsFromQuery——此前这两个解析器自己拼 tls,只取了 sni(tuic 还取了
// alpn),把 insecure / allowInsecure 和 fp 丢掉了。自建服务器用自签或过期证书、链接里
// 带 insecure=1 是常态(实测正式路由器上 tuic / hy2 节点因此全部报
// "x509: certificate has expired",而同一台服务器的 vless 正常)。
const parseHysteria2 = (uri) => {
  const u = parseUri(uri)
  const fields = { password: safeDecode(u.userinfo) }
  if (!u.query.get('security')) u.query.set('security', 'tls')
  fields.tls = buildTlsFromQuery(u.query, u.host) || { enabled: true, ...(u.host ? { server_name: u.host } : {}) }
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
  if (!u.query.get('security')) u.query.set('security', 'tls')
  fields.tls = buildTlsFromQuery(u.query, u.host) || { enabled: true, ...(u.host ? { server_name: u.host } : {}) }
  return createNode({ tag: u.fragment, type: 'tuic', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}

// socks5://user:pass@host:port#name  /  socks5://host:port#name(不要认证)
// socks://<base64(user:pass)>@host:port#name(v2rayN)
// socks://<base64(user:pass@host:port)>#name(Shadowrocket)
// socks4:// 与 socks4a:// 走同一套,只是把版本号记下来。
// sing-box 的 socks 出站没有 TLS、也没有传输层可配,所以这里只取版本和账号密码,
// 链接里带的 sni / fp 之类一律忽略——写进去内核会以 unknown field 拒收整份配置。
const parseSocks = (uri, version) => {
  let rest = uri.slice(uri.indexOf('://') + 3)
  let fragment = ''
  const hashIdx = rest.indexOf('#')
  if (hashIdx >= 0) {
    fragment = safeDecode(rest.slice(hashIdx + 1))
    rest = rest.slice(0, hashIdx)
  }
  const qIdx = rest.indexOf('?')
  if (qIdx >= 0) rest = rest.slice(0, qIdx)

  let creds = ''
  let hostport = rest
  if (rest.includes('@')) {
    const at = rest.lastIndexOf('@')
    const userinfo = rest.slice(0, at)
    hostport = rest.slice(at + 1)
    const plain = safeDecode(userinfo)
    if (plain.includes(':')) {
      creds = plain
    } else {
      // 明文里没有 ':' 才当 base64 试;解不出可打印的 user:pass 就按明文用户名处理
      const decoded = decodeBase64(userinfo)
      creds = isPrintable(decoded) && decoded.includes(':') ? decoded : plain
    }
  } else if (!rest.includes(':')) {
    // host:port 一定带 ':',没有 ':' 才可能是整体 base64(base64 字母表里没有 ':')
    const decoded = decodeBase64(rest)
    if (!isPrintable(decoded)) return null
    const at = decoded.lastIndexOf('@')
    creds = at >= 0 ? decoded.slice(0, at) : ''
    hostport = at >= 0 ? decoded.slice(at + 1) : decoded
  }

  const [server, port] = splitHostPort(hostport)
  const fields = {}
  if (creds) {
    const ci = creds.indexOf(':')
    fields.username = ci >= 0 ? creds.slice(0, ci) : creds
    if (ci >= 0) fields.password = creds.slice(ci + 1)
  }
  // 内核默认就是 5,只有 4 / 4a 需要写出来
  if (version && version !== '5') fields.version = version
  return createNode({ tag: fragment, type: 'socks', server, server_port: port, fields, source: 'sharelink' })
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
    if (uri.startsWith('anytls://')) return parseAnytls(uri)
    // socks5h 是 curl 的写法(DNS 也走代理),对出站来说和 socks5 没区别
    if (uri.startsWith('socks5://')) return parseSocks(uri, '5')
    if (uri.startsWith('socks5h://')) return parseSocks(uri, '5')
    if (uri.startsWith('socks4a://')) return parseSocks(uri, '4a')
    if (uri.startsWith('socks4://')) return parseSocks(uri, '4')
    if (uri.startsWith('socks://')) return parseSocks(uri, '5')
    return null
  } catch {
    return null
  }
}
