// 第一层 · DNS 转发名单的展开:把转发计划里"要交给内核解析"的规则集(geosite / 规则集链接的域名那份)
// 解码成 dnsmasq 能写的域名,和手写的域名合成最终名单。
//
// 对照关系(dnsmasq 手册 --server:/x/ 按整段标签匹配 x 和 *.x,更具体的优先;/*.x/ 只匹配子域):
//   domain_suffix "x"    → /x/       sing-box 不带点的后缀同样匹配 x 本身和 *.x,语义一致
//   domain_suffix ".x"   → /*.x/     只匹配子域
//   domain "x"           → /x/       dnsmasq 没有"只匹配 x 本身"的写法,子域会一并交给内核——
//                                    内核的 DNS 规则会再精确判一次,不命中的落到内核的直连解析器
//                                    (WAN 上游),不是路由器原来的解析链:这是明确的超集兼容
//   domain_regex         → 能证明"原正则的匹配集合 ⊆ 某几个后缀的覆盖范围"时(regexForwardSuffixes:
//                                    锚定结尾、字面尾巴、标签边界、分支逐一核对),把这些后缀整段交给内核
//                                    (超集,内核里再按正则判);证明不了 → 只能 all(第四轮 T1)
//   domain_keyword       → 表达不了 → all
//   ip_cidr 等 IP 条件   → 解析阶段用不上,忽略
//   逻辑规则 / invert    → 表达不了 → all
// 解码用内核自己的 rule-set decompile(和 api/rulesets.mjs 一样),这里不做扁平化——嵌套 / 取反
// 一旦出现就整体降级,不把它们悄悄当成普通条目。
import { dnsmasqSafeDomain } from '../engine/dns-names.mjs'

const SINGBOX_DNS_UPSTREAM = '127.0.0.1#7853'

