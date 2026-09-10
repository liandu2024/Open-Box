import { prepareDnsFilter, readFilterArtifact } from '../system/dns-filter.mjs'
import { filterForwardPlan } from '../engine/dns-filter.mjs'
import { randomBytes } from 'node:crypto'
import { activeNodes } from './subscriptions.mjs'
import { readSystemDns } from '../system/resolv.mjs'
import { normalizeDnsRewrite, rewriteForwardDomains } from '../engine/dns-rewrite.mjs'
import { readLocalSubnets } from '../system/local-subnets.mjs'
import { resolveHostsToCidrs } from '../system/resolve-hosts.mjs'
import { collectDirectHosts } from '../engine/direct-hosts.mjs'
import { bypassPlanKey, dnsmasqForwardPlan, nativeBypassPlan, normalizeRouting, policyClasses } from '../engine/routing-model.mjs'
import { emitUserGroups } from '../engine/user-groups.mjs'
import { normalizeClientRoutes } from '../engine/client-routes.mjs'
import { builtinTags } from '../engine/user-groups.mjs'
import { buildConfig } from '../engine/config.mjs'
import { dnsPolicyClasses } from '../engine/dns.mjs'
import { deployConfig, configMetaPath } from '../system/deploy.mjs'
import { ensureRuleLists } from '../system/rule-lists.mjs'
import { resolveNativeBypass } from '../system/native-bypass.mjs'
import { dnsFakeIpEnabled, ipv6ProxyMode } from '../engine/dns.mjs'
import { policyOutboundOptions } from '../engine/routing-model.mjs'
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

