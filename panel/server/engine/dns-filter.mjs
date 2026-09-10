import { createHash } from 'node:crypto'
import { domainToASCII } from 'node:url'

export const DNS_FILTER_DEFAULT = { enabled: false, lists: [{ id: 'anti-ad', name: 'anti-AD', url: 'https://anti-ad.net/easylist.txt', enabled: true }], allowDomains: [] }
export const DNS_FILTER_RUNTIME = 'openbox/dns-filter-runtime'
export const filterSettings = (profile) => ({ ...structuredClone(DNS_FILTER_DEFAULT), ...profile?.dns?.filter })
export const filterKey = (settings) => createHash('sha256').update(JSON.stringify(settings)).digest('hex').slice(0, 16)
export const filterForwardPlan = (profile, plan) => profile?.dns?.filter?.enabled
  ? { mode: 'all', domains: [], reason: '域名过滤已开启:DNS 查询统一交给内核检查,通过后仍按原 DNS 策略解析' }
  : plan

const domainName = (value) => {
  if (typeof value !== 'string' || !/^[\p{L}\p{N}_.-]+$/u.test(value)) return ''
  const name = domainToASCII(value.toLowerCase().replace(/\.$/, ''))
  return name.length <= 253 && name.includes('.') && name.split('.').every((s) => /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(s)) ? name : ''
}
export const allowDomainCondition = (value) => {
  const wildcard = value.startsWith('*.')
  const name = domainName(wildcard ? value.slice(2) : value)
  if (!name) throw new Error(`无效的域名: ${value}`)
  return wildcard ? { domain_regex: [`^.+\\.${name.replaceAll('.', '\\.')}$`] } : { domain: [name] }
}
export const validateDnsFilter = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'dns.filter must be an object'
  if (typeof value.enabled !== 'boolean') return 'dns.filter.enabled must be a boolean'
  if (!Array.isArray(value.lists) || value.lists.length > 8) return '最多添加 8 份过滤名单'
  const ids = new Set()
  for (const list of value.lists) {
    if (!list || !/^[a-zA-Z0-9_-]{1,40}$/.test(list.id) || ids.has(list.id)) return '过滤名单 id 无效或重复'
    ids.add(list.id)
    if (typeof list.name !== 'string' || !list.name.trim() || list.name.length > 80) return '请填写名单名称(最多 80 字)'
    if (typeof list.enabled !== 'boolean') return '名单 enabled 必须是布尔值'
    try {
      const url = new URL(list.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || list.url.length > 2048) throw new Error()
    } catch { return '名单地址必须是 HTTP / HTTPS 网址,且不能包含用户名或密码' }
  }
  if (!Array.isArray(value.allowDomains) || value.allowDomains.length > 500) return '最多添加 500 条放行域名'
  try { for (const name of value.allowDomains) allowDomainCondition(name) } catch { return '放行域名应为 example.com 或 *.example.com' }
  return null
}

const and = (rules) => rules.length === 1 ? rules[0] : { type: 'logical', mode: 'and', rules }
const TYPES = new Set('A AAAA CNAME HTTPS SVCB MX TXT PTR NS SOA SRV CAA DNSKEY DS RRSIG NAPTR ANY'.split(' '))
const escapeRegex = (v) => v.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