// 正则 → dnsmasq 能写的转发后缀(第四轮 T1)。只接受能证明"原正则的匹配集合 ⊆ 转发覆盖范围"的转换:
//   · 顶层按 `|` 拆成各分支,每一分支都必须转换成功,否则整条不支持;
//   · 每一分支必须以 `$` 锚定结尾(不锚定的话 `^ads?\.x\.com` 也匹配 ads.x.com.evil,抠不出后缀);
//   · 从 `$` 往前收字面尾巴:字面字符、`\.` `\-` 这类转义字面、以及"纯字面的分组"((com|net)、(?:www\.)? ——
//     分组按每个选项分叉成多条尾巴);碰到 `.` `\d` `[...]` `*` `+` `{}` 等能匹配任意内容的东西就停;
//   · 停下来的位置必须是标签边界:要么尾巴自己以 `\.` 开头(任何匹配都以 ".x" 结尾 → 转 x),要么尾巴前面
//     就是 `^`(匹配就是这串字面本身 → 转它自己)。`^.*example\.com$` 这种停在 `.*` 后面、尾巴又不带点的,
//     notexample.com 也能匹配,dnsmasq 按标签匹配盖不住 → 不支持;
//   · 转出来的后缀至少两段标签(只剩 TLD 等于半个 all,按不支持处理)。
// dnsmasq 的 /x/ 同时盖住 x 和 *.x,所以转换结果永远是超集(可能多转发,写进 superset 供元数据标明),
// 不可能少转发。任何解析不了的正则(嵌套分组带量词、反向引用、类 …)一律不支持,由调用方降成 all。
const parseRegexAlternatives = (src) => {
  // 只识别转换需要的结构:顶层分支、锚点、字面、转义、分组(可带 ?)、以及"任意内容"占位(其它一切)
  const nodes = []       // 当前分支的节点表
  const alternatives = [] // 已完成的分支
  let i = 0
  const s = String(src)
  let group = null       // 正在读的分组 { alts: [[nodes]], cur: [nodes] }
  const push = (node) => (group ? group.cur : nodes).push(node)
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\') {
      const nx = s[i + 1]
      if (nx === undefined) return null
      if (/[.\-_~:/@]/.test(nx)) push({ t: 'lit', v: nx })            // 字面转义
      else if (/[A-Za-z0-9]/.test(nx)) push({ t: 'any' })              // \d \w \S \b … 元字符类,范围说不清
      else push({ t: 'lit', v: nx })                                    // \\ \$ \| 之类的字面
      i += 2
      continue
    }
    if (ch === '(') {
      if (group) return null                                            // 嵌套分组不处理
      group = { alts: [], cur: [] }
      i += 1
      if (s.startsWith('?:', i)) i += 2
      else if (s[i] === '?') return null                                // 其它 (? 语法(命名组 / 标志)不处理
      continue
    }
    if (ch === ')') {
      if (!group) return null
      group.alts.push(group.cur)
      const g = group
      group = null
      i += 1
      let quant = ''
      if (s[i] === '?') { quant = '?'; i += 1 }
      else if (s[i] === '*' || s[i] === '+' || s[i] === '{') quant = 'many'
      if (quant === 'many') { nodes.push({ t: 'any' }); i += 1; continue }
      // 分组里每个选项都得是纯字面(含 ^ 也算,给 (^|\.) 这种写法)
      if (!g.alts.every((alt) => alt.every((n) => n.t === 'lit' || n.t === 'bol'))) { nodes.push({ t: 'any' }); continue }
      nodes.push({ t: 'group', alts: g.alts, optional: quant === '?' })
      continue
    }
    if (ch === '|') {
      if (group) { group.alts.push(group.cur); group.cur = []; i += 1; continue }
      alternatives.push(nodes.splice(0))
      i += 1
      continue
    }
    if (ch === '^') { push({ t: 'bol' }); i += 1; continue }
    if (ch === '$') { push({ t: 'eol' }); i += 1; continue }
    if (ch === '[') {                                                   // 字符类:内容说不清,整段当任意
      const close = s.indexOf(']', i + 2)
      if (close < 0) return null
      i = close + 1
      push({ t: 'any' })
      continue
    }
    if (ch === '.') { push({ t: 'any' }); i += 1; continue }
    if (ch === '*' || ch === '+' || ch === '?' || ch === '{') {
      // 量词作用在前一个节点上:前一个节点不再是确定的字面
      const target = group ? group.cur : nodes
      if (!target.length) return null
      target[target.length - 1] = { t: 'any' }
      if (ch === '{') {
        const close = s.indexOf('}', i)
        if (close < 0) return null
        i = close + 1
      } else i += 1
      continue
    }
    push({ t: 'lit', v: ch })
    i += 1
  }
  if (group) return null
  alternatives.push(nodes)
  return alternatives
}

// 展开预算(第四轮 U1):一条正则最多分叉出这么多条尾巴 / 这么多字节,超了就当"证明不了"(降 all),不能
// 生成完再截断——`^(a|b){22}\.example\.com$` 这种 126 字符的合法正则理论上 2^22 条尾巴
export const REGEX_TAIL_BUDGET = Object.freeze({ tails: 64, bytes: 8192 })
// 一份规则集里所有正则加起来的条目上限:超了整份不支持
export const RULESET_REGEX_ENTRY_BUDGET = 2048
const BUDGET = Symbol('budget')

