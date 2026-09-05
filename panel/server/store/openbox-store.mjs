import { randomBytes } from 'node:crypto'
import { BUILTIN_REGIONS } from '../engine/routing-model.mjs'
import { defaultGroups, normalizeGroups } from '../engine/user-groups.mjs'

export const KEYS = {
  profile: 'openbox/profile',
  subscriptions: 'openbox/subscriptions',
  nodes: 'openbox/nodes',
  groups: 'openbox/groups',
  deployState: 'openbox/deploy-state',
  clashSecret: 'openbox/clash-secret',
  // 内核里各 selector 当前选的线路的快照(system/scheduler.mjs 每分钟刷新)
  // 必须带 openbox/ 前缀:index.mjs 的 isProtectedStorageKey 只认这个前缀,浏览器每次
  // 同步设置(PUT /api/storage)会把不受保护的键整个清掉——以前用点号,快照每次都被删
  selections: 'openbox/selections',
}

export const DEFAULT_PROFILE = {
  region: 'CN',
  // 默认关掉 IPv6:关掉的含义是 DNS 只解析 A 记录(strategy=ipv4_only)、tun 不给
  // v6 地址、并在防火墙上 REJECT 掉 lan→wan 的 v6——也就是干脆不走 IPv6,免得它绕开
  // 隧道直连出去。要用 v6 的人在「其他」页签里自己打开。
  ipv6: false,
  // 订阅链接和节点服务器的地址一律直连,不看站点集(engine/direct-hosts.mjs)
  directForNodes: true,
  tun: { autoRedirect: true },
  // 共享网络:本机开的服务器入站(engine/servers.mjs),默认没有
  servers: [],
  // 终端分流:按局域网来源 IP 指定出口(engine/client-routes.mjs),默认没有
  clientRoutes: [],
  // mode:off 不碰 DNS / hijack 防火墙劫持 / dnsmasq 转发(默认;见 engine/dns.mjs 与 system/dns-takeover.mjs)
  dns: { split: true, mode: 'dnsmasq', direct: '223.5.5.5', proxy: '1.1.1.1' },
  // 每日流量这些分析数据在库里留多久(月)。面板「后端设置」里可改,1~36。
  // 按正式路由器实测,按天的记录一天大约 0.75MB,3 个月 ≈ 70MB;小时明细另外只留 7 天
  // (见 system/traffic-collector.mjs)
  traffic: { keepMonths: 3 },
  // 测速地址。testUrl 给自动择优(url-test)组和面板的延迟测试用;directTestUrl 只给内置
  // 直连出站用——默认那个是 Google 的域名,从国内直连去测量出来的是"直连到 Google 有多远"。
  testUrl: 'https://www.gstatic.com/generate_204',
  directTestUrl: 'http://www.msftconnecttest.com/connecttest.txt',
  // 自动更新计划(面板进程内的定时器,见 system/scheduler.mjs):默认都关
  updates: {
    openbox: { auto: false, hour: 4, channel: 'auto' },
    geo: { auto: false, hour: 4, days: 7 },
  },
  routing: {
    proxyTag: 'PROXY',
    // 地区分流:预置中国大陆/香港澳门/其他地区三条,用户可以增删改、拖拽排序。
    // regionId 指向当前选中的那条(没有时按 regionMode 推断,见 routing-model.mjs)。
    regions: BUILTIN_REGIONS.map((r) => ({ ...r, rules: r.rules.map((rule) => ({ ...rule })) })),
    regionMode: 'CN',
    // 「出站」页签:每条策略的 selector 里能选到哪几类东西
    outboundOptions: { direct: true, reject: true, groups: true },
    // 策略分流。一条策略 = 一组匹配条件 + 内核里一个同名 selector,不记具体节点。
    policies: [],
    adBlock: false,
    adRuleset: 'geosite-category-ads-all',
    // 下面三个是改版前的老字段。deepMerge 没有删键的能力,清空反而会让降级回旧版本
    // 的人丢数据,所以留着不动;读出来时由 engine/routing-model.mjs 翻译成新模型。
    categories: [],
    directRulesets: ['geosite-cn', 'geoip-cn'],
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

  // 内核跑着的时候从 clash API 读到的「每个 selector 现在选的是谁」。内核没在跑时
  // (升级脚本停掉内核后用户点启动、开机自启)拿它生成 DNS 规则,不然所有站点集都
  // 会按配置里的默认项判直连/代理,和内核用 cache_file 恢复出来的实际选择对不上。
  const LEGACY_SELECTIONS_KEY = 'openbox.selections'
  const getSelectionsSnapshot = () => {
    let raw = get(KEYS.selections)
    if (raw === null || raw === undefined) {
      // 旧键名的快照搬到新键下(能搬到就搬,搬不到也无妨:那份多半早被清空了)
      const legacy = get(LEGACY_SELECTIONS_KEY)
      if (legacy !== null && legacy !== undefined) {
        set(KEYS.selections, legacy)
        del(LEGACY_SELECTIONS_KEY)
        raw = legacy
      }
    }
    const stored = parseJsonOr(raw, {})
    return isPlainObject(stored) ? stored : {}
  }
  const setSelectionsSnapshot = (map) => {
    set(KEYS.selections, JSON.stringify(isPlainObject(map) ? map : {}))
    // 内核在跑时每分钟都是直接写新快照、不经过 get,旧键名那份要顺手清掉
    if (get(LEGACY_SELECTIONS_KEY) !== null && get(LEGACY_SELECTIONS_KEY) !== undefined) del(LEGACY_SELECTIONS_KEY)
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
    getSelectionsSnapshot,
    setSelectionsSnapshot,
    // 裸键读写:给部署锁这类"进程间协调"用,键必须带 openbox/ 前缀才不会被设置同步清掉
    getRaw: (key) => get(key),
    setRaw: (key, value) => set(key, value),
    delRaw: (key) => del(key),
    getClashSecret,
  }
}
