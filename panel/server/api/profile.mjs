import express from 'express'
import { validateDnsFilter } from '../engine/dns-filter.mjs'
import { DNS_REWRITE_DEFAULTS, validateDnsRewrite } from '../engine/dns-rewrite.mjs'
import { RESERVED_PORTS, SERVER_PROTOCOLS, SS_METHODS } from '../engine/servers.mjs'
import { isIpOrCidr, isMac } from '../engine/client-routes.mjs'
import { CUSTOM_RULE_TYPES, FALLBACK_TAG, normalizeRouting, parsePortSpec } from '../engine/routing-model.mjs'
import { ICON_SCALE_LIMIT, builtinTags, normalizeGroups } from '../engine/user-groups.mjs'
import { DNSMASQ_OUTBOUND_TAG } from '../engine/config.mjs'

// 站点集不能叫的名字:节点组名、内置直连/拒绝现在的名字、dnsmasq 回送出站——都是同一个出站命名空间
export const reservedPolicyNames = (groups) => {
  const normalized = normalizeGroups(groups || [])
  const builtin = builtinTags(groups || [])
  return [...new Set([...normalized.map((g) => g.name), builtin.direct, builtin.block, DNSMASQ_OUTBOUND_TAG])]
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v) => typeof v === 'string'
const isBoolean = (v) => typeof v === 'boolean'
const isStringArray = (v) => Array.isArray(v) && v.every(isString)

const DNS_MODES = new Set(['off', 'hijack', 'dnsmasq'])
const isHttpUrl = (v) => isString(v) && /^https?:\/\/[^\s]+$/.test(v.trim())

// 规则集 tag(directRulesets[]/adRuleset/categories[].ruleset)最终会原样拼进生成配置的
// rule_set.path,并作为参数传给 `sing-box rule-set match`(见 engine/routing.mjs、
// api/penetration.mjs)。execFile 不经 shell,所以不是命令注入,但放过 "../../../etc/passwd"
// 这类值意味着任意路径读取尝试 + 生成配置本身被写坏,必须在写入 store 之前拦截。
// 上游的规则集名里有 @ 和 !(geosite-36kr@ads、geosite-geolocation-!cn 这类,
// 1876 个里占 348 个),两者都能原样出现在 URL 路径和文件名里。挡住的是 / 和 ..
// ——那才是路径穿越。
const RULESET_TAG_PATTERN = /^[A-Za-z0-9._!@-]+$/
const isValidRulesetTag = (v) => isString(v) && RULESET_TAG_PATTERN.test(v)

// rulesetDir 同理会被拼进每个规则集的 .srs 文件路径——必须是绝对路径,且不含 ".." 路径段
// (避免 "/tmp/../etc" 这类逃出预期目录的写法)。
const containsPathTraversalSegment = (p) => /(^|\/)\.\.(\/|$)/.test(p)
const isValidRulesetDir = (v) => isString(v) && v.startsWith('/') && !containsPathTraversalSegment(v)

// 只校验 patch 里"出现"的字段——深合并本身保证未提及字段维持已有值(来自 DEFAULT_PROFILE
// 或此前已通过校验的写入),所以一个只碰 ipv6 的 patch 不应因为没带 dns 而报错。
// 校验通过返回 null;失败返回一条可直接塞进 400 响应体的错误说明。
// reservedNames:站点集不能用的名字——节点组的名字、内置直连/拒绝现在叫什么、dnsmasq 回送出站。
// 站点集名就是内核里的出站 tag,和这些撞上会生成两个同名出站(内核 FATAL)。
// 图标缩放:整数像素偏移,范围直接用 engine/user-groups.mjs 的 ICON_SCALE_LIMIT,两边不会各改各的
const isIconScale = (v) => Number.isInteger(v) && Math.abs(v) <= ICON_SCALE_LIMIT