// 第一层的计划(入口原生旁路的集合、DNS 转发的三态)也是生成配置时按当时的选择定死的。只按 IP
// 分流的站点集(geoip-cn → 直连)不进 DNS 分类表,代理页把它从直连切到代理时 dnsClassesFlipped
// 看不出来,入口的 nft 集合还按旧的放行(复审 R3)。所以再比一次 config.meta.json 里的 firstLayer。
export const firstLayerChanged = async (ctx, paths, store, selections) => {
  try {
    const meta = JSON.parse(await ctx.readFile(configMetaPath(paths)))
    const prev = meta && meta.firstLayer
    const members = meta && Array.isArray(meta.dnsPolicyMembers) ? meta.dnsPolicyMembers : []
    if (!prev || typeof prev !== 'object' || !members.length) return false
    const profile = store.getProfile() || {}
    const builtin = builtinTags(typeof store.getGroups === 'function' ? store.getGroups() : [])
    const dnsMode = (profile.dns && profile.dns.mode) || 'hijack'
    const bypass = nativeBypassPlan(profile.routing, { members, builtin, selections: selections || {}, clientRoutes: normalizeClientRoutes(profile.clientRoutes, { directTag: builtin.direct }), fakeIp: dnsFakeIpEnabled(profile), dnsMode })
    // 和元数据里计划阶段的结论比(pending 的重叠核对要到部署时才做)。指纹含候选集合、核对对象(名字 + 集合 +
    // CIDR)和 FakeIP 前提——"核对对象从一条变成两条"这种变化只比站点集名字会漏掉(第四轮 T2)。老元数据没有
    // 指纹就退回比集合 / pending 名字
    if (typeof prev.nativeBypassPlanKey === 'string') {
      if (prev.nativeBypassPlanKey !== bypassPlanKey(bypass)) return true
    } else {
      // 升级前写的元数据没有指纹:有 pending 的计划光比名字看不出核对对象的变化,宁可多重生成一次(之后的元数据
      // 就带指纹了);没有 pending 的照旧比集合
      const sortedSets = (v) => [...(Array.isArray(v) ? v : [])].sort().join('\n')
      const planned = prev.nativeBypassPlanned || { sets: (prev.nativeBypass || {}).sets, pending: [] }
      const pendingNames = (v) => [...(Array.isArray(v) ? v : [])].map((x) => (typeof x === 'string' ? x : x.policy)).sort().join('\n')
      if (sortedSets(planned.sets) !== sortedSets(bypass.sets) || pendingNames(planned.pending) !== pendingNames(bypass.pending)) return true
      if (bypass.pending.length || (Array.isArray(planned.pending) && planned.pending.length)) return true
    }
    // IPv6 分层 · 代理 v6 降为 IPv4:每条走代理的路由规则前面有一条 v6 拒绝,纯 IP 站点集在直连 / 代理之间
    // 切换时 DNS 分类看不出来,但这条保护要跟着变(第四轮 T3)。按元数据里生成时的出口类别表比,只比两边
    // 都有的名字(和 dnsClassesFlipped 一个道理)
    if (prev.ipv6 === 'ipv4' && ipv6ProxyMode(profile) === 'ipv4') {
      // 升级前的元数据没有出口类别表:不知道生成时的 v6 保护落在哪些站点集上,宁可多重生成一次
      if (!prev.policyClasses || typeof prev.policyClasses !== 'object') return true
      const next = policyClasses(profile.routing, members, builtin, selections || {})
      if (Object.keys(next).some((k) => Object.prototype.hasOwnProperty.call(prev.policyClasses, k) && (prev.policyClasses[k] === 'proxy') !== (next[k] === 'proxy'))) return true
    }
    if (prev.dnsMode === 'dnsmasq') {
      // 这里只能算到计划阶段(规则集要到部署时才展开),所以和元数据里计划阶段的模式比;老元数据
      // 没有这个字段时退回和实际模式比
      const forward = filterForwardPlan(profile, dnsmasqForwardPlan(profile.routing, members, builtin, selections || {}, { rewriteDomains: rewriteForwardDomains(normalizeDnsRewrite(profile.dns).rules) }))
      if (forward.mode !== (prev.dnsForwardPlanned || prev.dnsForward)) return true
    }
    return false
  } catch {
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
  // 被停止 / 回滚取消:请求本身没错,只是被后来的用户动作抢先了
  cancelled: 409,
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
// profilePatch:在当前档案上临时盖一层再生成(不落库)。部署时 auto_redirect 起不来要降级
// 重试就靠它把 tun.autoRedirect 关掉重生成一份(见 system/deploy.mjs)。
// 当前档案 + 此刻的选择 → 旁路计划(纯函数那一步)。部署前和选择同步时都用它,口径一致
export const currentBypassPlan = (store, selections) => {
  const profile = store.getProfile() || {}
  const groups = typeof store.getGroups === 'function' ? store.getGroups() : []
  const builtin = builtinTags(groups)
  const { publicTags } = emitUserGroups(groups, activeNodes(store), {})
  const members = policyOutboundOptions(normalizeRouting(profile.routing).outboundOptions, publicTags, builtin)
  return nativeBypassPlan(profile.routing, { members, builtin, selections: selections || {}, clientRoutes: normalizeClientRoutes(profile.clientRoutes, { directTag: builtin.direct }), fakeIp: dnsFakeIpEnabled(profile), dnsMode: (profile.dns && profile.dns.mode) || 'hijack' })
}

// 代理页改完出口之后的同步判断 + 执行:DNS 分类翻面、或第一层计划(入口旁路指纹 / DNS 转发三态 / v6 保护
// 的出口类别)变了,就在后台重新生成配置并重启内核。index.mjs 的选择同步和开发路由器的运行时验收都走这
// 一个入口,保证"判断变了"之后调用方真的执行了更新(第四轮 T2 / T3)
export const regenerateIfPlanChanged = async ({ store, ctx, paths, selections, log = () => {}, deploy = runDeploy }) => {
  const dnsFlipped = await dnsClassesFlipped(ctx, paths, store, selections)
  const planChanged = dnsFlipped ? false : await firstLayerChanged(ctx, paths, store, selections)
  if (!dnsFlipped && !planChanged) return { regenerated: false, reason: '' }
  const reason = dnsFlipped ? '站点集在直连/代理之间翻面' : '第一层计划(入口旁路 / DNS 转发 / v6 保护)变了'
  log(`[proxies] ${reason},后台重新生成配置`)
  const result = await deploy({ store, ctx, paths })
  if (!result.ok) log(`[proxies] 重新生成配置失败(${result.stage}):${result.message}`)
  return { regenerated: true, reason, result }
}

export const buildCurrentConfig = (store, systemDns, { cacheFilePath, selections, tlsCert, localSubnets = [], directHostCidrs = [], ruleLists = {}, profilePatch, nativeBypass } = {}) => {
  const profile = profilePatch ? { ...store.getProfile(), ...profilePatch } : store.getProfile()
  // 停用的订阅的节点不进内核(api/subscriptions.mjs 的 activeNodes)
  const nodes = activeNodes(store)
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
    nativeBypass,
    dnsFilter: readFilterArtifact(store),
  })
  // 故障转移的运行映射(父组 / 页签 / 有效节点 / 子组 tag / 检测参数):和配置同一次生成,写进 config.meta.json
  // 给后台管理器和界面用
  const { failover } = emitUserGroups(store.getGroups(), nodes, { testUrl: profile.testUrl })
  return { config, profile, failover }
}

