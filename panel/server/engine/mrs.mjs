// 解码 mihomo 的 .mrs 规则集。
//
// 「规则集链接」可以填 .mrs(比如 meta-rules-dat 的 meta 分支:geo/geosite/cn.mrs)。它是
// mihomo 自己的二进制格式,内核(sing-box)不认,`sing-box rule-set convert` 也只会转 adguard。
// 所以这里把它解开,还原成域名 / IP 名单,再走和文本名单一样的那条路编成 .srs。
//
// 格式(照 mihomo 的 rules/provider/mrs_reader.go 与 component/trie、component/cidr 的
// WriteBin / ReadBin 实现):
//   整个文件是一段 zstd,解压后:
//     [4]byte  魔数 "MRS\x01"
//     [1]byte  behavior:0=domain,1=ipcidr,2=classical(classical 没有二进制体,不支持)
//     int64BE  条数(仅供核对)
//     int64BE  预留段长度 + 该长度的字节(当前为 0)
//     之后是按 behavior 走的数据体
//   domain 体(ReadDomainSetBin):
//     [1]byte  版本(必须 1)
//     int64BE  leaves 的 uint64 个数 + 这些 uint64(大端)
//     int64BE  labelBitmap 的 uint64 个数 + 这些 uint64(大端)
//     int64BE  labels 字节数 + 这些字节
//     三者合起来是一棵 succinct trie(LOUDS),域名是**倒着**存进去的,枚举出来要再翻回来
//   ipcidr 体(ReadIpCidrSet):
//     [1]byte  版本(必须 1)
//     int64BE  区间个数,每个区间 = 16 字节起址 + 16 字节止址(都是 IPv6 映射形式)
//
// 位序要留神:uint64 在文件里是大端,但 setBit/getBit 用的是 `word & (1 << (i&63))`,
// 即每个 word 内部是从最低位数起。所以第 i 位落在 word i>>6 的第 (i&63) 位,换算成字节
// 就是这个 word 的第 (7 - (i&63)>>3) 个字节的第 (i&7) 位——下面 bitAt 就是这么写的。

export const MRS_MAGIC = [0x4d, 0x52, 0x53, 0x01] // "MRS\x01"
export const MRS_BEHAVIOR = { domain: 0, ipcidr: 1, classical: 2 }

export const looksLikeZstd = (buf) =>
  buf && buf.length >= 4 && buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd

export const looksLikeMrs = (buf) =>
  buf && buf.length >= 4 && MRS_MAGIC.every((b, i) => buf[i] === b)

// 顺序读:所有多字节数都是大端
class Reader {
  constructor(buf) {
    this.buf = buf
    this.pos = 0
  }
  bytes(n) {
    if (n < 0 || this.pos + n > this.buf.length) throw new Error('.mrs 文件不完整')
    const out = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }
  u8() {
    return this.bytes(1)[0]
  }
  // int64:条数、长度这些都远小于 2^53,超了直接认为文件有问题
  i64() {
    const b = this.bytes(8)
    const hi = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]
    const lo = (b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7]
    const v = hi * 4294967296 + (lo >>> 0)
    if (!Number.isSafeInteger(v) || v < 0) throw new Error('.mrs 里的长度不合法')
    return v
  }
}

// 位图:按字节取位,不用 BigInt(十万条域名时差别很明显)。
// 第 i 位在第 i>>6 个 uint64 的第 (i&63) 位,而 uint64 在文件里是大端,
// 所以它落在这个 word 的第 (7 - (i&63)>>3) 个字节上。
// leaves 那张表在写入时只长到最后一个叶子节点,后面的节点可能越界,越界即 0。
const bitAt = (bytes, i) => {
  const idx = (i >> 6) * 8 + (7 - ((i & 63) >> 3))
  if (idx >= bytes.length) return 0
  return (bytes[idx] >> (i & 7)) & 1
}

const POPCNT = new Uint8Array(256)
for (let i = 1; i < 256; i++) POPCNT[i] = POPCNT[i >> 1] + (i & 1)

