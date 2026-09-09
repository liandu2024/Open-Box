import dns from 'node:dns/promises'
import net from 'node:net'

// 面板运行在网关上,对"服务端发起、目标可由客户端控制"的任何请求(订阅拉取、渗透测试的
// ip_is_private 路由规则判定等)都必须用同一套"是不是公网地址"判定——P4a 复审的教训正是
// subscriptions.mjs 与 penetration.mjs 曾经各自维护一份范围表,逐渐产生偏差、留下绕过缺口。
// 不依赖额外的第三方 IP 解析库:server/ 运行时是单独的 pnpm workspace 包(见
// server/package.json,`pnpm --filter ... deploy --prod` 只会打包它自己声明的依赖,不含
// panel 主包的 devDependencies),引入新依赖意味着还要同步维护 server/package.json 与生产
// 部署链路,这里用手写的范围表足够、也更可控。

// ---- IPv4 ----

const ipv4ToInt = (ip) => ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0

const ipv4InRange = (ipInt, base, bits) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipInt & mask) === (ipv4ToInt(base) & mask)
}

// 需要拒绝的 IPv4 网段:RFC1918 私有段、127.0.0.0/8 回环、169.254.0.0/16 链路本地、
// 0.0.0.0/8("本网络"/未指定)、100.64.0.0/10(RFC6598 CGNAT,运营商内网,同样不该被面板
// 当作"外部"目标访问)。后两个是本轮复审新增的缺口。
// 分两档:allowPrivate 时放行「内网 / 回环 / CGNAT」(自建在局域网或本机的 subconverter 出的订阅
// 地址,GitHub #42),但未指定地址和链路本地任何时候都不放——它们不可能是一个订阅服务
const IPV4_PRIVATE_RANGES = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['100.64.0.0', 10],
]
const IPV4_NEVER_RANGES = [
  ['169.254.0.0', 16],
  ['0.0.0.0', 8],
]

const isDeniedIPv4 = (ip, { allowPrivate = false } = {}) => {
  const ipInt = ipv4ToInt(ip)
  if (IPV4_NEVER_RANGES.some(([base, bits]) => ipv4InRange(ipInt, base, bits))) return true
  if (allowPrivate) return false
  return IPV4_PRIVATE_RANGES.some(([base, bits]) => ipv4InRange(ipInt, base, bits))
}

// ---- IPv6 ----

const tokenWeight = (token) => (token.includes('.') ? 2 : 1)

// "::"是 IPv6 的零压缩记号,展开时要用"占用槽位数"而不是"token 个数"来计算需要补几个
// 全零分组——内嵌点分十进制的 IPv4 后缀(如 "127.0.0.1")本身只是一个 token,却占两个
// 16bit 槽位,漏算这一点会导致展开结果少一组、后续按索引取值全部错位。
const expandCompressedTokens = (ip) => {
  const [head, tail] = ip.split('::')
  const headTokens = head ? head.split(':') : []
  const tailTokens = tail ? tail.split(':') : []
  const usedSlots =
    headTokens.reduce((sum, t) => sum + tokenWeight(t), 0) +
    tailTokens.reduce((sum, t) => sum + tokenWeight(t), 0)
  const zeros = new Array(Math.max(8 - usedSlots, 0)).fill('0')
  return [...headTokens, ...zeros, ...tailTokens]
}

// 展开成 8 个 16bit 分组(数值数组)。同时接受两种 IPv4-mapped 写法:
// 十六进制形式("::ffff:7f00:1",本轮复审的漏判点)与内嵌点分十进制形式
// ("::ffff:127.0.0.1")——两者数学上是同一个地址,必须归一到同一个结果。
const toIPv6FullGroups = (ip) => {
  const tokens = ip.includes('::') ? expandCompressedTokens(ip) : ip.split(':')
  const groups = []
  for (const token of tokens) {
    if (token.includes('.')) {
      const ipInt = ipv4ToInt(token)
      groups.push((ipInt >>> 16) & 0xffff, ipInt & 0xffff)
    } else {
      groups.push(token ? parseInt(token, 16) : 0)
    }
  }
  return groups
}

const isIPv4MappedGroups = (groups) => groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff

const groupsToIPv4 = (groups) => {
  const last32 = ((groups[6] << 16) | groups[7]) >>> 0
  return [(last32 >>> 24) & 0xff, (last32 >>> 16) & 0xff, (last32 >>> 8) & 0xff, last32 & 0xff].join('.')
}