export const validateProfilePatch = (patch, { reservedNames = [] } = {}) => {
  if (!isPlainObject(patch)) return 'patch must be an object'
  if (isPlainObject(patch.dns) && 'filter' in patch.dns) {
    const error = validateDnsFilter(patch.dns.filter)
    if (error) return error
  }

  if ('ipv6' in patch && !isBoolean(patch.ipv6)) {
    return 'ipv6 must be a boolean'
  }
  if ('ipv6Proxy' in patch && !['node', 'ipv4', 'bypass'].includes(patch.ipv6Proxy)) {
    return 'ipv6Proxy must be one of node, ipv4, bypass'
  }
  if ('directForNodes' in patch && !isBoolean(patch.directForNodes)) {
    return 'directForNodes must be a boolean'
  }

  if ('rulesetDir' in patch && !isValidRulesetDir(patch.rulesetDir)) {
    return 'rulesetDir must be an absolute path without ".."'
  }

  for (const key of ['testUrl', 'directTestUrl']) {
    if (key in patch && !isHttpUrl(patch[key])) return `${key} must be an http(s) URL`
  }

  // 站点集里的规则集链接:必须是 http(s) 网址(部署时会去拉,拉回来的东西要编成规则集)
  if ('routing' in patch && isPlainObject(patch.routing) && Array.isArray(patch.routing.policies)) {
    for (const p of patch.routing.policies) {
      if (!isPlainObject(p) || !('ruleUrls' in p)) continue
      if (!Array.isArray(p.ruleUrls)) return 'routing.policies[].ruleUrls must be an array'
      if (p.ruleUrls.some((u) => typeof u !== 'string' || !/^https?:\/\/[^\s]+$/i.test(u.trim()))) {
        return 'routing.policies[].ruleUrls must be http(s) URLs'
      }
    }
  }

  // 分析数据保留时长(月)
  if ('traffic' in patch) {
    const tr = patch.traffic
    if (!isPlainObject(tr)) return 'traffic must be an object'
    if ('keepMonths' in tr && !(Number.isInteger(tr.keepMonths) && tr.keepMonths >= 1 && tr.keepMonths <= 36)) {
      return 'traffic.keepMonths must be an integer 1-36'
    }
  }

  // 自动更新计划:openbox {auto, hour, days, channel} / geo {auto, hour, days, channel}
  if ('updates' in patch) {
    const u = patch.updates
    if (!isPlainObject(u)) return 'updates must be an object'
    const isHour = (v) => Number.isInteger(v) && v >= 0 && v <= 23
    if ('openbox' in u) {
      const o = u.openbox
      if (!isPlainObject(o)) return 'updates.openbox must be an object'
      if ('auto' in o && !isBoolean(o.auto)) return 'updates.openbox.auto must be a boolean'
      if ('hour' in o && !isHour(o.hour)) return 'updates.openbox.hour must be an integer 0-23'
      if ('channel' in o && !['auto', 'direct', 'mirror'].includes(o.channel)) return 'updates.openbox.channel must be auto, direct or mirror'
      if ('checkChannel' in o && !['auto', 'direct', 'mirror'].includes(o.checkChannel)) return 'updates.openbox.checkChannel must be auto, direct or mirror'
      if ('days' in o && !(Number.isInteger(o.days) && o.days >= 1 && o.days <= 30)) return 'updates.openbox.days must be an integer 1-30'
    }
    if ('geo' in u) {
      const g = u.geo
      if (!isPlainObject(g)) return 'updates.geo must be an object'
      if ('auto' in g && !isBoolean(g.auto)) return 'updates.geo.auto must be a boolean'
      if ('hour' in g && !isHour(g.hour)) return 'updates.geo.hour must be an integer 0-23'
      if ('days' in g && !(Number.isInteger(g.days) && g.days >= 1 && g.days <= 30)) return 'updates.geo.days must be an integer 1-30'
      if ('channel' in g && !['auto', 'direct', 'mirror'].includes(g.channel)) return 'updates.geo.channel must be auto, direct or mirror'
      if ('checkChannel' in g && !['auto', 'direct', 'mirror'].includes(g.checkChannel)) return 'updates.geo.checkChannel must be auto, direct or mirror'
    }
  }

  if ('servers' in patch) {
    const error = validateServers(patch.servers)
    if (error) return error
  }

  if ('clientRoutes' in patch) {
    const error = validateClientRoutes(patch.clientRoutes)
    if (error) return error
  }

  if ('dns' in patch) {
    const dns = patch.dns
    if (!isPlainObject(dns)) return 'dns must be an object'
    if ('mode' in dns && !DNS_MODES.has(dns.mode)) {
      return 'dns.mode must be one of off, hijack, dnsmasq'
    }
    if ('fakeIpForProxy' in dns && !isBoolean(dns.fakeIpForProxy)) return 'dns.fakeIpForProxy must be a boolean'
    if ('rewrite' in dns) {
      const bad = validateDnsRewrite(dns.rewrite)
      if (bad) return bad
    }
  }

  if ('routing' in patch) {
    const routing = patch.routing
    if (!isPlainObject(routing)) return 'routing must be an object'

    if ('fallback' in routing && !isString(routing.fallback)) {
      return 'routing.fallback must be a string'
    }

    if ('directRulesets' in routing) {
      if (!isStringArray(routing.directRulesets)) return 'routing.directRulesets must be an array of strings'
      if (!routing.directRulesets.every(isValidRulesetTag)) {
        return 'routing.directRulesets entries must match /^[A-Za-z0-9._-]+$/'
      }
    }

    if ('adRuleset' in routing && !isValidRulesetTag(routing.adRuleset)) {
      return 'routing.adRuleset must match /^[A-Za-z0-9._-]+$/'
    }

    // 兜底站点集的默认选中项。'proxy' 是迁移留下的占位(第一个节点组),
    // 其余就是一个出站名(direct / 某个节点组 / block),叫什么由用户的组名决定。
    if ('fallbackDefault' in routing && !isString(routing.fallbackDefault)) {
      return 'routing.fallbackDefault must be a string'
    }

    if ('outboundOptions' in routing) {
      const opts = routing.outboundOptions
      if (!isPlainObject(opts)) return 'routing.outboundOptions must be an object'
      for (const key of ['direct', 'reject', 'groups']) {
        if (key in opts && !isBoolean(opts[key])) return `routing.outboundOptions.${key} must be a boolean`
      }
    }

    // 兜底站点集的名字/图标。名字就是内核里的出站 tag,不能为空
    if ('fallbackName' in routing && (!isString(routing.fallbackName) || !routing.fallbackName.trim())) {
      return 'routing.fallbackName must be a non-empty string'
    }
    if ('fallbackIcon' in routing && !isString(routing.fallbackIcon)) {
      return 'routing.fallbackIcon must be a string'
    }
    if ('fallbackIconScale' in routing && !isIconScale(routing.fallbackIconScale)) {
      return `routing.fallbackIconScale must be an integer within ±${ICON_SCALE_LIMIT}`
    }

    // 代理页「策略」页签的显示顺序(站点集名字的数组),和命中顺序(policies 的顺序)分开存。
    // 只校验形状;名单里对不上的名字,前端读的时候会忽略
    if ('displayOrder' in routing && !isStringArray(routing.displayOrder)) {
      return 'routing.displayOrder must be an array of strings'
    }

    if ('custom' in routing) {
      const error = validateCustomPolicy(routing.custom)
      if (error) return error
    }

    if ('policies' in routing) {
      const error = validatePolicies(routing.policies, isString(routing.fallbackName) ? routing.fallbackName.trim() : '', reservedNames)
      if (error) return error
    }

    if ('categories' in routing) {
      const categories = routing.categories
      if (!Array.isArray(categories)) return 'routing.categories must be an array'
      const allValid = categories.every(
        (cat) => isPlainObject(cat) && isValidRulesetTag(cat.ruleset) && isString(cat.target),
      )
      if (!allValid) {
        return 'routing.categories must be an array of { ruleset, target }, ruleset matching /^[A-Za-z0-9._-]+$/'
      }
    }
  }

  return null
}

