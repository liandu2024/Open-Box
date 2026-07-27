import express from 'express'

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v) => typeof v === 'string'
const isBoolean = (v) => typeof v === 'boolean'
const isStringArray = (v) => Array.isArray(v) && v.every(isString)

const DNS_MODES = new Set(['hijack', 'dnsmasq'])

// 只校验 patch 里"出现"的字段——深合并本身保证未提及字段维持已有值(来自 DEFAULT_PROFILE
// 或此前已通过校验的写入),所以一个只碰 ipv6 的 patch 不应因为没带 dns 而报错。
// 校验通过返回 null;失败返回一条可直接塞进 400 响应体的错误说明。
export const validateProfilePatch = (patch) => {
  if (!isPlainObject(patch)) return 'patch must be an object'

  if ('ipv6' in patch && !isBoolean(patch.ipv6)) {
    return 'ipv6 must be a boolean'
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

    if ('directRulesets' in routing && !isStringArray(routing.directRulesets)) {
      return 'routing.directRulesets must be an array of strings'
    }

    if ('categories' in routing) {
      const categories = routing.categories
      if (!Array.isArray(categories)) return 'routing.categories must be an array'
      const allValid = categories.every(
        (cat) => isPlainObject(cat) && isString(cat.ruleset) && isString(cat.target),
      )
      if (!allValid) return 'routing.categories must be an array of { ruleset, target } strings'
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
  const router = express.Router()
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