// 「保存设置」与「让设置生效」之间只隔一次启动内核:各个设置页只管把自己那块写进档案,
// 真正生成配置、下规则集、接管 DNS/防火墙、起内核、失败回滚,统一在这里做一次。
// 所以启动/重启内核走的就是这条路径(server/api/service.mjs),不再有单独的"部署"动作。
// 「订阅和节点站点直连」开着时,把它涉及的域名解析成 IP;关着就不解析。
// 直接问 WAN 上游(systemDns),不走路由器自己的 resolver(见 system/resolve-hosts.mjs)。
const resolveDirectHostCidrs = async (store, systemDns, lookup) => {
  const profile = store.getProfile()
  if (profile.directForNodes === false) return []
  const { domains } = collectDirectHosts(activeNodes(store), store.getSubscriptions ? store.getSubscriptions() : [])
  return resolveHostsToCidrs(domains, lookup ? { lookup } : { servers: systemDns })
}

// 部署流水线(uci 写 dhcp/firewall、重启 dnsmasq、重启内核、等几秒验证)没法交错执行:
// 两条同时跑,一条的验证会撞上另一条的重启窗口,回滚把对方刚接管好的 DNS 撤掉却报成功。
// 面板的启动/重启、POST /deploy、Geo 刷新、计划任务、升级脚本的 CLI 都会调到这里,
// 进程内按调用顺序排队;跨进程(升级时 CLI 与面板)靠 store 里的锁记录互相等待。
let deployQueue = Promise.resolve()
const LOCK_KEY = 'openbox/deploy-lock'
// 持有者每隔 HEARTBEAT 刷新一次锁上的时间戳;超过 STALE 没刷新 = 持有者卡死(进程还在但
// 事件循环挂了),别的进程可以接管。以前没有续租,慢一点的部署(规则集下载 / 编译超过 3 分钟)
// 持有者活得好好的,另一个进程照样闯进来一起写 config、改 DNS、交错重启。
const LOCK_STALE_MS = 3 * 60 * 1000
const LOCK_HEARTBEAT_MS = 20 * 1000
const LOCK_WAIT_MS = 90 * 1000

// 「停止」「回滚」进来时把正在跑 / 排队中的部署标成取消:部署在几个安全点上检查,取消了就
// 不再往下走(没动系统的直接退出;动了 DNS / 防火墙但还没起内核的先回滚;已经起了内核的
// 让排在后面的停止动作去处理),也不会在结尾把开机自启重新打开。
let stopGeneration = 0
export const cancelPendingDeploys = () => { stopGeneration += 1 }

