import express from 'express'

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

// 首次引导用的区域推荐默认值。CN 走境内直连(direct DNS + geosite/geoip-cn + PROXY 兜底);
// 其它区域默认更保守——不启用 DNS 分流,失败时直接落回直连,直连规则集按区域代号派生。
const buildRegionDefaults = (regionParam) => {
  const region = isString(regionParam) && regionParam.trim() ? regionParam.trim().toUpperCase() : 'CN'

  if (region === 'CN') {
    return {
      region,
      dns: { split: true, direct: '223.5.5.5' },
      routing: { directRulesets: ['geosite-cn', 'geoip-cn'], fallback: 'PROXY' },
    }
  }

  const suffix = region.toLowerCase()
  return {
    region,
    dns: { split: false, direct: '1.1.1.1' },
    routing: { directRulesets: [`geosite-${suffix}`, `geoip-${suffix}`], fallback: 'direct' },
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

  // 引导向导门控状态(P4b 终审延期项修复):挂在 profile 路由下作为独立子路径,而不是
  // 塞进 profile 自身的 patch 里——wizardDone 不是网络配置的一部分,且 validateProfilePatch
  // 只校验 patch 里"出现"的已知字段,若把它混进 profile 对象会被 setProfile 原样深合并
  // 写进 DEFAULT_PROFILE 形状的 JSON 里,污染一个跟路由/DNS 完全无关的字段。独立子路径
  // 复用同一个已挂载的 router(与 /defaults 同样的先注册习惯),对应专用 store 字段
  // openbox/wizard-done。GET 全新安装必须返回 done:false——引导是否显示以此为准,前端
  // localStorage 只做本地缓存,绝不能替代这个后端判定(见 store/wizard.ts)。
  router.get('/wizard-done', (_req, res) => {
    res.json({ done: store.getWizardDone() })
  })

  router.put('/wizard-done', (req, res) => {
    const body = req.body || {}
    if (!isBoolean(body.done)) {
      res.status(400).json({ error: 'done must be a boolean' })
      return
    }
    res.json({ done: store.setWizardDone(body.done) })
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
