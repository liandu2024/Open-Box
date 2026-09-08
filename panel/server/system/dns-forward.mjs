// 第一层 · DNS 转发名单的展开:把转发计划里"要交给内核解析"的规则集(geosite / 规则集链接的域名那份)
// 解码成 dnsmasq 能写的域名,和手写的域名合成最终名单。
//
// 对照关系(dnsmasq 手册 --server:/x/ 按整段标签匹配 x 和 *.x,更具体的优先;/*.x/ 只匹配子域):
//   domain_suffix "x"    → /x/       sing-box 不带点的后缀同样匹配 x 本身和 *.x,语义一致
//   domain_suffix ".x"   → /*.x/     只匹配子域
//   domain "x"           → /x/       dnsmasq 没有"只匹配 x 本身"的写法,子域会一并交给内核——
//                                    内核的 DNS 规则会再精确判一次,不命中的落到内核的直连解析器
//                                    (WAN 上游),不是路由器原来的解析链:这是明确的超集兼容
//   domain_regex         → 正则末尾能抠出一段字面后缀(…\.googlevideo\.com$ → googlevideo.com)就把
//                                    这段后缀整段交给内核(超集,内核里再按正则判);抠不出来 → 只能 all
//   domain_keyword       → 表达不了 → all
//   ip_cidr 等 IP 条件   → 解析阶段用不上,忽略
//   逻辑规则 / invert    → 表达不了 → all
// 解码用内核自己的 rule-set decompile(和 api/rulesets.mjs 一样),这里不做扁平化——嵌套 / 取反
// 一旦出现就整体降级,不把它们悄悄当成普通条目。
import { dnsmasqSafeDomain } from '../engine/dns-names.mjs'

const SINGBOX_DNS_UPSTREAM = '127.0.0.1#7853'

// 正则末尾的字面后缀:从 `$` 往前收 `\.` 和 [a-z0-9-],碰到别的元字符就停。至少两段标签才算数
export const regexLiteralSuffix = (re) => {
  const s = String(re || '')
  if (!s.endsWith('$')) return null
  let i = s.length - 1
  let out = ''
  while (i > 0) {
    if (s[i - 1] === '.' && i >= 2 && s[i - 2] === '\\') { out = `.${out}`; i -= 2; continue }
    if (/[a-z0-9-]/i.test(s[i - 1])) { out = s[i - 1] + out; i -= 1; continue }
    break
  }
  const trimmed = out.replace(/^\./, '').toLowerCase()
  return trimmed.split('.').filter(Boolean).length >= 2 ? trimmed : null
}

// 一份解码后的规则集 → dnsmasq 条目(带 *. 前缀表示只匹配子域)。返回 { entries, superset, unsupported }
export const ruleSetToForwardEntries = (json) => {
  const entries = new Set()
  const superset = []
  const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
  for (const rule of (json && json.rules) || []) {
    if (!rule || typeof rule !== 'object') continue
    if (rule.type === 'logical' || rule.rules || rule.invert) return { entries: [], superset: [], unsupported: '含逻辑 / 取反规则' }
    if (list(rule.domain_keyword).length) return { entries: [], superset: [], unsupported: `含域名关键词(${list(rule.domain_keyword).slice(0, 3).join(', ')})` }
    for (const d of list(rule.domain)) {
      const safe = dnsmasqSafeDomain(d)
      if (safe) entries.add(safe)
    }
    for (const d of list(rule.domain_suffix)) {
      const raw = String(d)
      const safe = dnsmasqSafeDomain(raw)
      if (!safe) continue
      entries.add(raw.startsWith('.') ? `*.${safe}` : safe)
    }
    for (const re of list(rule.domain_regex)) {
      const suffix = regexLiteralSuffix(re)
      if (!suffix) return { entries: [], superset: [], unsupported: `含无法抠出字面后缀的正则(${String(re).slice(0, 60)})` }
      entries.add(suffix)
      superset.push({ regex: String(re), suffix })
    }
  }
  return { entries: [...entries], superset, unsupported: '' }
}

// 解码一份 .srs:交给内核 decompile 到临时文件再读。文件不在 / 解不开都当"这份规则集不可用"
export const decodeRuleSetJson = async (ctx, paths, tag) => {
  const srsPath = `${paths.rulesetDir}/${tag}.srs`
  if (!(await ctx.exists(srsPath))) return { error: '本地没有这份规则集文件' }
  const jsonPath = `${paths.dataDir}/tmp/${tag}.dns-forward.json`
  await ctx.mkdirp(`${paths.dataDir}/tmp`)
  const r = await ctx.exec(paths.singbox, ['rule-set', 'decompile', '--output', jsonPath, srsPath])
  if (r.code !== 0) return { error: `解码失败:${String(r.stderr || '').trim() || `exit ${r.code}`}` }
  try {
    return { json: JSON.parse(await ctx.readFile(jsonPath)) }
  } catch (err) {
    return { error: `解码结果读不出来:${err instanceof Error ? err.message : String(err)}` }
  } finally {
    try { await ctx.remove(jsonPath) } catch { /* 临时文件,删不掉不影响 */ }
  }
}

// 把计划展开成最终名单。plan.mode 不是 domains、或没有要展开的规则集,原样返回。
// 任何一份规则集展不开(关键词 / 逻辑 / 抠不出后缀的正则 / 文件缺失)→ 整个计划降成 all,原因写明:
// 少转发一份名单 = 那些域名走代理却在原上游解析(拿到污染 / fake-ip 的地址),比全量交给内核更糟
export const expandDnsForward = async (ctx, paths, plan) => {
  if (!plan || plan.mode !== 'domains' || !Array.isArray(plan.expand) || !plan.expand.length) {
    return { ...plan, expand: [], expanded: [], superset: [] }
  }
  const domains = new Set(plan.domains || [])
  const expanded = []
  const superset = []
  const seen = new Set()
  for (const { tag, owner } of plan.expand) {
    if (seen.has(tag)) continue
    seen.add(tag)
    const decoded = await decodeRuleSetJson(ctx, paths, tag)
    if (decoded.error) return { mode: 'all', domains: [], expand: [], expanded, superset, reason: `${owner}的规则集「${tag}」${decoded.error},dnsmasq 名单展不开` }
    const r = ruleSetToForwardEntries(decoded.json)
    if (r.unsupported) return { mode: 'all', domains: [], expand: [], expanded, superset, reason: `${owner}的规则集「${tag}」${r.unsupported},dnsmasq 展不开` }
    for (const e of r.entries) domains.add(e)
    for (const s of r.superset) superset.push({ tag, ...s })
    expanded.push({ tag, count: r.entries.length })
  }
  return { mode: 'domains', domains: [...domains], expand: [], expanded, superset, reason: '' }
}

// dnsmasq 转发文件的正文:一行一条,`*.x` 的写法照搬(dnsmasq 用同样的记法表示只匹配子域)
export const forwardConfText = (domains) => {
  const lines = ['# Open-Box:走代理的域名交给内核解析(127.0.0.1#7853),其余由路由器原有上游解析。由 Open-Box 生成,勿手改']
  for (const d of [...new Set(domains)].sort()) lines.push(`server=/${d}/${SINGBOX_DNS_UPSTREAM}`)
  return `${lines.join('\n')}\n`
}