// rank / select 的预计算:每个 word 之前有多少个 1。
// 没有这张表的话 rank 要从头数,十万条域名会退化成平方级。
const buildRank = (bytes, words) => {
  const table = new Int32Array(words + 1)
  let acc = 0
  for (let w = 0; w < words; w++) {
    table[w] = acc
    for (let k = 0; k < 8; k++) acc += POPCNT[bytes[w * 8 + k]]
  }
  table[words] = acc
  return table
}

// 一个 word 内 [0, bits) 里 1 的个数
const rankInWord = (bytes, base, bits) => {
  let n = 0
  const full = bits >> 3
  for (let k = 0; k < full; k++) n += POPCNT[bytes[base + 7 - k]]
  const rest = bits & 7
  if (rest) n += POPCNT[bytes[base + 7 - full] & ((1 << rest) - 1)]
  return n
}

// [0, i) 里 1 的个数
const rank1 = (bytes, table, i) => {
  const word = i >> 6
  return table[word] + rankInWord(bytes, word * 8, i & 63)
}

// 第 i 个 1(从 0 数起)在哪一位
const select1 = (bytes, table, words, i) => {
  let lo = 0
  let hi = words
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (table[mid] <= i) lo = mid + 1
    else hi = mid
  }
  const word = lo - 1
  if (word < 0) throw new Error('.mrs 位图损坏')
  let n = i - table[word]
  const base = word * 8
  for (let k = 0; k < 8; k++) {
    const byte = bytes[base + 7 - k]
    const c = POPCNT[byte]
    if (n >= c) {
      n -= c
      continue
    }
    for (let b = 0; b < 8; b++) {
      if ((byte >> b) & 1) {
        if (n === 0) return (word << 6) + (k << 3) + b
        n--
      }
    }
  }
  throw new Error('.mrs 位图损坏')
}

// succinct trie → 所有 key(仍是倒着的)
const domainSetKeys = (leaves, bitmapBytes, bitmapWords, labels, onKey) => {
  const ranks = buildRank(bitmapBytes, bitmapWords)
  const key = []
  const traverse = (nodeId, bmIdx) => {
    if (bitAt(leaves, nodeId)) onKey(key)
    for (;;) {
      if (bitAt(bitmapBytes, bmIdx)) return
      key.push(labels[bmIdx - nodeId])
      const nextNodeId = bmIdx + 1 - rank1(bitmapBytes, ranks, bmIdx + 1)
      traverse(nextNodeId, select1(bitmapBytes, ranks, bitmapWords, nextNodeId - 1) + 1)
      key.pop()
      bmIdx++
    }
  }
  traverse(0, 0)
}

const readDomainSet = (r) => {
  if (r.u8() !== 1) throw new Error('.mrs 里的域名表版本不是 1')
  const leavesWords = r.i64()
  const leaves = r.bytes(leavesWords * 8)
  const bitmapWords = r.i64()
  const bitmap = r.bytes(bitmapWords * 8)
  const labels = r.bytes(r.i64())

  const out = []
  const decoder = new TextDecoder()
  domainSetKeys(leaves, bitmap, bitmapWords, labels, (key) => {
    // 存进去时是倒着的,翻回来
    const buf = new Uint8Array(key.length)
    for (let i = 0; i < key.length; i++) buf[i] = key[key.length - 1 - i]
    out.push(decoder.decode(buf))
  })
  return out
}

const ipFromBytes = (b) => {
  // 全是 IPv6 映射形式:::ffff:a.b.c.d 说明本来是 IPv4
  const isV4 = b.every((v, i) => (i < 10 ? v === 0 : i < 12 ? v === 0xff : true))
  if (isV4) return { v4: true, parts: [b[12], b[13], b[14], b[15]] }
  const parts = []
  for (let i = 0; i < 16; i += 2) parts.push((b[i] << 8) | b[i + 1])
  return { v4: false, parts }
}