// 终端分流:来源必须是合法 IP / 网段;出口是个出站名(存不存在生成配置时再看)
export const validateClientRoutes = (list) => {
  if (!Array.isArray(list)) return 'clientRoutes must be an array'
  const ids = new Set()
  for (const r of list) {
    if (!isPlainObject(r)) return 'clientRoutes entries must be objects'
    if (!isString(r.id) || !/^[A-Za-z0-9_-]{1,40}$/.test(r.id)) return 'clientRoutes[].id must match /^[A-Za-z0-9_-]{1,40}$/'
    if (ids.has(r.id)) return `clientRoutes[].id duplicated: ${r.id}`
    ids.add(r.id)
    if ('enabled' in r && !isBoolean(r.enabled)) return 'clientRoutes[].enabled must be a boolean'
    if (!isString(r.name) || !r.name.trim() || r.name.length > 40) return 'clientRoutes[].name must be a non-empty string (<= 40 chars)'
    if (!isStringArray(r.sources) || !r.sources.length) return 'clientRoutes[].sources must be a non-empty array of strings'
    const bad = r.sources.find((x) => !isIpOrCidr(x))
    if (bad !== undefined) return `clientRoutes[].sources contains an invalid IP/CIDR: ${bad}`
    if ('bypass' in r && !isBoolean(r.bypass)) return 'clientRoutes[].bypass must be a boolean'
    if ('macs' in r && !isStringArray(r.macs)) return 'clientRoutes[].macs must be an array of strings'
    if (r.bypass === true) {
      // 不进内核:按 MAC 放行,至少一个合法 MAC;出站不用填
      if (!Array.isArray(r.macs) || !r.macs.length) return 'clientRoutes[].macs is required when bypass is true'
      const badMac = r.macs.find((x) => !isMac(x))
      if (badMac !== undefined) return `clientRoutes[].macs contains an invalid MAC: ${badMac}`
    } else if (!isString(r.outbound) || !r.outbound.trim()) {
      return 'clientRoutes[].outbound must be a non-empty string'
    }
  }
  return null
}

