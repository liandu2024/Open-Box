// DNS 重写(设置 → 后端 → DNS 劫持 下面那张卡):把一个域名的解析答案改成别的域名、或固定的 IPv4 / IPv6。
//
// 一条规则 = { id, enabled, source, domain, addresses, note }:
//   · source:精确域名(services.googleapis.cn)或泛域名(*.example.com,只匹配子域,不含根域;
//     根域要另加一条);
//   · domain:目标域名(域名型,动态解析,合成 CNAME 链 + 目标的 A / AAAA);
//   · addresses:固定地址(IP 型,可同时填多个 IPv4 / IPv6,按查询类型分别出现在 A / AAAA 里)。
//   两者只能填一种。
// 匹配:只看启用的规则,精确优先,其次后缀最长的泛域名;按完整标签比,badexample.com 不会命中 *.example.com。
//
// 落地(见 engine/dns.mjs、system/dns-rewrite-server.mjs):内核的 dns.rules 最前面加一条「这些域名交给
// dns-rewrite 服务器」——那是面板进程在 127.0.0.1:7854 上开的一个小 DNS 服务;它按同一套规则二次匹配后
// 生成答案,域名型目标再回头问内核 :7853(目标域名走现有的分流 DNS 策略)。dnsmasq 转发模式下这些源域名
// 也进转发名单,不然在原上游就被正常解析了。
//
// 默认带两条 Google 的重写(services.googleapis.cn / developers.google.cn → .com):按普通条目存,稳定 id,
// 用户改了 / 停了 / 删了都算数;只在「重写配置还没初始化」的档案上补一次,以后不再自动回填(见
// ensureDnsRewriteDefaults)。
import net from 'node:net'
import { dnsmasqSafeDomain } from './dns-names.mjs'

export const DNS_REWRITE_TAG = 'dns-rewrite'
export const DNS_REWRITE_PORT = 7854
export const DNS_REWRITE_MAX_RULES = 200
export const DNS_REWRITE_MAX_ADDRESSES = 16
// 固定地址答案 / 合成 CNAME 的 TTL(秒)
export const DNS_REWRITE_FIXED_TTL = 60
export const DNS_REWRITE_INIT_VERSION = 1

export const DNS_REWRITE_DEFAULTS = Object.freeze([
  Object.freeze({ id: 'default-services-googleapis-cn', enabled: true, source: 'services.googleapis.cn', domain: 'services.googleapis.com', addresses: [], note: '' }),
  Object.freeze({ id: 'default-developers-google-cn', enabled: true, source: 'developers.google.cn', domain: 'developers.google.com', addresses: [], note: '' }),
])

const DNS_LABEL = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/i

// 规范化一个域名:小写、去首尾空白、去末尾的点;非法返回 ''。allowWildcard 时接受前导 "*."
export const normalizeDomain = (raw, { allowWildcard = false } = {}) => {
  let d = String(raw ?? '').trim().toLowerCase().replace(/\.+$/, '')
  let wildcard = false
  if (allowWildcard && d.startsWith('*.')) { wildcard = true; d = d.slice(2) }
  if (!d || d.length > 253 || d.includes('*')) return ''
  const labels = d.split('.')
  if (!labels.every((l) => DNS_LABEL.test(l))) return ''
  return wildcard ? `*.${d}` : d
}
export const isWildcardSource = (source) => typeof source === 'string' && source.startsWith('*.')
const wildcardBase = (source) => source.slice(2)

const normalizeAddress = (raw) => {
  const a = String(raw ?? '').trim().toLowerCase()
  const kind = net.isIP(a)
  return kind === 4 || kind === 6 ? a : ''
}