// Only DNS syntax: cosmetic / URL-path / unknown modifiers are counted as unsupported.
// Downloaded regular expressions are compiled by sing-box (RE2), never evaluated in Node's request loop.
export const parseDnsFilter = (body, { collectEntries = false } = {}) => {
  const groups = new Map()
  const entries = collectEntries ? [] : null
  const unsupportedExamples = []
  let count = 0, unsupported = 0, regexCount = 0
  for (let line of body.split(/\r?\n/)) {
    line = line.trim()
    if (!line || line.startsWith('!') || line.startsWith('#') || line.startsWith('[')) continue
    const original = line
    try {
      if (line.length > 4096 || count > 250000) throw new Error()
      const allow = line.startsWith('@@')
      if (allow) line = line.slice(2)
      let modifiers = ''
      if (line.startsWith('/')) {
        const end = line.lastIndexOf('/')
        if (end <= 0 || (line.slice(end + 1) && line[end + 1] !== '$')) throw new Error()
        modifiers = line.slice(end + 2)
        line = line.slice(0, end + 1)
      } else if (line.includes('$')) {
        const at = line.indexOf('$')
        modifiers = line.slice(at + 1)
        line = line.slice(0, at)
      }
      let important = false
      const extra = []
      for (const modifier of modifiers.split(',').filter(Boolean)) {
        if (modifier === 'important') { important = true; continue }
        const [key, value] = modifier.split('=')
        if (key === 'dnstype' && value) {
          const types = value.toUpperCase().split('|')
          const negative = types[0].startsWith('~')
          if (!types.every((t) => t.startsWith('~') === negative && TYPES.has(t.replace(/^~/, '')))) throw new Error()
          extra.push({ query_type: types.map((t) => t.replace(/^~/, '')), ...(negative ? { invert: true } : {}) })
        } else if (key === 'denyallow' && value) {
          const names = value.split('|').map(domainName)
          if (names.some((n) => !n)) throw new Error()
          extra.push({ domain_suffix: names, invert: true })
        } else if (!(key === 'dnsrewrite' && ['0.0.0.0', '::'].includes(value))) throw new Error()
      }
      const conditions = []
      if (line.startsWith('/') && line.endsWith('/')) {
        if (++regexCount > 2048) throw new Error()
        conditions.push({ domain_regex: [line.slice(1, -1)] })
      } else if (/^(0\.0\.0\.0|127\.0\.0\.1|::)\s/.test(line)) {
        const names = line.split('#')[0].trim().split(/\s+/).slice(1).map(domainName)
        if (!names.length || names.some((n) => !n)) throw new Error()
        conditions.push({ domain: names })
      } else {
        const suffix = line.startsWith('||')
        const exact = !suffix && line.startsWith('|')
        line = line.replace(/^\|\|?/, '').replace(/[\^|]$/, '')
        if (line.includes('*')) {
          if (!suffix || !/^[a-zA-Z0-9_.*-]+$/.test(line) || ++regexCount > 2048) throw new Error()
          conditions.push({ domain_regex: [`^(?:.+\\.)?${escapeRegex(line.toLowerCase()).replaceAll('*', '.*')}$`] })
        } else {
          const name = domainName(line)
          if (!name) throw new Error()
          conditions.push({ [suffix && !exact ? 'domain_suffix' : 'domain']: [name] })
        }
      }
      const kind = `${allow ? 'allow' : 'block'}${important ? 'Important' : ''}`
      const key = JSON.stringify([kind, extra])
      if (!groups.has(key)) groups.set(key, { kind, extra, match: {} })
      const group = groups.get(key)
      for (const condition of conditions) for (const [field, values] of Object.entries(condition)) (group.match[field] ||= []).push(...values)
      if (entries) for (const condition of conditions) for (const [type, values] of Object.entries(condition)) {
        for (const value of values) entries.push({ type, value, rule: original, action: allow ? 'allow' : 'block', important, conditional: extra.length > 0 })
      }
      count++
    } catch {
      unsupported++
      if (unsupportedExamples.length < 5) unsupportedExamples.push(original.slice(0, 200))
    }
  }
  const rules = { block: [], allow: [], blockImportant: [], allowImportant: [] }
  for (const { kind, extra, match } of groups.values()) {
    for (const field of Object.keys(match)) match[field] = [...new Set(match[field])]
    rules[kind].push(and([match, ...extra]))
  }
  return { rules, count, unsupported, unsupportedExamples, ...(entries ? { entries } : {}) }
}

export const buildFilterConfig = (profile, artifact) => {
  if (!profile?.dns?.filter?.enabled) return { rules: [], sets: [] }
  if (!artifact || artifact.key !== filterKey(filterSettings(profile))) throw new Error('域名过滤名单尚未准备好,请更新名单后应用 DNS 设置')
  const { sets = [], blocks = [], allow = [], allowImportant = [], userAllow = [] } = artifact
  const rules = []
  for (const important of [true, false]) for (const block of blocks.filter((b) => b.important === important)) {
    const excluded = [...userAllow, ...allowImportant, ...(important ? [] : allow)]
    rules.push({ ...and([{ rule_set: [block.tag] }, ...(excluded.length ? [{ rule_set: excluded, invert: true }] : [])]), action: 'predefined', rcode: 'NXDOMAIN' })
  }
  return { rules, sets }
}