// 共享网络的服务器。id 会拼进入站 tag 和 uci 段名,限定字符;端口不能撞面板/内核自用的,
// 也不能互相重复;各协议缺了凭据就开不起来,直接挡在保存这一步。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const validateServers = (servers) => {
  if (!Array.isArray(servers)) return 'servers must be an array'
  const ports = new Set()
  const ids = new Set()
  for (const s of servers) {
    if (!isPlainObject(s)) return 'servers entries must be objects'
    if (!isString(s.id) || !/^[A-Za-z0-9_-]{1,40}$/.test(s.id)) return 'servers[].id must match /^[A-Za-z0-9_-]{1,40}$/'
    if (ids.has(s.id)) return `servers[].id duplicated: ${s.id}`
    ids.add(s.id)
    if ('enabled' in s && !isBoolean(s.enabled)) return 'servers[].enabled must be a boolean'
    if (!isString(s.name) || !s.name.trim() || s.name.length > 40) return 'servers[].name must be a non-empty string (<= 40 chars)'
    if (!SERVER_PROTOCOLS.includes(s.protocol)) return `servers[].protocol must be one of ${SERVER_PROTOCOLS.join(', ')}`
    if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) return 'servers[].port must be an integer 1-65535'
    if (RESERVED_PORTS.has(s.port)) return `servers[].port ${s.port} is reserved`
    if (ports.has(s.port)) return `servers[].port duplicated: ${s.port}`
    ports.add(s.port)
    if ('address' in s && !isString(s.address)) return 'servers[].address must be a string'
    if ('tls' in s && !isBoolean(s.tls)) return 'servers[].tls must be a boolean'
    if ('obfs' in s && !isString(s.obfs)) return 'servers[].obfs must be a string'
    if ('username' in s && !isString(s.username)) return 'servers[].username must be a string'
    // mixed 的认证可选,但用户名和密码要成对:只有其中一个,客户端那边没法填
    if (s.protocol === 'mixed' && Boolean(s.username) !== Boolean(s.password)) {
      return 'servers[].username and password must be set together for mixed'
    }
    const needPassword = s.protocol === 'shadowsocks' || s.protocol === 'tuic' || s.protocol === 'hysteria2'
    if (needPassword && (!isString(s.password) || !s.password)) return `servers[].password is required for ${s.protocol}`
    const needUuid = s.protocol === 'vless' || s.protocol === 'tuic'
    if (needUuid && (!isString(s.uuid) || !UUID_RE.test(s.uuid))) return `servers[].uuid must be a UUID for ${s.protocol}`
    if (s.protocol === 'shadowsocks' && !SS_METHODS.includes(s.method)) return `servers[].method must be one of ${SS_METHODS.join(', ')}`
  }
  return null
}