const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return Boolean(err && err.code === 'EPERM')
  }
}

export const withDeployLock = async (store, fn, {
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, waitMs = LOCK_WAIT_MS, pid = process.pid, alive = pidAlive,
  heartbeatMs = LOCK_HEARTBEAT_MS, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
} = {}) => {
  const canLock = store && typeof store.getRaw === 'function' && typeof store.setRaw === 'function' && typeof store.delRaw === 'function'
  const getLock = () => {
    try { return JSON.parse(store.getRaw(LOCK_KEY) || 'null') } catch { return null }
  }
  // 锁上带一个随机 token:同一进程内的两次部署、以及被复用的 PID,都不会把别人的锁当成自己的
  const token = randomBytes(8).toString('hex')
  const mine = (lock) => Boolean(lock && lock.pid === pid && lock.token === token)
  let beat = null
  if (canLock) {
    const deadline = now() + waitMs
    for (;;) {
      const lock = getLock()
      const held = lock && !mine(lock) && now() - Number(lock.at || 0) < LOCK_STALE_MS && alive(lock.pid)
      if (!held) {
        store.setRaw(LOCK_KEY, JSON.stringify({ pid, at: now(), token }))
        // 写完再读一次:两个进程同时抢,后写的赢,先写的看到锁不是自己的就回去继续等。不是原子
        // CAS(存储只有 get / set),但并发窗口从"整个部署"缩到两次写之间的几毫秒。
        if (mine(getLock())) break
      }
      if (now() > deadline) throw new Error(`另一个部署(pid ${lock && lock.pid})正在进行,等了 ${Math.round(waitMs / 1000)} 秒仍未结束`)
      await sleep(500)
    }
    beat = setIntervalImpl(() => {
      const lock = getLock()
      if (mine(lock)) store.setRaw(LOCK_KEY, JSON.stringify({ ...lock, at: now() }))
    }, heartbeatMs)
    if (beat && typeof beat.unref === 'function') beat.unref()
  }
  try {
    return await fn()
  } finally {
    if (canLock) {
      if (beat) clearIntervalImpl(beat)
      if (mine(getLock())) store.delRaw(LOCK_KEY)
    }
  }
}

// 停止 / 回滚这类会改服务、DNS、防火墙的动作和部署共用同一条队列、同一把锁:以前它们绕过
// 队列直接动系统,停止已经报成功、排在前面的旧部署随后照样把内核拉起来、把自启打开。
export const runExclusive = (store, fn) => {
  const run = deployQueue.then(() => withDeployLock(store, fn))
  deployQueue = run.catch(() => {})
  return run
}

export const runDeploy = (args) => {
  // 排队时就记下代数:排队期间来了停止,这次部署轮到时第一个检查点就退出,不再把内核拉起来
  const generation = stopGeneration
  const isCancelled = () => stopGeneration !== generation
  const run = deployQueue.then(() => withDeployLock(args.store, () => runDeployInner({ ...args, isCancelled })))
  deployQueue = run.catch(() => {})
  return run
}

const CANCELLED = { ok: false, stage: 'cancelled', message: '部署被「停止」取消,没有改动系统', badTags: [] }

// 每次部署一个序号:后台盯晚崩溃的那段发现已经有新的部署开始就退出,不和它抢
let deploySerial = 0