// 一个分支的所有可能"字面尾巴"(带边界证明)。返回 null 表示证明不了,BUDGET 表示超过预算
const literalTailsOf = (alt) => {
  if (!alt.length || alt[alt.length - 1].t !== 'eol') return null
  // 从尾巴往前:tails 是若干条"已经收下来的尾巴字符串"(分组分叉)
  let tails = ['']
  let k = alt.length - 2
  for (; k >= 0; k--) {
    const n = alt[k]
    if (n.t === 'lit') { tails = tails.map((t) => n.v + t); continue }
    if (n.t === 'group') {
      // 已经收到的尾巴都以 "." 开头 = 已经到了标签边界,这些尾巴本身就是可证明的超集(任何匹配都以
      // ".x" 结尾),不必再把前面的分组枚举进去——`(a|b)(a|b)…\.example\.com$` 直接得 example.com
      if (tails.length && tails.every((t) => t.startsWith('.'))) break
      const options = n.alts.map((o) => (o.every((x) => x.t === 'lit') ? o.map((x) => x.v).join('') : null))
      if (options.some((o) => o === null)) break                       // 含 ^ 的分组:当边界处理
      // 先算这一组会分叉成多少条,超预算立即终止,不生成
      const count = tails.length * options.length + (n.optional ? tails.length : 0)
      if (count > REGEX_TAIL_BUDGET.tails) return BUDGET
      const next = []
      let bytes = 0
      for (const t of tails) for (const o of options) { const v = o + t; bytes += v.length; next.push(v) }
      if (n.optional) for (const t of tails) { bytes += t.length; next.push(t) }
      if (bytes > REGEX_TAIL_BUDGET.bytes) return BUDGET
      tails = next
      continue
    }
    break
  }
  const stoppedAt = k < 0 ? null : alt[k]
  // 边界:停在开头且开头是 ^(整串就是字面)→ 尾巴按原样;否则尾巴必须以 "." 开头
  const anchoredStart = stoppedAt !== null && stoppedAt.t === 'bol' && k === 0
  const out = []
  for (const t of tails) {
    if (anchoredStart && !t.startsWith('.')) { out.push(t); continue }
    if (!t.startsWith('.')) return null
    out.push(t.slice(1))
  }
  return out
}

// 一条正则 → 转发后缀列表;转不了回 null。导出给单测和元数据用。
// 需要区分"证明不了"和"超过预算"时用 regexForwardSuffixesDetail
export const regexForwardSuffixesDetail = (re) => {
  const alternatives = parseRegexAlternatives(re)
  if (!alternatives) return { suffixes: null, reason: 'unsupported' }
  const out = new Set()
  let total = 0
  for (const alt of alternatives) {
    const tails = literalTailsOf(alt)
    if (tails === BUDGET) return { suffixes: null, reason: 'budget' }
    if (!tails || !tails.length) return { suffixes: null, reason: 'unsupported' }
    total += tails.length
    if (total > REGEX_TAIL_BUDGET.tails) return { suffixes: null, reason: 'budget' }
    for (const t of tails) {
      const safe = dnsmasqSafeDomain(t)
      if (!safe || safe.split('.').length < 2) return { suffixes: null, reason: 'unsupported' }
      out.add(safe)
    }
  }
  return out.size ? { suffixes: [...out], reason: '' } : { suffixes: null, reason: 'unsupported' }
}
export const regexForwardSuffixes = (re) => regexForwardSuffixesDetail(re).suffixes

// 兼容旧名字:单后缀的情况和以前一样,多分支时回第一个(调用方应改用 regexForwardSuffixes)
export const regexLiteralSuffix = (re) => {
  const list = regexForwardSuffixes(re)
  return list ? list[0] : null
}

// 一份解码后的规则集 → dnsmasq 条目(带 *. 前缀表示只匹配子域)。返回 { entries, superset, unsupported }
export const ruleSetToForwardEntries = (json) => {
  const entries = new Set()
  const superset = []
  let regexEntries = 0
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
      const { suffixes, reason } = regexForwardSuffixesDetail(re)
      if (!suffixes) {
        return { entries: [], superset: [], unsupported: reason === 'budget' ? `含分支组合超过预算(${REGEX_TAIL_BUDGET.tails} 条)的正则(${String(re).slice(0, 60)})` : `含无法证明安全转换的正则(${String(re).slice(0, 60)})` }
      }
      regexEntries += suffixes.length
      if (regexEntries > RULESET_REGEX_ENTRY_BUDGET) return { entries: [], superset: [], unsupported: `正则展开的条目累计超过预算(${RULESET_REGEX_ENTRY_BUDGET})` }
      for (const suffix of suffixes) {
        entries.add(suffix)
        superset.push({ regex: String(re), suffix })
      }
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
