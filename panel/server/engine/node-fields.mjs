// 订阅 / 分享链接解析出来的几个字段,交给内核前的归一。内核只认它认识的写法,不认的写法不是"这个
// 节点连不上",而是整份配置起不来(GitHub #19 #23):所以在解析和生成出站两头都过一遍。

export const VLESS_FLOW_VISION = 'xtls-rprx-vision'

// sing-box 只支持 xtls-rprx-vision。Xray 的 -udp443 变体(vision + 拦 UDP 443)按 vision 用;
// xtls-rprx-direct / origin 这些早已废弃的 flow 丢掉,节点照常保留(GitHub #23)
export const normalizeVlessFlow = (flow) => {
  const v = String(flow ?? '').trim()
  if (!v || v === 'none') return undefined
  if (v.startsWith(VLESS_FLOW_VISION)) return VLESS_FLOW_VISION
  return undefined
}

// mihomo/Clash accepts `client-fingerprint: unsafe` as a compatibility value,
// while sing-box 1.14 rejects it during config validation.  Keep the value
// explicit at the import and emit boundaries so one legacy node cannot prevent
// the whole core from starting.  Other values are left untouched: sing-box
// should still report genuinely unsupported fingerprints instead of silently
// changing their meaning.
export const normalizeUtlsFingerprint = (fingerprint) => {
  if (fingerprint === undefined || fingerprint === null) return fingerprint
  return String(fingerprint).trim().toLowerCase() === 'unsafe' ? 'chrome' : fingerprint
}

// Reality 的 short_id:十六进制、最长 16 位(8 字节)。空 / null / "null" / 非十六进制一律不写——
// Clash 订阅里 `short-id: null` 曾被 String() 成字符串 "null",内核 decode short_id 直接 FATAL(GitHub #19)
export const normalizeRealityShortId = (v) => {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  if (!s || s === 'null' || s === 'undefined') return undefined
  return /^[0-9a-fA-F]{1,16}$/.test(s) ? s : undefined
}

// SS 插件(SIP003):sing-box 的 shadowsocks 出站支持 obfs-local 和 v2ray-plugin,plugin_opts 是分号分隔的 k=v。
// shadow-tls / restls 这类内核没有的插件才真的不支持,要跳过并说明(GitHub #21)
const PLUGIN_ALIASES = { obfs: 'obfs-local', 'obfs-local': 'obfs-local', 'simple-obfs': 'obfs-local', 'v2ray-plugin': 'v2ray-plugin' }

export class UnsupportedPluginError extends Error {
  constructor(plugin) {
    super(`ss plugin unsupported: ${plugin}`)
    this.code = 'unsupported-plugin'
    this.detail = plugin
  }
}

// Clash 写法:plugin: obfs | v2ray-plugin,plugin-opts: { mode, host, path, tls, mux }
export const clashSsPlugin = (plugin, opts) => {
  const name = PLUGIN_ALIASES[String(plugin || '').trim().toLowerCase()]
  if (!name) throw new UnsupportedPluginError(String(plugin || '').trim())
  const o = opts && typeof opts === 'object' ? opts : {}
  if (name === 'obfs-local') {
    const parts = [`obfs=${o.mode || 'http'}`]
    if (o.host) parts.push(`obfs-host=${o.host}`)
    return { plugin: name, plugin_opts: parts.join(';') }
  }
  const parts = [`mode=${o.mode || 'websocket'}`]
  if (o.host) parts.push(`host=${o.host}`)
  if (o.path) parts.push(`path=${o.path}`)
  if (o.tls === true) parts.push('tls')
  if (o.mux === false || o.mux === 0) parts.push('mux=0')
  return { plugin: name, plugin_opts: parts.join(';') }
}

// ss:// 链接的 plugin= 参数(SIP002):"obfs-local;obfs=http;obfs-host=x"——第一段是插件名,其余就是 plugin_opts
export const sip003Plugin = (text) => {
  const raw = String(text || '').trim()
  if (!raw) return undefined
  const [head, ...rest] = raw.split(';')
  const name = PLUGIN_ALIASES[head.trim().toLowerCase()]
  if (!name) throw new UnsupportedPluginError(head.trim())
  return { plugin: name, plugin_opts: rest.map((s) => s.trim()).filter(Boolean).join(';') }
}