const runDeployInner = async ({ store, ctx, paths, fetchImpl = globalThis.fetch, lookup, isCancelled = () => false, lateWatch = true, refreshDnsFilter = false }) => {
  let result
  const startedAt = Date.now()
  const serial = ++deploySerial
  try {
    if (isCancelled()) {
      store.setDeployState({ stage: CANCELLED.stage, message: CANCELLED.message, at: Date.now(), badTags: [] })
      return { ...CANCELLED }
    }
    const [systemDns, localSubnets] = await Promise.all([readSystemDns(ctx), readLocalSubnets(ctx)])
    const directHostCidrs = await resolveDirectHostCidrs(store, systemDns, lookup)
    const selections = resolveSelections(store, await fetchSelections(fetchImpl, store.getClashSecret()))
    await prepareDnsFilter({ store, ctx, paths, force: refreshDnsFilter })
    // 规则集链接要排在生成配置之前:拉回来才知道每条名单编成了域名 / IP 哪几份 .srs,
    // 路由规则和 DNS 规则要凭这个决定引用哪几份(见 engine/routing-model.mjs)。
    // 这一步只往 rulesetDir 里写文件,失败原地返回,不动系统。
    const ruleLists = await ensureRuleLists(ctx, paths, (store.getProfile() || {}).routing, { fetchImpl, log: (m) => console.log(m) })
    if (!ruleLists.ok) {
      result = { ok: false, stage: 'rulesets', message: ruleLists.message }
    } else {
      // 入口原生旁路:纯函数先算,FakeIP 下留下的 pending 在这里解码两边的集合核对重叠(system/native-bypass.mjs),
      // 生成配置和元数据用同一份结论
      const nativeBypass = await resolveNativeBypass(ctx, paths, currentBypassPlan(store, selections))
      const buildOptions = {
        cacheFilePath: paths.cacheDb, selections, tlsCert: { certPath: paths.tlsCert, keyPath: paths.tlsKey }, localSubnets, directHostCidrs,
        ruleLists: ruleLists.lists, nativeBypass,
      }
      const { config, profile, failover } = buildCurrentConfig(store, systemDns, buildOptions)
      const prepMs = Date.now() - startedAt
      result = await deployConfig(ctx, paths, {
        config, profile, userGroups: store.getGroups(), selections, isCancelled, nativeBypass, failover,
        rebuild: (profilePatch) => buildCurrentConfig(store, systemDns, { ...buildOptions, profilePatch }).config,
      })
      if (result.warning) console.warn(`[deploy] ${result.warning}`)
      // 准备阶段 = 读系统 DNS / 解析节点域名 / 拉当前选择 / 规则集链接 / 生成配置
      result.timings = { 准备: prepMs, ...(result.timings || {}) }
    }
    store.setDeployState({
      stage: result.stage,
      // 成功但降过级(auto_redirect 起不来改纯 tun)的,把降级原因当消息存着,诊断包里能看到
      message: result.message || result.warning || '',
      at: Date.now(),
      badTags: result.badTags || [],
    })
    // 部署多久,日志里直接能看到——用户反馈「重启要一分钟」时不用猜
    const steps = Object.entries(result.timings || {}).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`).join(' · ')
    console.log(`[deploy] ${result.ok ? '完成' : `失败(${result.stage})`},耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s${steps ? `(${steps})` : ''}`)
    // 确认在跑之后再在后台盯两眼(GitHub #4:nft 那步在第 5 秒才崩,确认时还活着):崩了就降级 / 回滚并把结果写进部署状态
    if (result.ok && lateWatch && typeof result.lateCrashWatch === 'function') {
      const watch = result.lateCrashWatch
      watch({ isStale: () => serial !== deploySerial }).then(async (late) => {
        if (!late) return
        store.setDeployState({ stage: late.stage, message: late.message || late.warning || '', at: Date.now(), badTags: [] })
        console[late.ok ? 'warn' : 'error'](`[deploy] 内核在确认后崩溃:${late.message || late.warning}`)
        if (!late.ok) await disableService(ctx, paths.initd.core).catch(() => {})
      }).catch((err) => console.warn('[deploy] late crash watch failed:', err instanceof Error ? err.message : err))
    }
    delete result.lateCrashWatch
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
    if (result.stage === 'cancelled') {
      // 自启标志位交给排在后面的停止 / 回滚动作处理:这里既不能 enable(用户要的是停),
      // 也不抢着 disable(那是停止动作的事,它会做)
    } else if (result.ok) {
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