// 策略的规则集 tag 和老的 categories 一样会被拼进 .srs 路径,同一条安全边界。
// 其余条件(域名/关键词/CIDR)只会进 JSON 配置的值位,不参与路径拼接,所以只做
// 类型检查,不限制字符——域名里带下划线、CIDR 带斜杠都是合法的。
const POLICY_LIST_FIELDS = ['domain', 'domainSuffix', 'domainKeyword', 'ipCidr']

// 前置自定义分流(routing.custom):固定置顶那一条,一行一条规则、一行一个出口。
// 名字只是界面上的标题,不当出站 tag 用,所以不查重名;但每行的 outbound 会原样写进内核
// 规则的 outbound 字段,规则集名会被拼进 .srs 路径,这两处照站点集同一道校验来。
const validateCustomPolicy = (custom) => {
  if (!isPlainObject(custom)) return 'routing.custom must be an object'
  if ('name' in custom && (!isString(custom.name) || !custom.name.trim())) {
    return 'routing.custom.name must be a non-empty string'
  }
  if ('icon' in custom && !isString(custom.icon)) return 'routing.custom.icon must be a string'
  if ('iconScale' in custom && !isIconScale(custom.iconScale)) {
    return `routing.custom.iconScale must be an integer within ±${ICON_SCALE_LIMIT}`
  }
  if ('enabled' in custom && !isBoolean(custom.enabled)) return 'routing.custom.enabled must be a boolean'
  if ('rules' in custom) {
    if (!Array.isArray(custom.rules)) return 'routing.custom.rules must be an array'
    for (const r of custom.rules) {
      if (!isPlainObject(r)) return 'routing.custom.rules entries must be objects'
      if (!CUSTOM_RULE_TYPES.includes(r.type)) {
        return `routing.custom.rules[].type must be one of ${CUSTOM_RULE_TYPES.join(', ')}`
      }
      if (!isString(r.value) || !r.value.trim()) return 'routing.custom.rules[].value is required'
      if (!isString(r.outbound) || !r.outbound.trim()) return 'routing.custom.rules[].outbound is required'
      if (r.type === 'ruleUrl' && !/^https?:\/\//i.test(r.value.trim())) {
        return 'routing.custom.rules[].value must be an http(s) URL when type is ruleUrl'
      }
      if (r.type === 'port' && !parsePortSpec(r.value)) {
        return 'routing.custom.rules[].value must be ports like 51820 or 1000-2000 (comma separated) when type is port'
      }
      if (r.type === 'geosite' || r.type === 'geoip' || r.type === 'ruleset') {
        const tag = r.type === 'ruleset' ? r.value.trim() : `${r.type}-${r.value.trim()}`
        if (!isValidRulesetTag(tag)) {
          return 'routing.custom.rules[] ruleset name must match /^[A-Za-z0-9._-]+$/'
        }
      }
    }
  }
  return null
}

