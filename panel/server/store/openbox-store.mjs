import { randomBytes } from 'node:crypto'
import { defaultGroups, normalizeGroups } from '../engine/user-groups.mjs'

export const KEYS = {
  profile: 'openbox/profile',
  subscriptions: 'openbox/subscriptions',
  nodes: 'openbox/nodes',
  groups: 'openbox/groups',
  deployState: 'openbox/deploy-state',
  clashSecret: 'openbox/clash-secret',
}

export const DEFAULT_PROFILE = {
  region: 'CN',
  ipv6: true,
  tun: { autoRedirect: true },
  dns: { split: true, mode: 'hijack', direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' },
  routing: {
    proxyTag: 'PROXY',
    categories: [],
    directRulesets: ['geosite-cn', 'geoip-cn'],
    adBlock: false,
    adRuleset: 'geosite-category-ads-all',
    fallback: 'PROXY',
  },
  rulesetDir: '/opt/open-box/data/rulesets',
}

const DEFAULT_DEPLOY_STATE = { stage: 'idle', message: '', at: 0, badTags: [] }

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

// 深合并:普通对象递归合并,数组与其它类型整体替换(patch 优先)。
const deepMerge = (base, patch) => {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch
  const result = { ...base }
  for (const key of Object.keys(patch)) {
    result[key] = deepMerge(base[key], patch[key])
  }
  return result
}

// 所有 JSON 解析统一走这里:损坏数据回退到 fallback,而不是抛错拖垮整个面板。
const parseJsonOr = (raw, fallback) => {
  if (typeof raw !== 'string') return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

const defaultRandomHex = () => randomBytes(16).toString('hex')

export const createStore = ({ get, set, del }, { randomHex = defaultRandomHex } = {}) => {
  void del // 当前接口未暴露删除操作,保留注入以便未来使用/测试对称性。

  const getProfile = () => {
    const raw = get(KEYS.profile)
    const stored = parseJsonOr(raw, {})
    return deepMerge(DEFAULT_PROFILE, isPlainObject(stored) ? stored : {})
  }

  const setProfile = (patch) => {
    const merged = deepMerge(getProfile(), patch || {})
    set(KEYS.profile, JSON.stringify(merged))
    return merged
  }

  const getSubscriptions = () => {
    const raw = get(KEYS.subscriptions)
    const stored = parseJsonOr(raw, [])
    return Array.isArray(stored) ? stored : []
  }

  const setSubscriptions = (list) => {
    set(KEYS.subscriptions, JSON.stringify(Array.isArray(list) ? list : []))
  }

  const getNodes = () => {
    const raw = get(KEYS.nodes)
    const stored = parseJsonOr(raw, [])
    return Array.isArray(stored) ? stored : []
  }

  const setNodes = (list) => {
    set(KEYS.nodes, JSON.stringify(Array.isArray(list) ? list : []))
  }

  const getDeployState = () => {
    const raw = get(KEYS.deployState)
    const stored = parseJsonOr(raw, DEFAULT_DEPLOY_STATE)
    return deepMerge(DEFAULT_DEPLOY_STATE, isPlainObject(stored) ? stored : {})
  }

  const setDeployState = (s) => {
    set(KEYS.deployState, JSON.stringify(s))
  }

  const getClashSecret = () => {
    const existing = get(KEYS.clashSecret)
    if (typeof existing === 'string' && existing) return existing
    const generated = randomHex()
    set(KEYS.clashSecret, generated)
    return generated
  }

  // 用户自定义节点组。第一次读取时落地两个默认组(所有-自动 / 所有-手动)并写回,
  // 这样"默认值"只在这里定义一次,前端拿到的永远是真实存在的记录,而不是靠界面
  // 自己临时编两条出来。
  const getGroups = () => {
    const raw = get(KEYS.groups)
    if (raw) {
      try {
        const list = JSON.parse(raw)
        if (Array.isArray(list)) return normalizeGroups(list)
      } catch { /* 落到下面的默认值 */ }
    }
    const seeded = normalizeGroups(defaultGroups())
    set(KEYS.groups, JSON.stringify(seeded))
    return seeded
  }
  const setGroups = (list) => {
    set(KEYS.groups, JSON.stringify(normalizeGroups(Array.isArray(list) ? list : [])))
  }

  return {
    getProfile,
    setProfile,
    getGroups,
    setGroups,
    getSubscriptions,
    setSubscriptions,
    getNodes,
    setNodes,
    getDeployState,
    setDeployState,
    getClashSecret,
  }
}
