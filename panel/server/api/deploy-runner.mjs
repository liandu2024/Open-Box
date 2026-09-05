import { readSystemDns } from '../system/resolv.mjs'
import { readLocalSubnets } from '../system/local-subnets.mjs'
import { resolveHostsToCidrs } from '../system/resolve-hosts.mjs'
import { collectDirectHosts } from '../engine/direct-hosts.mjs'
import { normalizeRouting } from '../engine/routing-model.mjs'
import { builtinTags } from '../engine/user-groups.mjs'
import { buildConfig } from '../engine/config.mjs'
import { dnsPolicyClasses } from '../engine/dns.mjs'
import { deployConfig, configMetaPath } from '../system/deploy.mjs'
import { ensureRuleLists } from '../system/rule-lists.mjs'
import { enableService, disableService, serviceStatus } from '../system/service.mjs'
import { CLASH_API_BASE } from './penetration.mjs'

// 生成配置前问一下正在跑的内核:每个 selector 现在选的是谁。DNS 规则按它判各站点集
// 此刻走直连还是代理(见 engine/dns.mjs)。内核没在跑就是空表,退回档案默认。
export const fetchSelections = async (fetchImpl, secret) => {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    let res
    try {
      res = await fetchImpl(`${CLASH_API_BASE}/proxies`, { headers: secret ? { Authorization: `Bearer ${secret}` } : {}, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res || !res.ok) return {}
    const body = await res.json()
    const out = {}
    for (const [name, p] of Object.entries((body && body.proxies) || {})) {
      if (p && typeof p.now === 'string' && p.now) out[name] = p.now
    }
    return out
  } catch {
    return {}
  }
}

// 选择即默认:用户在代理页给某个站点集(或兜底)挑了出口,就把它写进档案当这个站点集的 default。
// 不写的话,用户新建的站点集没有 default,生成配置时按"成员表第一项"= 直连算;内核停着时的
// 部署(升级脚本)又只能靠快照——快照每分钟才刷新一次,刚切换就升级,生成的 DNS 规则还是直连,
// 规则页就一直提示"DNS 规则是旧的,重启内核",重启后 selector 又退回 直连,循环往复。
// 写进档案后,不管快照新不新,selector 的 default 和 DNS 规则都跟着用户的选择走。
// 内置直连 / 拒绝按占位符('direct' / 'block')存:它们可以改名,档案里不存当时的名字。
export const persistSelectionsAsDefaults = (store, selections) => {
  if (!store || typeof store.getProfile !== 'function' || typeof store.setProfile !== 'function') return false
  const map = selections && typeof selections === 'object' ? selections : {}
  if (!Object.keys(map).length) return false
  const profile = store.getProfile() || {}
  const routing = profile.routing && typeof profile.routing === 'object' ? profile.routing : {}
  const builtin = builtinTags(typeof store.getGroups === 'function' ? store.getGroups() : [])
  const stored = (name) => (name === builtin.direct ? 'direct' : name === builtin.block ? 'block' : name)
  const conf = normalizeRouting(routing)
  let changed = false
  const policies = (Array.isArray(routing.policies) ? routing.policies : []).map((p) => {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string') return p
    const picked = map[p.name.trim()]
    if (typeof picked !== 'string' || !picked) return p
    const next = stored(picked)
    if ((p.default || '') === next) return p
    changed = true
    return { ...p, default: next }
  })
  let fallbackDefault = routing.fallbackDefault
  const pickedFallback = map[conf.fallback.name]
  if (typeof pickedFallback === 'string' && pickedFallback) {
    const next = stored(pickedFallback)
    if ((fallbackDefault || '') !== next) {
      fallbackDefault = next
      changed = true
    }
  }
  if (!changed) return false
  const patch = { routing: { ...routing, policies } }
  if (fallbackDefault !== undefined) patch.routing.fallbackDefault = fallbackDefault
  store.setProfile(patch)
  return true
}

// 磁盘上那份配置的 dns.rules 是按"哪个站点集走直连、哪个走代理"定死的(见 engine/dns.mjs)。
// 用户在代理页把某个站点集从直连改到代理(或反过来),这份规则就过期了:走代理的域名还在用
// 直连侧解析(拿到的是被污染的地址),或者走直连的域名还在往代理侧的解析器发查询——而那台
// 解析器此刻 detour 的是一条已经改成直连的线路,查询直接超时,整个域名解析全断。
// 所以每次改完出口都比一次:部署时落进 config.meta.json 的那张表 vs 现在的选择。
// 只比两边都有的名字——档案里新加、还没部署过的站点集不算数,免得把"设置已保存但用户还
// 没点生效"的改动顺带应用出去。
export const dnsClassesFlipped = async (ctx, paths, store, selections) => {
  try {
    const meta = JSON.parse(await ctx.readFile(configMetaPath(paths)))
    const prev = meta && meta.dnsPolicyClasses
    const members = meta && Array.isArray(meta.dnsPolicyMembers) ? meta.dnsPolicyMembers : []
    if (!prev || typeof prev !== 'object' || !members.length) return false
    const builtin = builtinTags(typeof store.getGroups === 'function' ? store.getGroups() : [])
    const next = dnsPolicyClasses((store.getProfile() || {}).routing, members, builtin, selections || {})
    return Object.keys(next).some((k) => Object.prototype.hasOwnProperty.call(prev, k) && prev[k] !== next[k])
  } catch {
    // 没有元数据(还没部署过 / 老版本升上来的)就不动:下次部署会把表补上
    return false
  }
}

// 内核在跑就用它此刻的选择并顺手存快照(同时按"选择即默认"写进档案);读不到(内核停着、
// API 没起来)就退回上次的快照。
export const resolveSelections = (store, live) => {
  const hasLive = live && typeof live === 'object' && Object.keys(live).length > 0
  if (hasLive) {
    try { store.setSelectionsSnapshot?.(live) } catch { /* 存不上不影响这次部署 */ }
    try { persistSelectionsAsDefaults(store, live) } catch { /* 写不进档案也不影响这次部署 */ }
    return live
  }
  try { return store.getSelectionsSnapshot?.() || {} } catch { return {} }
}

// deployConfig 对 start/verify/error 三个阶段都会自行调用 rollbackToDirect 回到直连,
// 但 rollbackToDirect 只管停服务/还原 DNS/撤防火墙,不动"开机自启"标志位——
// 若不在这里额外 disable,曾经 enable 过的内核在下次重启时仍会被 procd 拉起,
// 而此时配置/DNS 接管已经回滚,等于开机直接指向一份死配置。
const ROLLED_BACK_STAGES = new Set(['start', 'verify', 'error'])

export const STATUS_BY_STAGE = {
  conflict: 409,
  validate: 409,
  // 规则集拉不下来是外部依赖(GitHub / 加速站)不可用,不是请求本身有问题,也没动
  // 任何系统状态 —— 用 503 与"配置有毛病"的 409 区分开。
  rulesets: 503,
  start: 500,
  verify: 500,
  error: 500,
}

// 从当前 store 状态(profile + 节点 + 按区域分组)组装一份 sing-box 配置。
// clash secret 独立存储,只在此处临时注入 profile 副本供 buildConfig 写入
// experimental.clash_api.secret,不回写 store.profile。
// systemDns 是路由器 WAN 下发的 DNS 上游(见 system/resolv.mjs):dnsmasq 接管模式下
// 直连侧要用它,不能让 sing-box 去问系统解析器——那时系统解析器就是 dnsmasq,而 dnsmasq
// 的上游又是 sing-box,一问就死循环。预览接口没有 ctx 也照样能出配置,回落到档案里的值。
export const buildCurrentConfig = (store, systemDns, { cacheFilePath, selections, tlsCert, localSubnets = [], directHostCidrs = [], ruleLists = {} } = {}) => {
  const profile = store.getProfile()
  const nodes = store.getNodes()
  const clashApiSecret = store.getClashSecret()
  const config = buildConfig({
    cacheFilePath,
    selections,
    ...(tlsCert ? { tlsCert } : {}),
    nodes,
    userGroups: store.getGroups(),
    subscriptions: store.getSubscriptions ? store.getSubscriptions() : [],
    profile: { ...profile, clashApiSecret },
    systemDns,
    // 本机接口网段:tun 的私网排除表要把它们挖出来(见 engine/config.mjs)
    localSubnets,
    // 节点 / 订阅域名此刻的解析结果,并进直连规则的 ip_cidr(见 system/resolve-hosts.mjs)
    directHostCidrs,
    // 规则集链接的形状表:每条链接编成了域名 / IP 哪几份 .srs(见 system/rule-lists.mjs)
    ruleLists,
  })
  return { config, profile }
}

// 「保存设置」与「让设置生效」之间只隔一次启动内核:各个设置页只管把自己那块写进档案,
// 真正生成配置、下规则集、接管 DNS/防火墙、起内核、失败回滚,统一在这里做一次。
// 所以启动/重启内核走的就是这条路径(server/api/service.mjs),不再有单独的"部署"动作。
// 「订阅和节点站点直连」开着时,把它涉及的域名解析成 IP;关着就不解析。
// 直接问 WAN 上游(systemDns),不走路由器自己的 resolver(见 system/resolve-hosts.mjs)。
const resolveDirectHostCidrs = async (store, systemDns, lookup) => {
  const profile = store.getProfile()
  if (profile.directForNodes === false) return []
  const { domains } = collectDirectHosts(store.getNodes(), store.getSubscriptions ? store.getSubscriptions() : [])
  return resolveHostsToCidrs(domains, lookup ? { lookup } : { servers: systemDns })
}

// 部署流水线(uci 写 dhcp/firewall、重启 dnsmasq、重启内核、等几秒验证)没法交错执行:
// 两条同时跑,一条的验证会撞上另一条的重启窗口,回滚把对方刚接管好的 DNS 撤掉却报成功。
// 面板的启动/重启、POST /deploy、Geo 刷新、计划任务、升级脚本的 CLI 都会调到这里,
// 进程内按调用顺序排队;跨进程(升级时 CLI 与面板)靠 store 里的锁记录互相等待。
let deployQueue = Promise.resolve()
const LOCK_KEY = 'openbox/deploy-lock'
const LOCK_STALE_MS = 3 * 60 * 1000
const LOCK_WAIT_MS = 90 * 1000

const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return Boolean(err && err.code === 'EPERM')
  }
}