export const normalizeRule = (raw, index = 0) => {
  const r = raw && typeof raw === 'object' ? raw : {}
  const addresses = []
  for (const a of Array.isArray(r.addresses) ? r.addresses : []) {
    const v = normalizeAddress(a)
    if (v && !addresses.includes(v)) addresses.push(v)
  }
  const domain = normalizeDomain(r.domain)
  return {
    id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `rw-${index + 1}`,
    enabled: r.enabled !== false,
    source: normalizeDomain(r.source, { allowWildcard: true }),
    // 域名型和 IP 型只能二选一:两个都填了按域名型算(校验那边会拒,这里是读老数据的宽容路径)
    domain,
    addresses: domain ? [] : addresses,
    note: typeof r.note === 'string' ? r.note.trim().slice(0, 200) : '',
  }
}

// 档案 dns 段里的重写配置 → 内部形状。缺字段 = 还没初始化(和显式的空列表分开)
export const normalizeDnsRewrite = (dns) => {
  const rw = dns && typeof dns === 'object' && dns.rewrite && typeof dns.rewrite === 'object' ? dns.rewrite : null
  const rules = (Array.isArray(rw?.rules) ? rw.rules : []).map(normalizeRule).filter((r) => r.source && (r.domain || r.addresses.length))
  return { initialized: Boolean(rw && rw.initialized), rules }
}

// 写入前校验(api/profile.mjs):形状、每条的源 / 目标、重复源;不合法的不静默丢掉
export const validateDnsRewrite = (raw) => {
  if (raw === null || raw === undefined) return ''
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'dns.rewrite must be an object'
  if ('rules' in raw) {
    if (!Array.isArray(raw.rules)) return 'dns.rewrite.rules must be an array'
    if (raw.rules.length > DNS_REWRITE_MAX_RULES) return `DNS 重写最多 ${DNS_REWRITE_MAX_RULES} 条`
    const seen = new Set()
    for (let i = 0; i < raw.rules.length; i++) {
      const r = raw.rules[i]
      if (!r || typeof r !== 'object' || Array.isArray(r)) return `DNS 重写第 ${i + 1} 条不是对象`
      const source = normalizeDomain(r.source, { allowWildcard: true })
      if (!source) return `DNS 重写第 ${i + 1} 条的源域名不合法:「${String(r.source ?? '')}」(精确域名或 *.example.com)`
      if (seen.has(source)) return `DNS 重写的源域名重复:${source}`
      seen.add(source)
      const hasDomain = r.domain !== undefined && r.domain !== null && String(r.domain).trim() !== ''
      const addrs = Array.isArray(r.addresses) ? r.addresses.filter((a) => String(a ?? '').trim() !== '') : []
      if (r.addresses !== undefined && r.addresses !== null && !Array.isArray(r.addresses)) return `DNS 重写「${source}」的 addresses 必须是数组`
      if (hasDomain && addrs.length) return `DNS 重写「${source}」只能填目标域名或固定地址中的一种`
      if (!hasDomain && !addrs.length) return `DNS 重写「${source}」要填目标域名或至少一个地址`
      if (hasDomain) {
        const domain = normalizeDomain(r.domain)
        if (!domain) return `DNS 重写「${source}」的目标域名不合法:「${String(r.domain)}」`
        if (domain === source) return `DNS 重写「${source}」的目标不能是它自己`
      } else {
        if (addrs.length > DNS_REWRITE_MAX_ADDRESSES) return `DNS 重写「${source}」最多 ${DNS_REWRITE_MAX_ADDRESSES} 个地址`
        for (const a of addrs) if (!normalizeAddress(a)) return `DNS 重写「${source}」的地址不合法:「${String(a)}」`
      }
      if (r.enabled !== undefined && r.enabled !== null && typeof r.enabled !== 'boolean') return `DNS 重写「${source}」的 enabled 必须是开 / 关`
      if (r.note !== undefined && r.note !== null && typeof r.note !== 'string') return `DNS 重写「${source}」的备注必须是文本`
      if (r.id !== undefined && r.id !== null && typeof r.id !== 'string') return `DNS 重写「${source}」的 id 不合法`
    }
  }
  return ''
}

