// 路由器自己各接口的网段(br-lan、docker0 等)与 CIDR 减法。
//
// 给 engine/config.mjs 算 tun 的 route_exclude_address 用:私网范围整体排除在 TUN 之外,但要把
// 本机接口所在的网段挖出来——sing-box 生成的 nft 里,排除表的 return 排在 DNS 劫持
// (dport 53 → 172.19.0.2)之前,若把路由器自己所在的网段也排除,局域网发给路由器的 DNS 查询
// 就再也进不了内核,「防火墙劫持」模式的分流解析就废了。接口网段内的目标本来就有直连路由,
// 挖出来不影响"私网不进 TUN"的目的(它们在后面的 local_address_set 那条上 return)。

const V4_BITS = 32n
const V6_BITS = 128n

const parseV4 = (s) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (!m) return null
  let n = 0n
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i])
    if (o > 255) return null
    n = (n << 8n) | BigInt(o)
  }
  return n
}

const parseV6 = (s) => {
  if (!/^[0-9a-fA-F:.]+$/.test(s) || !s.includes(':')) return null
  // 末尾可能是 IPv4 写法(::ffff:1.2.3.4),先换成两组 hex
  let text = s
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (v4) {
    const n = parseV4(v4[1])
    if (n === null) return null
    text = text.slice(0, -v4[1].length) + ((n >> 16n) & 0xffffn).toString(16) + ':' + (n & 0xffffn).toString(16)
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && head.length !== 8) return null
  const missing = 8 - head.length - tail.length
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  if (groups.length !== 8) return null
  let n = 0n
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    n = (n << 16n) | BigInt(parseInt(g, 16))
  }
  return n
}

const formatV4 = (n) => [24n, 16n, 8n, 0n].map((s) => String((n >> s) & 0xffn)).join('.')
const formatV6 = (n) => {
  const groups = []
  for (let i = 7n; i >= 0n; i--) groups.push(((n >> (i * 16n)) & 0xffffn).toString(16))
  // 压缩最长的一段连续 0
  let best = { start: -1, len: 0 }
  for (let i = 0; i < 8; i++) {
    if (groups[i] !== '0') continue
    let j = i
    while (j < 8 && groups[j] === '0') j++
    if (j - i > best.len) best = { start: i, len: j - i }
    i = j
  }
  if (best.len < 2) return groups.join(':')
  const left = groups.slice(0, best.start).join(':')
  const right = groups.slice(best.start + best.len).join(':')
  return `${left}::${right}`
}

// 'a.b.c.d/n' / 'x::y/n' → { family, net(已按掩码取整), prefix } ;不合法返回 null
export const parseCidr = (cidr) => {
  const m = /^([^/]+)(?:\/(\d{1,3}))?$/.exec(String(cidr || '').trim())
  if (!m) return null
  const v4 = parseV4(m[1])
  const family = v4 !== null ? 4 : parseV6(m[1]) !== null ? 6 : 0
  if (!family) return null
  const bits = family === 4 ? V4_BITS : V6_BITS
  const prefix = m[2] === undefined ? Number(bits) : Number(m[2])
  if (prefix < 0 || prefix > Number(bits)) return null
  const addr = family === 4 ? v4 : parseV6(m[1])
  const mask = prefix === 0 ? 0n : ((1n << bits) - 1n) ^ ((1n << (bits - BigInt(prefix))) - 1n)
  return { family, net: addr & mask, prefix }
}

const formatCidr = ({ family, net, prefix }) => `${family === 4 ? formatV4(net) : formatV6(net)}/${prefix}`

const sizeOf = (c) => 1n << ((c.family === 4 ? V4_BITS : V6_BITS) - BigInt(c.prefix))
const endOf = (c) => c.net + sizeOf(c) - 1n
const overlaps = (a, b) => a.family === b.family && a.net <= endOf(b) && b.net <= endOf(a)
const covers = (outer, inner) => outer.family === inner.family && outer.net <= inner.net && endOf(inner) <= endOf(outer)

export const cidrContains = (cidr, ip) => {
  const c = parseCidr(cidr)
  const p = parseCidr(ip)
  return Boolean(c && p && covers(c, p))
}

// bases 里挖掉 holes,结果仍是一组 CIDR(按需二分,直到与所有洞都不相交)
export const subtractCidrs = (bases, holes) => {
  const hs = holes.map(parseCidr).filter(Boolean)
  const out = []
  const walk = (c) => {
    const hit = hs.filter((h) => overlaps(c, h))
    if (!hit.length) { out.push(c); return }
    if (hit.some((h) => covers(h, c))) return
    const bits = c.family === 4 ? V4_BITS : V6_BITS
    if (BigInt(c.prefix) >= bits) return
    const half = sizeOf(c) / 2n
    walk({ family: c.family, net: c.net, prefix: c.prefix + 1 })
    walk({ family: c.family, net: c.net + half, prefix: c.prefix + 1 })
  }
  for (const b of bases.map(parseCidr).filter(Boolean)) walk(b)
  return out.map(formatCidr)
}

// `ip -4 -o addr` / `ip -6 -o addr` 的输出 → 各接口所在网段(去掉 /32、/128 的点对点地址、
// 回环与链路本地地址)。一行形如:
//   13: br-lan    inet 192.168.3.1/24 brd 192.168.3.255 scope global br-lan\       valid_lft forever
export const parseIpAddr = (text) => {
  const out = new Set()
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*\d+:\s+(\S+)\s+inet6?\s+(\S+)/.exec(line)
    if (!m) continue
    const [, ifname, cidr] = m
    if (ifname === 'lo') continue
    const c = parseCidr(cidr)
    if (!c) continue
    if ((c.family === 4 && c.prefix >= 32) || (c.family === 6 && c.prefix >= 128)) continue
    if (c.family === 6 && covers(parseCidr('fe80::/10'), c)) continue
    if (c.family === 4 && covers(parseCidr('127.0.0.0/8'), c)) continue
    out.add(formatCidr(c))
  }
  return [...out]
}

// 读不到就返回空数组:那样只是不挖洞,不该让部署失败
export const readLocalSubnets = async (ctx) => {
  const out = []
  for (const family of ['-4', '-6']) {
    try {
      const r = await ctx.exec('ip', [family, '-o', 'addr'], { timeoutMs: 5000 })
      if (r && r.code === 0) out.push(...parseIpAddr(r.stdout))
    } catch {
      // 忽略
    }
  }
  return out
}