export const withDeployLock = async (store, fn, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, waitMs = LOCK_WAIT_MS, pid = process.pid, alive = pidAlive } = {}) => {
  const canLock = store && typeof store.getRaw === 'function' && typeof store.setRaw === 'function' && typeof store.delRaw === 'function'
  const getLock = () => {
    try { return JSON.parse(store.getRaw(LOCK_KEY) || 'null') } catch { return null }
  }
  if (canLock) {
    const deadline = now() + waitMs
    for (;;) {
      const lock = getLock()
      const held = lock && lock.pid !== pid && now() - Number(lock.at || 0) < LOCK_STALE_MS && alive(lock.pid)
      if (!held) break
      if (now() > deadline) throw new Error(`另一个部署(pid ${lock.pid})正在进行,等了 ${Math.round(waitMs / 1000)} 秒仍未结束`)
      await sleep(500)
    }
    store.setRaw(LOCK_KEY, JSON.stringify({ pid, at: now() }))
  }
  try {
    return await fn()
  } finally {
    if (canLock) {
      const lock = getLock()
      if (!lock || lock.pid === pid) store.delRaw(LOCK_KEY)
    }
  }
}

export const runDeploy = (args) => {
  const run = deployQueue.then(() => withDeployLock(args.store, () => runDeployInner(args)))
  deployQueue = run.catch(() => {})
  return run
}