const ipToString = (ip) => {
  if (ip.v4) return ip.parts.join('.')
  // 压缩最长的一段连续 0(标准写法)
  const hex = ip.parts.map((p) => p.toString(16))
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8; i++) {
    if (ip.parts[i] !== 0) continue
    let j = i
    while (j < 8 && ip.parts[j] === 0) j++
    if (j - i > bestLen) {
      bestLen = j - i
      bestStart = i
    }
    i = j - 1
  }
  if (bestLen < 2) return hex.join(':')
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`
}

const ipToBigInt = (ip) => {
  let v = 0n
  if (ip.v4) for (const p of ip.parts) v = (v << 8n) | BigInt(p)
  else for (const p of ip.parts) v = (v << 16n) | BigInt(p)
  return v
}

const bigIntToIp = (v, v4) => {
  if (v4) return { v4: true, parts: [Number((v >> 24n) & 255n), Number((v >> 16n) & 255n), Number((v >> 8n) & 255n), Number(v & 255n)] }
  const parts = []
  for (let i = 7; i >= 0; i--) parts.push(Number((v >> BigInt(i * 16)) & 0xffffn))
  return { v4: false, parts }
}

// 存的是起止地址,内核要的是 CIDR:把区间拆成最少的若干个前缀
const rangeToCidrs = (fromIp, toIp) => {
  const v4 = fromIp.v4 && toIp.v4
  const bits = v4 ? 32 : 128
  let start = ipToBigInt(fromIp)
  const end = ipToBigInt(toIp)
  const out = []
  while (start <= end) {
    // 这个起点最大能对齐到多大的块
    let size = 0
    while (size < bits) {
      const block = 1n << BigInt(size + 1)
      if (start % block !== 0n || start + block - 1n > end) break
      size++
    }
    out.push(`${ipToString(bigIntToIp(start, v4))}/${bits - size}`)
    start += 1n << BigInt(size)
    if (out.length > 100000) break // 病态输入的护栏
  }
  return out
}

const readIpCidrSet = (r) => {
  if (r.u8() !== 1) throw new Error('.mrs 里的 IP 表版本不是 1')
  const count = r.i64()
  const out = []
  for (let i = 0; i < count; i++) {
    const from = ipFromBytes(r.bytes(16))
    const to = ipFromBytes(r.bytes(16))
    out.push(...rangeToCidrs(from, to))
  }
  return out
}

// 解码已经解压过的 .mrs 内容 → 和 parseRuleList 一样的那五个字段。
// 传进来的必须是 zstd 解压之后的字节(解压放在 system 层,那边才碰得到 node:zlib)。
export const decodeMrs = (payload) => {
  const buf = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
  if (!looksLikeMrs(buf)) throw new Error('不是 .mrs 文件(魔数不对)')
  const r = new Reader(buf)
  r.bytes(4)
  const behavior = r.u8()
  const count = r.i64()
  const extra = r.i64()
  if (extra > 0) r.bytes(extra)

  const out = { domain: [], domain_suffix: [], domain_keyword: [], domain_regex: [], ip_cidr: [] }
  if (behavior === MRS_BEHAVIOR.domain) {
    // mihomo 把一条 `+.example.com` 拆成两个 key 存:`example.com` 和 `+.example.com`
    // (前者管自身,后者管子域)。sing-box 的 domain_suffix 不带点时本来就同时管这两种,
    // 所以带 + 的那条一条顶两条,同名的精确项要去掉,否则十来万条会白白翻一倍。
    const keys = readDomainSet(r)
    const suffixes = new Set()
    for (const key of keys) if (key.startsWith('+.')) suffixes.add(key.slice(2))
    for (const key of keys) {
      if (key.startsWith('+.')) {
        out.domain_suffix.push(key.slice(2))
      } else if (key.includes('*')) {
        // mihomo 的 * 只顶一层,用正则才对得上;这种 key 很少见
        out.domain_regex.push(`^${key.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^.]+')}$`)
      } else if (!suffixes.has(key)) {
        out.domain.push(key)
      }
    }
  } else if (behavior === MRS_BEHAVIOR.ipcidr) {
    out.ip_cidr = readIpCidrSet(r)
  } else {
    throw new Error('这个 .mrs 是 classical 类型,里面没有可直接使用的名单')
  }
  return { behavior, count, parsed: out }
}
