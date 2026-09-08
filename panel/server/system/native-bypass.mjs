// 入口原生旁路的第二步(部署时):纯函数 nativeBypassPlan(engine/routing-model.mjs)给出候选集合和 pending
// ("这个直连集合要和前面哪些带 IP 条件的规则核对重叠")。这里把每一份候选集合都解码成 CIDR 做内容校验,
// 再对 pending 做区间重叠核对:
//   · 含逻辑 / 取反规则的集合范围说不清 → 不旁路;
//   · 含"一直到地址空间末尾"区间的集合(240.0.0.0/4、ff00::/8 之类)→ 不旁路:sing-tun 1.13.14 把区间写成
//     [起点, 终点+1),终点+1 溢出后用起点当终点键,和别的区间同在集合里就 EEXIST、auto_redirect 起不来
//     (开发路由器实测)。按范围判,不按集合名字;
//   · FakeIP 试验开着时,集合和占位地址池(198.18.0.0/15 / fc00::/18)有交集 → 不旁路:占位地址进了直连
//     集合会在入口先被放走,后面的域名规则没机会执行(第四轮 T4);
//   · pending:和前面任何一条带 IP 条件规则的范围有交集 → 不旁路,原因写明谁和谁重叠。
// 不做"从候选集合里扣掉重叠部分再旁路":route_exclude_address_set 只认整份规则集,扣过的集合得另编
// 一份 .srs,这一步先不做——宁可少旁路,不能错旁路。
import { decodeRuleSetJson } from './dns-forward.mjs'
import { parseCidr } from './local-subnets.mjs'
import { FAKEIP_V4, FAKEIP_V6 } from '../engine/dns.mjs'

const V4_BITS = 32n
const V6_BITS = 128n
const MAX = { 4: (1n << V4_BITS) - 1n, 6: (1n << V6_BITS) - 1n }
const rangeOf = (c) => {
  const p = parseCidr(c)
  if (!p) return null
  const bits = p.family === 4 ? V4_BITS : V6_BITS
  const size = 1n << (bits - BigInt(p.prefix))
  return { family: p.family, start: p.net, end: p.net + size - 1n, cidr: c }
}
const formatRange = (r) => (r.family === 4 ? `${[24, 16, 8, 0].map((s) => Number((r.start >> BigInt(s)) & 255n)).join('.')}…` : `${r.start.toString(16).slice(0, 8)}…`)
// 两组 CIDR 有没有交集:按起点排序后扫一遍
export const cidrListsOverlap = (a, b) => {
  const ra = a.map(rangeOf).filter(Boolean)
  const rb = b.map(rangeOf).filter(Boolean)
  for (const family of [4, 6]) {
    const xs = ra.filter((r) => r.family === family).sort((p, q) => (p.start < q.start ? -1 : 1))
    const ys = rb.filter((r) => r.family === family).sort((p, q) => (p.start < q.start ? -1 : 1))
    let i = 0
    let j = 0
    while (i < xs.length && j < ys.length) {
      const x = xs[i]
      const y = ys[j]
      if (x.end < y.start) i++
      else if (y.end < x.start) j++
      else return `${formatRange(x)} × ${formatRange(y)}`
    }
  }
  return ''
}
// 有没有区间一直到地址空间末尾(sing-tun 编不进 nft 集合)
export const reachesEndOfSpace = (cidrs) => {
  for (const c of cidrs) {
    const r = rangeOf(c)
    if (r && r.end === MAX[r.family]) return String(c)
  }
  return ''
}

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
const DOMAIN_KEYS = ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex']
// 一份规则集的内容形状(第四轮 U2)。入口旁路只认"仅目标 IP"的规则:sing-tun 从规则集里提取地址集合时
// 只取 ip_cidr,不带 port / source_ip_cidr / network 这些附加条件,整份拿去入口旁路就会把"只对 443 端口 /
// 只对某个来源直连"放大成全部直连。所以:
//   cidrs        规则里的 ip_cidr
//   unbounded    含逻辑 / 取反规则,范围说不清
//   domainKeys   含域名类条件(按内容认,不看集合叫不叫 geoip-*)
//   otherKeys    含 port / source_ip_cidr / network / process 等其它条件
const shapeOfRuleSet = (json) => {
  const out = { cidrs: [], unbounded: false, domainKeys: [], otherKeys: [] }
  for (const rule of (json && json.rules) || []) {
    if (!rule || typeof rule !== 'object') continue
    if (rule.type === 'logical' || rule.rules || rule.invert) { out.unbounded = true; continue }
    for (const key of Object.keys(rule)) {
      if (key === 'ip_cidr' || key === 'type') continue
      if (DOMAIN_KEYS.includes(key)) { if (!out.domainKeys.includes(key)) out.domainKeys.push(key) } else if (!out.otherKeys.includes(key)) out.otherKeys.push(key)
    }
    out.cidrs.push(...list(rule.ip_cidr))
  }
  return out
}

