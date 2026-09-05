// 「规则集链接」:站点集里可以直接引用一个网址,把那份现成的域名 / IP 名单当规则用,
// 比如 https://raw.githubusercontent.com/liandu2024/clash/main/list/Check.list
//
// 内核只认编译好的 .srs,所以这份名单要在部署时下回来、解析、编成 .srs(见
// system/rule-lists.mjs)。本文件只管两件不碰外部世界的事:URL → 规则集名字,和
// 文本 → 结构化条件。放在 engine 是因为生成配置时要凭 URL 算出同一个名字,那一步是纯函数。

// 名字要能当文件名和 sing-box 的 tag 用(见 system/rulesets.mjs 的 SAFE_TAG),所以取
// URL 的 FNV-1a 哈希写成 8 位十六进制。同一个 URL 永远算出同一个名字,换了 URL 就是
// 另一个规则集,旧的那个文件下次部署自然不再被引用。
export const RULE_LIST_PREFIX = 'list-'

export const listTagForUrl = (url) => {
  const s = String(url || '').trim()
  if (!s) return ''
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${RULE_LIST_PREFIX}${h.toString(16).padStart(8, '0')}`
}

export const isRuleListTag = (tag) => typeof tag === 'string' && tag.startsWith(RULE_LIST_PREFIX)

// 一份名单编成两份 .srs:域名那份叫 list-xxxxxxxx.srs,IP 那份叫 list-xxxxxxxx-ip.srs。
// 为什么要拆:DNS 规则只能引用纯域名的规则集。规则集里一旦有 ip_cidr,sing-box 就把这条
// DNS 规则当成"要看解析结果才知道命不命中"——对每个路过的域名都先用这条规则的服务器查一遍,
// 结果 IP 不在集合里再扔掉、换下一条重查(正式路由器上实测:一次查询在 browserleaks 显示
// 两个出口)。路由规则没这个问题,两份都引用;DNS 规则只引用域名那份(见 routing-model.mjs)。
export const RULE_LIST_IP_SUFFIX = '-ip'
export const ruleListIpTag = (tag) => `${tag}${RULE_LIST_IP_SUFFIX}`

const DOMAIN_KINDS = ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex']
export const splitRuleList = (parsed) => ({
  domains: Object.fromEntries(DOMAIN_KINDS.map((k) => [k, parsed[k] || []])),
  ips: { ip_cidr: parsed.ip_cidr || [] },
})

// 由每类条数得出"这份名单有没有域名那份 / IP 那份"。counts 是 system/rule-lists.mjs 记在
// rule-lists.json 里的;生成配置时凭它决定引用哪几份 .srs。
export const ruleListShape = (counts) => {
  const c = counts && typeof counts === 'object' ? counts : {}
  return {
    domain: DOMAIN_KINDS.some((k) => Number(c[k]) > 0),
    ip: Number(c.ip_cidr) > 0,
  }
}

const isIpLike = (v) => /^[0-9.]+(\/\d{1,2})?$/.test(v) || (v.includes(':') && /^[0-9a-f:.]+(\/\d{1,3})?$/i.test(v))
// 裸 IP 补成单机掩码:名单里写 1.2.3.4 的意思就是这一个地址
const toCidr = (v) => (v.includes('/') ? v : `${v}/${v.includes(':') ? 128 : 32}`)

// Clash 的规则行:类型,值[,附加参数]。只收和「匹配什么目标」有关的那几种,
// PROCESS-NAME / RULE-SET / GEOIP / MATCH 这些要么和目标无关、要么得再解析一层,跳过。
const CLASH_TYPES = {
  'DOMAIN': 'domain',
  'DOMAIN-SUFFIX': 'domain_suffix',
  'DOMAIN-KEYWORD': 'domain_keyword',
  'DOMAIN-REGEX': 'domain_regex',
  'HOST': 'domain',
  'HOST-SUFFIX': 'domain_suffix',
  'HOST-KEYWORD': 'domain_keyword',
  'IP-CIDR': 'ip_cidr',
  'IP-CIDR6': 'ip_cidr',
  'IP6-CIDR': 'ip_cidr',
  'SRC-IP-CIDR': 'ip_cidr',
}

// 文本 → { domain, domain_suffix, domain_keyword, domain_regex, ip_cidr }。
// 两种写法都吃:
//   · Clash 规则行     DOMAIN-SUFFIX,example.com  /  IP-CIDR,1.2.3.0/24,no-resolve
//   · 一行一个的裸名单  example.com  /  +.example.com  /  1.2.3.0/24
// 裸域名按「域名后缀」算(它和它的子域):一行 example.com 的名单,用户的意思几乎总是
// 连 www.example.com 一起管。要精确匹配就写 Clash 那种 DOMAIN, 前缀。
export const parseRuleList = (text) => {
  const out = { domain: [], domain_suffix: [], domain_keyword: [], domain_regex: [], ip_cidr: [] }
  const seen = new Set()
  const push = (kind, value) => {
    const v = value.trim()
    if (!v) return
    const key = `${kind} ${v}`
    if (seen.has(key)) return
    seen.add(key)
    out[kind].push(v)
  }
  for (const raw of String(text || '').split(/\r?\n/)) {
    // 注释:# 和 ; 开头,以及 payload: / - 这种 yaml 列表的装饰
    let line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) continue
    if (line === 'payload:') continue
    if (line.startsWith('- ')) line = line.slice(2).trim()
    line = line.replace(/^['"]|['"]$/g, '').trim()
    if (!line) continue

    const parts = line.split(',').map((p) => p.trim())
    const kind = CLASH_TYPES[parts[0].toUpperCase()]
    if (kind && parts.length >= 2) {
      push(kind, kind === 'ip_cidr' ? toCidr(parts[1]) : parts[1])
      continue
    }
    // 不认识的 Clash 类型(PROCESS-NAME、RULE-SET、GEOIP、MATCH…)整行跳过,
    // 别把 "MATCH" 当成一个域名收进来
    if (parts.length >= 2 && /^[A-Z][A-Z0-9-]*$/.test(parts[0])) continue

    if (isIpLike(line)) push('ip_cidr', toCidr(line))
    else if (line.startsWith('+.')) push('domain_suffix', line.slice(2))
    else if (line.startsWith('.')) push('domain_suffix', line.slice(1))
    else if (/^[a-z0-9*_-]+(\.[a-z0-9*_-]+)+$/i.test(line)) push('domain_suffix', line)
    // 其余(带空格、带路径的行)当噪音丢掉
  }
  return out
}

export const ruleListIsEmpty = (parsed) => Object.values(parsed).every((list) => !list.length)

// sing-box 的规则集源格式(rule-set compile 的输入)。一条 headless rule 里各字段是「或」,
// 正好对应「这份名单里的任意一条命中即算命中」。
export const ruleListToSource = (parsed) => {
  const rule = {}
  for (const [k, v] of Object.entries(parsed)) if (v.length) rule[k] = v
  return { version: 3, rules: Object.keys(rule).length ? [rule] : [] }
}