const isDeniedIPv6 = (ip, { allowPrivate = false } = {}) => {
  const groups = toIPv6FullGroups(ip.toLowerCase())
  if (groups.length !== 8) return true // 展开失败的畸形地址,保守拒绝(fail closed)

  // IPv4-mapped(::ffff:0:0/96):先归一成 IPv4 再套用同一份 IPv4 拒绝名单,
  // 不管原始书写是点分十进制还是十六进制分组。
  if (isIPv4MappedGroups(groups)) {
    return isDeniedIPv4(groupsToIPv4(groups), { allowPrivate })
  }

  if (groups.every((g) => g === 0)) return true // "::" 未指定地址(RFC4291)
  const first = groups[0]
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 链路本地
  if (allowPrivate) return false
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true // "::1" 回环
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 唯一本地地址
  return false
}

// 判定一个"字面 IP"(不做任何域名解析)是否为公网地址。非法/非 IP 输入一律判定为
// "不是公网地址"——调用方通常只在明确已知是 IP 字面量时才会走到这里。
// allowPrivate:内网 / 回环也算"可以去"(只拒未指定和链路本地),给订阅拉取用
export const isPublicAddress = (address, { allowPrivate = false } = {}) => {
  const trimmed = String(address).trim()
  const version = net.isIP(trimmed)
  if (version === 4) return !isDeniedIPv4(trimmed, { allowPrivate })
  if (version === 6) return !isDeniedIPv6(trimmed, { allowPrivate })
  return false
}

// 供"字面 IP 是否私有/回环"场景使用(如 penetration.mjs 的 ip_is_private 路由规则):
// target 不是合法 IP 字面量(即为域名)时,在未解析之前不应判定命中,统一返回 false——
// 域名一律返回 false 也正是 SSRF 绕过的根源之一,所以"需要判断是否安全"的调用方
// (订阅拉取)必须改用下面的 assertPublicHost/assertPublicUrl,对解析结果逐一判定,
// 而不是只依赖这个字面量判定。
export const isPrivateOrLoopbackIp = (target) => {
  const trimmed = String(target).trim()
  if (net.isIP(trimmed) === 0) return false
  return !isPublicAddress(trimmed)
}

const stripBrackets = (hostname) => String(hostname).replace(/^\[|\]$/g, '').trim()

// 解析 hostname(用 node:dns/promises 的 lookup + {all:true}),对每一个返回地址都要求
// 是公网地址——命中任意一个非公网地址就拒绝;解析失败(NXDOMAIN/超时等)同样拒绝,
// "解析不出来"不等于"安全",不能放行。
// allowPrivate:放行内网 / 本机地址(订阅可以来自局域网里自建的 subconverter);未指定 / 链路本地照拒
export const assertPublicHost = async (hostname, { lookup = dns.lookup, allowPrivate = false } = {}) => {
  const trimmed = stripBrackets(hostname)
  if (!trimmed) {
    throw new Error('hostname is required')
  }

  let records
  try {
    records = await lookup(trimmed, { all: true })
  } catch (err) {
    throw new Error(`failed to resolve host "${trimmed}": ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`host "${trimmed}" did not resolve to any address`)
  }

  for (const record of records) {
    const address = record && record.address
    if (!isPublicAddress(address, { allowPrivate })) {
      throw new Error(allowPrivate
        ? `host "${trimmed}" resolves to an unroutable address (${address})`
        : `host "${trimmed}" resolves to a non-public address (${address})`)
    }
  }

  // 把解析结果返回给调用方:需要"校验过什么就连什么"的场景(节点延迟测试)必须拿到
  // 这些地址直接建连,否则校验与建连之间会再解析一次,留下 DNS rebinding 的窗口。
  // 原有调用方忽略返回值,不受影响。
  return records
}

// 把刚校验过的地址做成 node:http / node:https 的 lookup:实际建连时就连这些地址,不再
// 解析一次。校验和建连各自解析是 DNS rebinding 的窗口——同一个域名第一次答公网、第二次答
// 回环,校验过了、连的却是本机服务。Host 头和 TLS 的 SNI 仍然是原来的域名(由调用方保证)。
export const pinnedLookup = (records) => {
  const list = (Array.isArray(records) ? records : [])
    .map((r) => ({ address: String(r && r.address || ''), family: Number(r && r.family) || 4 }))
    .filter((r) => r.address)
  return (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback
    const opts = typeof options === 'object' && options ? options : {}
    if (!list.length) { cb(new Error(`no validated address for ${hostname}`)); return }
    if (opts.all) { cb(null, list.map((r) => ({ address: r.address, family: r.family }))); return }
    cb(null, list[0].address, list[0].family)
  }
}

// 协议限定 http/https + 解析并校验 hostname 的每一个地址。校验通过时返回解析出的 URL
// 对象,方便调用方复用(不用重新 new URL 一次)。
export const assertPublicUrl = async (urlString, options = {}) => {
  let parsed
  try {
    parsed = new URL(urlString)
  } catch {
    throw new Error('invalid url')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http and https urls are supported')
  }

  const records = await assertPublicHost(parsed.hostname, options)
  // 调用方需要"校验过什么就连什么"时,从这里拿刚校验过的地址
  parsed.validatedRecords = records

  return parsed
}
