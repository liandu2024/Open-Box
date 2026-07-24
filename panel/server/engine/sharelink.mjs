import { createNode } from './node-model.mjs'
import { decodeBase64 } from './codec.mjs'

export const SHARELINK_SCHEMES = ['ss', 'vmess']

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

export const parseShareLink = (uri) => {
  if (typeof uri !== 'string') return null
  try {
    if (uri.startsWith('ss://')) return parseSs(uri)
    if (uri.startsWith('vmess://')) return parseVmess(uri)
    return null
  } catch {
    return null
  }
}
