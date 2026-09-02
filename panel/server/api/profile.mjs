import express from 'express'
import { FALLBACK_TAG, normalizeRouting } from '../engine/routing-model.mjs'

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v) => typeof v === 'string'
const isBoolean = (v) => typeof v === 'boolean'
const isStringArray = (v) => Array.isArray(v) && v.every(isString)

const DNS_MODES = new Set(['hijack', 'dnsmasq'])
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
export const validateProfilePatch = (patch) => {
  if (!isPlainObject(patch)) return 'patch must be an object'

  if ('ipv6' in patch && !isBoolean(patch.ipv6)) {
    return 'ipv6 must be a boolean'
  }

  if ('rulesetDir' in patch && !isValidRulesetDir(patch.rulesetDir)) {
    return 'rulesetDir must be an absolute path without ".."'
  }

  for (const key of ['testUrl', 'directTestUrl']) {
    if (key in patch && !isHttpUrl(patch[key])) return `${key} must be an http(s) URL`
  }

  // 自动更新计划:openbox {auto, hour, channel} / geo {auto, hour, days}
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
    }
    if ('geo' in u) {
      const g = u.geo
      if (!isPlainObject(g)) return 'updates.geo must be an object'
      if ('auto' in g && !isBoolean(g.auto)) return 'updates.geo.auto must be a boolean'
      if ('hour' in g && !isHour(g.hour)) return 'updates.geo.hour must be an integer 0-23'
      if ('days' in g && !(Number.isInteger(g.days) && g.days >= 1 && g.days <= 30)) return 'updates.geo.days must be an integer 1-30'
    }
  }

  if ('dns' in patch) {
    const dns = patch.dns
    if (!isPlainObject(dns)) return 'dns must be an object'
    if ('mode' in dns && !DNS_MODES.has(dns.mode)) {
      return 'dns.mode must be one of hijack, dnsmasq'
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

    if ('policies' in routing) {
      const error = validatePolicies(routing.policies, isString(routing.fallbackName) ? routing.fallbackName.trim() : '')
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

// 策略的规则集 tag 和老的 categories 一样会被拼进 .srs 路径,同一条安全边界。
// 其余条件(域名/关键词/CIDR)只会进 JSON 配置的值位,不参与路径拼接,所以只做
// 类型检查,不限制字符——域名里带下划线、CIDR 带斜杠都是合法的。
const POLICY_LIST_FIELDS = ['domain', 'domainSuffix', 'domainKeyword', 'ipCidr']

const validatePolicies = (policies, fallbackName = '') => {
  if (!Array.isArray(policies)) return 'routing.policies must be an array'
  for (const p of policies) {
    if (!isPlainObject(p)) return 'routing.policies entries must be objects'
    if (!isString(p.name) || !p.name.trim()) return 'routing.policies[].name is required'
    // 兜底站点集占着的名字(默认「其他」,或用户改过的):重名会在内核里生成两个同名出站
    if (p.name.trim() === FALLBACK_TAG || (fallbackName && p.name.trim() === fallbackName)) {
      return `routing.policies[].name "${p.name.trim()}" is reserved for the built-in fallback`
    }
    if ('enabled' in p && !isBoolean(p.enabled)) return 'routing.policies[].enabled must be a boolean'
    if ('default' in p && !isString(p.default)) return 'routing.policies[].default must be a string'
    if ('icon' in p && !isString(p.icon)) return 'routing.policies[].icon must be a string'
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
    res.json({ defaults: buildRegionDefaults(req.query.region) })
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
    const error = validateProfilePatch(patch)
    if (error) {
      res.status(400).json({ error })
      return
    }
    res.json({ profile: store.setProfile(patch) })
  })

  app.use('/api/openbox/profile', router)
}