const validatePolicies = (policies, fallbackName = '', reservedNames = []) => {
  if (!Array.isArray(policies)) return 'routing.policies must be an array'
  const reserved = new Set(reservedNames)
  const seen = new Set()
  for (const p of policies) {
    if (!isPlainObject(p)) return 'routing.policies entries must be objects'
    if (!isString(p.name) || !p.name.trim()) return 'routing.policies[].name is required'
    if (seen.has(p.name.trim())) return `routing.policies[].name "${p.name.trim()}" is duplicated`
    seen.add(p.name.trim())
    if (reserved.has(p.name.trim())) {
      return `routing.policies[].name "${p.name.trim()}" collides with a node group / built-in outbound name`
    }
    // 兜底站点集占着的名字(默认「其他」,或用户改过的):重名会在内核里生成两个同名出站
    if (p.name.trim() === FALLBACK_TAG || (fallbackName && p.name.trim() === fallbackName)) {
      return `routing.policies[].name "${p.name.trim()}" is reserved for the built-in fallback`
    }
    if ('enabled' in p && !isBoolean(p.enabled)) return 'routing.policies[].enabled must be a boolean'
    if ('default' in p && !isString(p.default)) return 'routing.policies[].default must be a string'
    if ('icon' in p && !isString(p.icon)) return 'routing.policies[].icon must be a string'
    if ('iconScale' in p && !isIconScale(p.iconScale)) return `routing.policies[].iconScale must be an integer within ±${ICON_SCALE_LIMIT}`
    if ('rulesets' in p) {
      if (!isStringArray(p.rulesets)) return 'routing.policies[].rulesets must be an array of strings'
      if (!p.rulesets.every(isValidRulesetTag)) {
        return 'routing.policies[].rulesets entries must match /^[A-Za-z0-9._-]+$/'
      }
    }
    for (const field of POLICY_LIST_FIELDS) {
      if (field in p && !isStringArray(p[field])) {
        return `routing.policies[].${field} must be an array of strings`
      }
    }
  }
  return null
}

// 首次引导用的区域推荐默认值。CN 走境内直连(direct DNS + geosite/geoip-cn + PROXY 兜底);
// 其它区域默认更保守——不启用 DNS 分流,失败时直接落回直连,直连规则集按区域代号派生。
// 首次引导只回答一件事:"其余流量走哪"。中国大陆那些具体规则由内置的站点集种子
// 提供(见 store/openbox-store.mjs),这里不替用户改写规则。
const buildRegionDefaults = (regionParam) => {
  const raw = isString(regionParam) && regionParam.trim() ? regionParam.trim().toUpperCase() : 'CN'
  const names = { CN: '中国大陆', HKMO: '香港澳门', OTHER: '其他地区' }
  // 不认识的地区按中国大陆算(引导页只有这三个选项,别的值只可能是手输/老链接)
  const region = names[raw] ? raw : 'CN'
  // 人在国内:没被站点集挑走的走代理;境外反过来
  const fallbackDefault = region === 'CN' ? 'proxy' : 'direct'
  return {
    region: names[region],
    fallbackDefault,
    dns: { split: true },
    routing: { fallbackDefault },
  }
}

export const registerProfileRoutes = (app, { store } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '1mb' }))

  // 区域推荐默认——放在 GET / 前面注册,和 subscriptions.mjs 里 /preview 先于 / 的顺序一致,
  // 虽然这里都是字面量路径不存在遮蔽问题,但保持同样的可读习惯。
  router.get('/defaults', (req, res) => {
    // dnsRewriteDefaults:「DNS 重写」卡片的「恢复默认」按它把两条默认项放回去
    res.json({ defaults: buildRegionDefaults(req.query.region), dnsRewriteDefaults: DNS_REWRITE_DEFAULTS })
  })

  // 地区层退役的一次性升级:老档案里的地区被翻译成站点集(engine/routing-model.mjs),
  // 这里把翻译结果写回档案。不写回的话,界面看到的是老的 policies 数组、内核跑的却是
  // 翻译后的那一份——用户会在代理页看到一个界面上根本不存在的 selector。
  // fallbackDefault 一旦落库就说明迁过了,之后这段不再动任何东西(幂等)。
  const migrateOnce = () => {
    const profile = store.getProfile()
    if (isString(profile.routing?.fallbackDefault) && profile.routing.fallbackDefault) return profile
    const conf = normalizeRouting(profile.routing)
    return store.setProfile({
      routing: { policies: conf.policies, fallbackDefault: conf.fallback.default },
    })
  }

  router.get('/', (_req, res) => {
    res.json({ profile: migrateOnce() })
  })

  router.put('/', (req, res) => {
    const patch = req.body || {}
    const error = validateProfilePatch(patch, { reservedNames: reservedPolicyNames(store.getGroups()) })
    if (error) {
      res.status(400).json({ error })
      return
    }
    res.json({ profile: store.setProfile(patch) })
  })

  app.use('/api/openbox/profile', router)
}
