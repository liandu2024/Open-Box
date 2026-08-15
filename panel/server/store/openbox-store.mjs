import { randomBytes } from 'node:crypto'

export const KEYS = {
  profile: 'openbox/profile',
  subscriptions: 'openbox/subscriptions',
  nodes: 'openbox/nodes',
  deployState: 'openbox/deploy-state',
  clashSecret: 'openbox/clash-secret',
  // 引导向导"已完成/已跳过"标志(P4b 终审延期项修复)。此前只活在浏览器 localStorage,
  // 经通用 config/* storage 同步推给后端一张不受保护的通用 KV 表——工厂重置/重装后端是
  // 全新的,但用过的浏览器本地仍缓存旧值,还会在下次同步时把陈旧值重新推回全新后端。
  // 放进 openbox/* 命名空间后,与 profile/deployState 一样受 index.mjs 的
  // isProtectedStorageKey 保护,不会被通用快照同步覆盖或清空,后端由此成为唯一真相源。
  wizardDone: 'openbox/wizard-done',
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

  // 无值(全新安装/工厂重置后的全新后端)一律回退到 false —— 这是本次修复的关键契约:
  // 必须显示引导,而不是信任任何客户端传来的"已完成"信号。
  const getWizardDone = () => {
    const raw = get(KEYS.wizardDone)
    const stored = parseJsonOr(raw, false)
    return stored === true
  }

  const setWizardDone = (done) => {
    set(KEYS.wizardDone, JSON.stringify(Boolean(done)))
    return getWizardDone()
  }

  const getClashSecret = () => {
    const existing = get(KEYS.clashSecret)
    if (typeof existing === 'string' && existing) return existing
    const generated = randomHex()
    set(KEYS.clashSecret, generated)
    return generated
  }

  return {
    getProfile,
    setProfile,
    getSubscriptions,
    setSubscriptions,
    getNodes,
    setNodes,
    getDeployState,
    setDeployState,
    getWizardDone,
    setWizardDone,
    getClashSecret,
  }
}
