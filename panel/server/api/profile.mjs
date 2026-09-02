import express from 'express'
import { REGION_MODES } from '../engine/routing-model.mjs'

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v) => typeof v === 'string'
const isBoolean = (v) => typeof v === 'boolean'
const isStringArray = (v) => Array.isArray(v) && v.every(isString)

const DNS_MODES = new Set(['hijack', 'dnsmasq'])

// 规则集 tag(directRulesets[]/adRuleset/categories[].ruleset)最终会原样拼进生成配置的
// rule_set.path,并作为参数传给 `sing-box rule-set match`(见 engine/routing.mjs、
// api/penetration.mjs)。execFile 不经 shell,所以不是命令注入,但放过 "../../../etc/passwd"
// 这类值意味着任意路径读取尝试 + 生成配置本身被写坏,必须在写入 store 之前拦截。
const RULESET_TAG_PATTERN = /^[A-Za-z0-9._-]+$/
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

    if ('regionMode' in routing && !REGION_MODES.includes(routing.regionMode)) {
      return `routing.regionMode must be one of ${REGION_MODES.join(', ')}`
    }

    if ('outboundOptions' in routing) {
      const opts = routing.outboundOptions
      if (!isPlainObject(opts)) return 'routing.outboundOptions must be an object'
      for (const key of ['direct', 'reject', 'groups']) {
        if (key in opts && !isBoolean(opts[key])) return `routing.outboundOptions.${key} must be a boolean`
      }
    }

    if ('policies' in routing) {
      const error = validatePolicies(routing.policies)
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

const validatePolicies = (policies) => {
  if (!Array.isArray(policies)) return 'routing.policies must be an array'
  for (const p of policies) {
    if (!isPlainObject(p)) return 'routing.policies entries must be objects'
    if (!isString(p.name) || !p.name.trim()) return 'routing.policies[].name is required'
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
const buildRegionDefaults = (regionParam) => {
  const raw = isString(regionParam) && regionParam.trim() ? regionParam.trim().toUpperCase() : 'CN'
  const regionMode = REGION_MODES.includes(raw) ? raw : 'CN'
  // 三档地区只改 regionMode,不再替用户改写规则:规则由 regionMode 在生成时决定
  // (见 engine/routing.mjs),不需要再往档案里塞一堆 directRulesets。
  return { region: regionMode, regionMode, dns: { split: true }, routing: { regionMode } }
}

export const registerProfileRoutes = (app, { store } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '1mb' }))

  // 区域推荐默认——放在 GET / 前面注册,和 subscriptions.mjs 里 /preview 先于 / 的顺序一致,
  // 虽然这里都是字面量路径不存在遮蔽问题,但保持同样的可读习惯。
  router.get('/defaults', (req, res) => {
    res.json({ defaults: buildRegionDefaults(req.query.region) })
  })

  router.get('/', (_req, res) => {
    res.json({ profile: store.getProfile() })
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