export const resolveNativeBypass = async (ctx, paths, plan) => {
  const base = { enabled: false, sets: [], pending: [], fakeIp: Boolean(plan && plan.fakeIp), checked: [], reason: (plan && plan.reason) || '' }
  if (!plan || typeof plan !== 'object') return base
  const candidates = [
    ...list(plan.sets).map((tag) => ({ policy: '', sets: [tag], against: [] })),
    ...list(plan.pending),
  ]
  if (!candidates.length) return base
  const cache = new Map()
  const decode = async (tag) => {
    if (cache.has(tag)) return cache.get(tag)
    const r = await decodeRuleSetJson(ctx, paths, tag)
    const v = r.error ? { error: r.error } : shapeOfRuleSet(r.json)
    cache.set(tag, v)
    return v
  }
  const sets = []
  const checked = []
  const reasons = plan.reason ? [plan.reason] : []
  for (const item of candidates) {
    const candidate = []
    let blocked = ''
    for (const tag of list(item.sets)) {
      const d = await decode(tag)
      if (d.error) { blocked = `集合「${tag}」${d.error}`; break }
      if (d.unbounded) { blocked = `集合「${tag}」含逻辑 / 取反规则,范围说不清`; break }
      // 候选集合必须是"仅目标 IP":带域名 / 端口 / 来源等条件的规则,入口只按 IP 放行会放大直连范围
      if (d.domainKeys.length || d.otherKeys.length) { blocked = `集合「${tag}」不是纯目标 IP 规则(含 ${[...d.domainKeys, ...d.otherKeys].join(' / ')} 条件),入口只按 IP 放行会放大它的范围`; break }
      if (!d.cidrs.length) { blocked = `集合「${tag}」里没有 ip_cidr`; break }
      const tail = reachesEndOfSpace(d.cidrs)
      if (tail) { blocked = `集合「${tag}」含到地址空间末尾的区间(${tail}),sing-tun 编不进 nft 集合`; break }
      if (plan.fakeIp) {
        const hit = cidrListsOverlap(d.cidrs, [FAKEIP_V4, FAKEIP_V6])
        if (hit) { blocked = `集合「${tag}」和 FakeIP 占位地址池有交集(${hit}),占位地址会在入口被放走`; break }
      }
      candidate.push(...d.cidrs)
    }
    for (const e of blocked ? [] : list(item.against)) {
      if (e.lists && e.lists.length) { blocked = `「${e.name}」用了规则集链接「${e.lists[0]}」,里面有没有 IP 段说不清`; break }
      const other = [...list(e.cidrs)]
      for (const tag of list(e.geoip)) {
        const d = await decode(tag)
        if (d.error) { blocked = `「${e.name}」的集合「${tag}」${d.error}`; break }
        if (d.unbounded) { blocked = `「${e.name}」的集合「${tag}」含逻辑 / 取反规则,范围说不清`; break }
        // 较早规则的集合按内容认:里面有域名条件,它就是一条域名规则,解析出来的 IP 在入口分不出来 → 挡住
        if (d.domainKeys.length) { blocked = `「${e.name}」的集合「${tag}」含域名条件(${d.domainKeys.join(' / ')}),它解析出来的 IP 在入口分不出来`; break }
        // 端口 / 来源等附加条件只会让较早规则更窄:仍按它的 IP 段核对重叠(保守)
        other.push(...d.cidrs)
      }
      if (blocked) break
      const hit = cidrListsOverlap(candidate, other)
      if (hit) { blocked = `和前面「${e.name}」的 IP 范围有重叠(${hit})`; break }
    }
    checked.push({ policy: item.policy || '', sets: list(item.sets), ok: !blocked, reason: blocked })
    if (blocked) reasons.push(`${item.policy ? `站点集「${item.policy}」` : ''}${blocked},按兼容路径进内核`)
    else for (const tag of list(item.sets)) if (!sets.includes(tag)) sets.push(tag)
  }
  return { enabled: sets.length > 0, sets, pending: [], fakeIp: Boolean(plan.fakeIp), checked, reason: reasons.join(';') }
}