// 找命中的规则:精确优先,再按泛域名后缀最长的;只看启用的。qname 已规范化(小写、无末尾点)
export const matchRewrite = (rules, qname) => {
  const name = normalizeDomain(qname)
  if (!name) return null
  let best = null
  for (const r of rules) {
    if (!r.enabled) continue
    if (!isWildcardSource(r.source)) {
      if (r.source === name) return r
      continue
    }
    const base = wildcardBase(r.source)
    if (name.length > base.length + 1 && name.endsWith(`.${base}`)) {
      if (!best || base.length > wildcardBase(best.source).length) best = r
    }
  }
  return best
}

export const enabledRewriteRules = (rules) => rules.filter((r) => r.enabled && r.source && (r.domain || r.addresses.length))

// dnsmasq 转发名单里的写法:精确域名照写;泛域名写根域(dnsmasq 的 server=/x/ 本来就连根域一起转,根域到了内核
// 按现有规则正常解析,重写那一步不会命中它)
export const rewriteForwardDomains = (rules) => {
  const out = new Set()
  for (const r of enabledRewriteRules(rules)) {
    const safe = dnsmasqSafeDomain(isWildcardSource(r.source) ? wildcardBase(r.source) : r.source)
    if (safe) out.add(safe)
  }
  return [...out]
}

// 内核 dns.rules 里的匹配:精确的进 domain,泛域名进 domain_suffix(带前导点 = 只匹配子域,按标签边界)
export const rewriteDnsRules = (rules) => {
  const exact = []
  const suffix = []
  for (const r of enabledRewriteRules(rules)) {
    if (isWildcardSource(r.source)) suffix.push(`.${wildcardBase(r.source)}`)
    else exact.push(r.source)
  }
  const out = []
  if (exact.length) out.push({ domain: exact, server: DNS_REWRITE_TAG })
  if (suffix.length) out.push({ domain_suffix: suffix, server: DNS_REWRITE_TAG })
  return out
}
export const rewriteDnsServer = () => ({ type: 'udp', tag: DNS_REWRITE_TAG, server: '127.0.0.1', server_port: DNS_REWRITE_PORT })

export const enabledRewriteSources = (rules) => enabledRewriteRules(rules).map((r) => r.source)

// 首次引入这个功能的档案补两条默认规则并记下「已初始化」。已经初始化过的(不管用户之后怎么改)一律不动;
// 已有同源的用户规则优先,不覆盖。返回是否写过
export const ensureDnsRewriteDefaults = (store) => {
  const profile = store.getProfile() || {}
  const current = normalizeDnsRewrite(profile.dns)
  if (current.initialized) return false
  const existing = Array.isArray(profile.dns?.rewrite?.rules) ? profile.dns.rewrite.rules.map(normalizeRule) : []
  const sources = new Set(existing.map((r) => r.source))
  const rules = [...existing, ...DNS_REWRITE_DEFAULTS.filter((d) => !sources.has(d.source)).map((d) => ({ ...d, addresses: [] }))]
  store.setProfile({ dns: { rewrite: { initialized: DNS_REWRITE_INIT_VERSION, rules } } })
  return true
}

// 「恢复默认」:只动两条默认项(按稳定 id 找,找到就重置为默认值,没有就补进去),其余规则原样保留
export const restoreDefaultRules = (rules) => {
  const list = (Array.isArray(rules) ? rules : []).map(normalizeRule)
  const out = []
  const seenDefault = new Set()
  for (const r of list) {
    const d = DNS_REWRITE_DEFAULTS.find((x) => x.id === r.id)
    if (d) { out.push({ ...d, addresses: [] }); seenDefault.add(d.id) } else out.push(r)
  }
  for (const d of DNS_REWRITE_DEFAULTS) {
    if (seenDefault.has(d.id)) continue
    // 用户自己另建过同源规则:默认项让位,不制造重复源
    if (out.some((r) => r.source === d.source)) continue
    out.push({ ...d, addresses: [] })
  }
  return out
}