const runDeployInner = async ({ store, ctx, paths, fetchImpl = globalThis.fetch, lookup }) => {
  let result
  const startedAt = Date.now()
  try {
    const [systemDns, localSubnets] = await Promise.all([readSystemDns(ctx), readLocalSubnets(ctx)])
    const directHostCidrs = await resolveDirectHostCidrs(store, systemDns, lookup)
    const selections = resolveSelections(store, await fetchSelections(fetchImpl, store.getClashSecret()))
    // 规则集链接要排在生成配置之前:拉回来才知道每条名单编成了域名 / IP 哪几份 .srs,
    // 路由规则和 DNS 规则要凭这个决定引用哪几份(见 engine/routing-model.mjs)。
    // 这一步只往 rulesetDir 里写文件,失败原地返回,不动系统。
    const ruleLists = await ensureRuleLists(ctx, paths, (store.getProfile() || {}).routing, { fetchImpl, log: (m) => console.log(m) })
    if (!ruleLists.ok) {
      result = { ok: false, stage: 'rulesets', message: ruleLists.message }
    } else {
      const { config, profile } = buildCurrentConfig(store, systemDns, {
        cacheFilePath: paths.cacheDb, selections, tlsCert: { certPath: paths.tlsCert, keyPath: paths.tlsKey }, localSubnets, directHostCidrs,
        ruleLists: ruleLists.lists,
      })
      result = await deployConfig(ctx, paths, { config, profile, userGroups: store.getGroups(), selections })
    }
    store.setDeployState({
      stage: result.stage,
      message: result.message || '',
      at: Date.now(),
      badTags: result.badTags || [],
    })
    // 部署多久,日志里直接能看到——用户反馈「重启要一分钟」时不用猜
    console.log(`[deploy] ${result.ok ? '完成' : `失败(${result.stage})`},耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
  } catch (error) {
    // deployConfig 只在"落盘"之后的步骤自行 try/catch;冲突检测(detectConflicts)、
    // mkdirp、validateConfigObject 这些落盘之前的步骤抛出的异常会冒泡到这里。不兜底的话
    // setDeployState 不会执行——部署态停留在上一次的结果,前端轮询会显示过期状态。
    const message = error instanceof Error ? error.message : String(error)
    store.setDeployState({ stage: 'error', message, at: Date.now(), badTags: [] })
    result = { ok: false, stage: 'error', message, badTags: [] }
  }

  // enable/disable 只是"开机自启"标志位的同步动作,发生在结果已经 setDeployState 落盘
  // 之后——它失败不代表这次应用失败(内核已经在跑、配置已经生效),所以单独兜底,
  // 不让它把刚写入的成功状态改写成 error。
  // 失败时的规则和面板里「停止」一致:内核没在跑就把自启关掉。只看回滚过的阶段不够——
  // 升级脚本先停内核再跑这条流水线,在 conflict / rulesets / validate 阶段失败时内核
  // 停着、自启却还开着,下次开机 procd 会直接拉起磁盘上那份旧配置(dnsmasq 模式下
  // init 还会先把 dnsmasq 接管过去),等于开机指向一份没验证过的配置。
  try {
    if (result.ok) {
      await enableService(ctx, paths.initd.core)
    } else if (ROLLED_BACK_STAGES.has(result.stage) || !(await serviceStatus(ctx, paths.initd.core)).running) {
      await disableService(ctx, paths.initd.core)
    }
  } catch (error) {
    console.warn(
      'deploy: enable/disable service (autostart flag) failed:',
      error instanceof Error ? error.message : error,
    )
  }

  return { ok: result.ok, stage: result.stage, message: result.message || '', badTags: result.badTags || [] }
}
