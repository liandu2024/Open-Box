// 入口原生旁路的第二步:纯函数 nativeBypassPlan(engine/routing-model.mjs)在 FakeIP 下会留下 pending——
// "这个直连站点集的 geoip 集合,和前面某条带 IP 条件的代理 / 拒绝规则可不可能命中同一个地址"。
// 这里把两边的集合都解码成 CIDR,做区间重叠核对:没有交集才允许旁路;有交集、或者对方是形状未知的
// 规则集链接,就把这个候选按兼容路径处理(进内核由 direct 出站连)并写明原因。
// 不做"从候选集合里扣掉重叠部分再旁路":route_exclude_address_set 只认整份规则集,扣过的集合得另编
// 一份 .srs,这一步先不做——宁可少旁路,不能错旁路。
import { decodeRuleSetJson } from './dns-forward.mjs'
import { parseCidr } from './local-subnets.mjs'

const V4_BITS = 32n
const V6_BITS = 128n
const rangeOf = (c) => {
  const p = parseCidr(c)
  if (!p) return null
  const bits = p.family === 4 ? V4_BITS : V6_BITS
  const size = 1n << (bits - BigInt(p.prefix))
  return { family: p.family, start: p.net, end: p.net + size - 1n }
}
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
const formatRange = (r) => (r.family === 4 ? `${[24, 16, 8, 0].map((s) => Number((r.start >> BigInt(s)) & 255n)).join('.')}…` : `${r.start.toString(16).slice(0, 8)}…`)

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
// 一份规则集里的 IP 段(只认 ip_cidr;逻辑 / 取反规则说不清范围,按"可能覆盖任何地址"处理)
const cidrsOfRuleSet = (json) => {
  const out = []
  for (const rule of (json && json.rules) || []) {
    if (!rule || typeof rule !== 'object') continue
    if (rule.type === 'logical' || rule.rules || rule.invert) return { cidrs: [], unbounded: true }
    out.push(...list(rule.ip_cidr))
  }
  return { cidrs: out, unbounded: false }
}

export const resolveNativeBypass = async (ctx, paths, plan) => {
  if (!plan || !Array.isArray(plan.pending) || !plan.pending.length) return { ...plan, pending: [], checked: [] }
  const cache = new Map()
  const decode = async (tag) => {
    if (cache.has(tag)) return cache.get(tag)
    const r = await decodeRuleSetJson(ctx, paths, tag)
    const v = r.error ? { error: r.error } : cidrsOfRuleSet(r.json)
    cache.set(tag, v)
    return v
  }
  const sets = [...plan.sets]
  const checked = []
  const reasons = plan.reason ? [plan.reason] : []
  for (const item of plan.pending) {
    let candidate = []
    let blocked = ''
    for (const tag of item.sets) {
      const d = await decode(tag)
      if (d.error) { blocked = `候选集合「${tag}」${d.error}`; break }
      if (d.unbounded) { blocked = `候选集合「${tag}」含逻辑 / 取反规则,范围说不清`; break }
      candidate.push(...d.cidrs)
    }
    for (const e of blocked ? [] : item.against) {
      if (e.lists && e.lists.length) { blocked = `「${e.name}」用了规则集链接「${e.lists[0]}」,里面有没有 IP 段说不清`; break }
      const other = [...(e.cidrs || [])]
      for (const tag of e.geoip || []) {
        const d = await decode(tag)
        if (d.error) { blocked = `「${e.name}」的集合「${tag}」${d.error}`; break }
        if (d.unbounded) { blocked = `「${e.name}」的集合「${tag}」含逻辑 / 取反规则,范围说不清`; break }
        other.push(...d.cidrs)
      }
      if (blocked) break
      const hit = cidrListsOverlap(candidate, other)
      if (hit) { blocked = `和前面「${e.name}」的 IP 范围有重叠(${hit})`; break }
    }
    checked.push({ policy: item.policy, sets: item.sets, ok: !blocked, reason: blocked })
    if (blocked) reasons.push(`站点集「${item.policy}」${blocked},按兼容路径进内核`)
    else for (const tag of item.sets) if (!sets.includes(tag)) sets.push(tag)
  }
  return { enabled: sets.length > 0, sets, pending: [], checked, reason: reasons.join(';') }
}
