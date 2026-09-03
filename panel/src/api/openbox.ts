// Thin fetch wrappers around the Open-Box backend (panel/server/api/{profile,subscriptions,deploy}.mjs).
// Every call goes through fetchServerApi so a 401/403 auth hiccup mid-request is handled the
// same way the rest of the app already handles it (redirect to login/setup).
import { fetchServerApi } from '@/store/auth'

export interface OpenboxProfileRoutingCategory {
  ruleset: string
  target: string
}

// 兜底站点集的默认选中项。'proxy' 是迁移留下的占位(表示"第一个节点组"),
// 其余就是一个出站名(direct / 某个节点组 / block)。
export type OpenboxRuleAction = 'direct' | 'proxy'

// 一个站点集 = 一组匹配规则 + 内核里一个同名 selector。它不记具体节点:
// selector 的成员由 outboundOptions 决定,用户在代理页点选。
export interface OpenboxRoutingPolicy {
  id: string
  name: string
  icon?: string
  // selector 的默认选中项(direct / 某个节点组 / block)
  default?: string
  // 停用 = 留在列表里,不进内核配置
  enabled?: boolean
  rulesets?: string[]
  domain?: string[]
  domainSuffix?: string[]
  domainKeyword?: string[]
  ipCidr?: string[]
}

// 「出站」页签:每个站点集的 selector 里能选到哪几类东西
export interface OpenboxOutboundOptions {
  direct?: boolean
  reject?: boolean
  groups?: boolean
}

export interface OpenboxProfileRouting {
  proxyTag?: string
  fallbackDefault?: string
  // 兜底站点集的名字(默认「其他」,就是内核里的出站 tag)和图标
  fallbackName?: string
  fallbackIcon?: string
  // 改版前的地区层;服务端读出来时会翻译成站点集,并把结果写回档案
  regions?: unknown[]
  regionId?: string
  regionMode?: string
  outboundOptions?: OpenboxOutboundOptions
  policies?: OpenboxRoutingPolicy[]
  adBlock?: boolean
  adRuleset?: string
  // 改版前的老字段,界面不再写;服务端读出来时会翻译成上面的新模型
  categories?: OpenboxProfileRoutingCategory[]
  directRulesets?: string[]
  fallback?: string
}

export interface OpenboxProfileDns {
  split?: boolean
  mode?: 'hijack' | 'dnsmasq'
  direct?: string
  proxy?: string
}

// The backend deep-merges patches onto this shape (see server/store/openbox-store.mjs), so a
// profile is always fully populated — no field is ever missing on GET.
// 自动更新计划(面板进程内的定时器)
export interface OpenboxUpdatePlans {
  openbox?: { auto?: boolean; hour?: number; channel?: 'auto' | 'direct' | 'mirror' }
  geo?: { auto?: boolean; hour?: number; days?: number }
}

// 「共享网络」里的一台服务器:本机开的一个入站(server/engine/servers.mjs)
export type OpenboxServerProtocol = 'shadowsocks' | 'vless' | 'tuic' | 'hysteria2'
export interface OpenboxServer {
  id: string
  enabled: boolean
  name: string
  protocol: OpenboxServerProtocol
  port: number
  // 客户端连接用的域名 / IP,只用来生成节点分享链接;默认取当前打开面板的主机名
  address?: string
  password?: string
  method?: string
  uuid?: string
  // 仅 VLESS:是否套自签 TLS
  tls?: boolean
  // 仅 Hysteria2:salamander 混淆密码
  obfs?: string
}

// 「终端分流」里的一条规则:这些来源 IP / 网段的全部流量走 outbound(server/engine/client-routes.mjs)
export interface OpenboxClientRoute {
  id: string
  enabled: boolean
  name: string
  sources: string[]
  // 出站名:内置直连 / 拒绝、节点组、站点集
  outbound: string
}

export interface OpenboxProfile {
  updates?: OpenboxUpdatePlans
  servers?: OpenboxServer[]
  clientRoutes?: OpenboxClientRoute[]
  // 订阅链接和节点服务器的地址一律直连(默认开)
  directForNodes?: boolean
  region: string
  ipv6: boolean
  tun?: { autoRedirect?: boolean }
  dns: OpenboxProfileDns
  routing: OpenboxProfileRouting
  // 测速地址:testUrl 给自动择优组和面板延迟测试用;directTestUrl 只给内置直连用
  testUrl?: string
  directTestUrl?: string
  rulesetDir?: string
}

export interface OpenboxProfileDefaults {
  region: string
  dns: OpenboxProfileDns
  routing: OpenboxProfileRouting
}

// Mirrors server/engine/rename.mjs / dictionaries.mjs — see
// src/components/subscription/rename-defaults.ts for why this shape has no persistence endpoint
// of its own and how the editor round-trips it.
export interface OpenboxRenameRegionEntry {
  code: string
  name: string
  keywords: string[]
}

export interface OpenboxRenameFeatureEntry {
  label: string
  keywords: string[]
}

export interface OpenboxRenameOptions {
  regionDict?: OpenboxRenameRegionEntry[]
  // 特征关键词扁平表:命中哪个词就把那个词本身(转大写)写进节点名。
  featureKeywords?: string[]
  // 过滤关键词:原始节点名命中任一词就整条不导入(机场的公告/广告条目)。
  excludeKeywords?: string[]
  // 逐条手工改名:原名 -> 用户指定的名字。改过名的节点不参与序号编号。
  overrides?: Record<string, string>
  // 逐条禁用:按原名记录,不导入也不占序号。与 excludeKeywords 分开——一个是规则,
  // 一个是手动例外。
  disabled?: string[]
  // 用订阅名做节点名前缀(「破晓 | 香港-01」)。存开关而不是前缀文本:存文本的话,
  // 改了订阅名前缀还留着旧名字。
  usePrefix?: boolean
  // 旧档案里的两层结构,只为兼容读取而保留(见 server/engine/rename.mjs 的 toFeatureKeywords)
  featureDict?: OpenboxRenameFeatureEntry[]
  template?: string
  unknownLabel?: string
  seqPad?: number
}

export interface OpenboxSubscription {
  id: string
  name: string
  url: string
  // 「节点」模式(粘贴保存)的订阅没有 url,内容存在这里
  content?: string
  format: string
  nodeCount: number
  renameOptions?: OpenboxRenameOptions
  createdAt: number
  updatedAt: number
}

export interface OpenboxNodeSummary {
  tag: string
  originalTag: string
  type: string
  server: string
}

export interface OpenboxRenamePreviewEntry {
  originalTag: string
  newTag: string
  // 命中的地区所绑定的国家代码(ISO 3166-1 alpha-2),没命中任何地区时为空。
  // 界面按它显示国旗——不从名字反推,名字可能被手工改过、也可能带订阅名前缀。
  regionCode?: string
}

export interface OpenboxNodeGroup {
  name: string
  type: string
  nodeTags: string[]
}

export interface OpenboxSubscriptionPreview {
  format: string
  nodes: OpenboxNodeSummary[]
  skipped: Array<{ name: string; type: string }>
  // 被过滤关键词剔除的条目
  excluded?: Array<{ name: string }>
  // 被逐条禁用的条目
  disabled?: Array<{ name: string }>
  preview: OpenboxRenamePreviewEntry[]
  groups: OpenboxNodeGroup[]
}

export interface OpenboxSubscriptionSaveResult {
  id: string
  name: string
  nodeCount: number
  skipped: Array<{ name: string; type: string }>
}

export interface OpenboxDeployResult {
  ok: boolean
  stage: 'running' | 'conflict' | 'validate' | 'start' | 'verify' | 'error'
  message: string
  badTags: string[]
}

// GET /deploy/state persists across reloads (store/openbox-store.mjs's DEFAULT_DEPLOY_STATE),
// so 'idle' (never deployed) is a real value here even though a live deployNow() call itself
// never returns it.
export interface OpenboxDeployState {
  stage: OpenboxDeployResult['stage'] | 'idle'
  message: string
  at: number
  badTags: string[]
}

// Mirrors server/api/profile.mjs's RULESET_TAG_PATTERN — used client-side purely so the UI can
// reject obviously-bad input before it round-trips to the server; the server's own check is
// still the actual authority (see validateProfilePatch).
export const RULESET_TAG_PATTERN = /^[A-Za-z0-9._!@-]+$/

// config/preview is raw sing-box config JSON straight out of buildConfig — only the shape this
// UI actually reads (outbounds) is typed; everything else passes through untouched.
export interface OpenboxConfigOutbound {
  type: string
  tag: string
  outbounds?: string[]
}

export interface OpenboxConfigPreview {
  outbounds?: OpenboxConfigOutbound[]
  [key: string]: unknown
}


// Error bodies aren't consistent across these routes — profile.mjs/subscriptions.mjs answer
// with {error}, deploy.mjs/service.mjs/penetration.mjs answer with {message} — so both are
// checked here (error takes priority since it was the original convention) rather than picking
// one and silently losing the server's actual reason on routes that use the other key.
const extractErrorMessage = (data: unknown): string => {
  if (!data || typeof data !== 'object') return ''
  if ('error' in data && data.error) return String(data.error)
  if ('message' in data && data.message) return String(data.message)
  return ''
}

// Backend routes always answer with a JSON body (success or error) — this normalizes the
// "throw with the server's own message" path so callers can show something meaningful instead
// of a bare HTTP status.
const requestJson = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetchServerApi(input, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...init?.headers,
    },
    ...init,
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(extractErrorMessage(data) || `request failed: ${response.status}`)
  }

  return data as T
}

export const fetchProfile = async (): Promise<OpenboxProfile> => {
  const data = await requestJson<{ profile: OpenboxProfile }>('/api/openbox/profile')
  return data.profile
}

export const fetchProfileDefaults = async (region: string): Promise<OpenboxProfileDefaults> => {
  const data = await requestJson<{ defaults: OpenboxProfileDefaults }>(
    `/api/openbox/profile/defaults?region=${encodeURIComponent(region)}`,
  )
  return data.defaults
}

export const saveProfile = async (patch: Record<string, unknown>): Promise<OpenboxProfile> => {
  const data = await requestJson<{ profile: OpenboxProfile }>('/api/openbox/profile', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
  return data.profile
}

export const fetchSubscriptions = async (): Promise<OpenboxSubscription[]> => {
  const data = await requestJson<{ subscriptions: OpenboxSubscription[] }>('/api/openbox/subscriptions')
  return data.subscriptions
}

// Preview never persists — safe to call on every debounced keystroke. Accepts either a `url`
// (server fetches it, SSRF-guarded) or raw pasted `content` (content wins if both are set, per
// server/api/subscriptions.mjs's resolveNodes).
export const previewSubscription = async (payload: {
  url?: string
  content?: string
  // 只在 renameOptions.usePrefix 打开时有意义:服务端拿它当节点名前缀。
  name?: string
  renameOptions?: OpenboxRenameOptions
}): Promise<OpenboxSubscriptionPreview> => {
  return requestJson<OpenboxSubscriptionPreview>('/api/openbox/subscriptions/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// url 与 content 二选一(见 server/api/subscriptions.mjs 的 normalizeSource):
// content 走的是「节点」模式——手上只有一堆分享链接、没有订阅地址时直接粘贴保存,
// 服务端会把内容一并存下来,以便日后改重命名规则时重新解析。
export const createSubscription = async (payload: {
  url?: string
  content?: string
  name: string
  renameOptions?: OpenboxRenameOptions
}): Promise<OpenboxSubscriptionSaveResult> => {
  return requestJson('/api/openbox/subscriptions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// Edits an existing subscription. Only the fields you pass are changed; omitted fields keep
// their stored value. The server skips re-fetching when neither url nor renameOptions changed,
// so a plain rename works even while the provider is unreachable (see subscriptions.mjs PATCH).
export const updateSubscription = async (
  id: string,
  payload: { name?: string; url?: string; content?: string; renameOptions?: OpenboxRenameOptions },
): Promise<OpenboxSubscriptionSaveResult> => {
  return requestJson(`/api/openbox/subscriptions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export interface OpenboxLatencyResult {
  ok: boolean
  ms?: number
  error?: string
}

// 服务端用 `sing-box tools fetch` 按节点的完整配置真的拨一次号并发一次 HTTPS 请求,
// 测的是端到端可用性与延迟(密码错、协议不支持、服务器没监听都会如实失败)。
// 传 url/content 让服务端自己重新解析,而不是把含密码的节点配置送到浏览器再送回来。
export const testNodeLatency = async (payload: {
  url?: string
  content?: string
  name?: string
  renameOptions?: OpenboxRenameOptions
  tags: string[]
  timeoutMs?: number
}): Promise<OpenboxLatencyResult[]> => {
  const data = await requestJson<{ results: OpenboxLatencyResult[] }>('/api/openbox/nodes/latency', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data.results
}

// 用户自定义节点组(策略组)。类型只有两种,因为 sing-box 只有这两种——Clash 的
// fallback 在 sing-box 里不存在(实测 1.13.14 报 unknown outbound type)。
export type OpenboxGroupType = 'urltest' | 'selector'

// 名字不用 OpenboxNodeGroup:那个已经被"按地区自动切分的组"占了(见上方,形状是
// { name, type, nodeTags }),两者是不同的东西,重名会让人以为可以互换。
// 成员怎么来:static 手工挑(members),dynamic 按关键词现算(keywords)。
// 动态组的意义是"以后加的订阅也自动进来"——成员在生成配置时按当前节点算。
export type OpenboxGroupMode = 'static' | 'dynamic'

export interface OpenboxUserGroup {
  id: string
  name: string
  type: OpenboxGroupType
  mode: OpenboxGroupMode
  // 内置出站:直连(direct)/拒绝(block)。和节点组同在「节点管理」列表里,可改名、换图标、
  // 排序、停用,但删不掉。只由固定 id 决定,服务端不信任传上去的值。
  kind?: 'direct' | 'block'
  // 停用 = 不写进配置、站点集里选不到。缺省视为启用。
  enabled?: boolean
  // 国家代码(ISO 3166-1 alpha-2),空 = 不显示图标。纯界面用,不进 sing-box 配置。
  icon?: string
  // dynamic 用:命中任一关键词的节点即成员;为空 = 全部节点
  keywords?: string[]
  // static 用:手工挑出来的节点名/组名
  members: string[]
  interval?: string
  tolerance?: number
  // urltest 用:这个组自己的测速地址,空 = 用档案里的全局地址
  testUrl?: string
}

export interface OpenboxGroupsPayload {
  groups: OpenboxUserGroup[]
  types: OpenboxGroupType[]
  // 带订阅名,供成员选择器按订阅筛选;组没有订阅归属,不在这个列表里
  availableNodes: Array<{ name: string; subscription: string }>
  availableGroups: string[]
}

export const fetchNodeGroups = async (): Promise<OpenboxGroupsPayload> =>
  requestJson<OpenboxGroupsPayload>('/api/openbox/groups')

// 规则集「详情」:一个 geosite/geoip 分类里到底有哪些域名/IP。
// 服务端把 .srs 交给内核自己解码(sing-box rule-set decompile),所以看到的就是
// 内核会匹配的那份;本地没有的分类会现下一份。
export interface OpenboxRulesetEntries {
  tag: string
  total: number
  matched: number
  offset: number
  limit: number
  entries: { type: string; value: string }[]
}

export const fetchRulesetEntries = async (
  tag: string,
  { q = '', offset = 0, limit = 50 }: { q?: string; offset?: number; limit?: number } = {},
): Promise<OpenboxRulesetEntries> => {
  const params = new URLSearchParams({ tag, offset: String(offset), limit: String(limit) })
  if (q) params.set('q', q)
  return requestJson<OpenboxRulesetEntries>(`/api/openbox/rulesets/entries?${params.toString()}`)
}

// 整份覆盖而不是逐条改:组之间可以互相引用,逐条改会让中间状态出现悬空引用或环。
export const saveNodeGroups = async (
  groups: OpenboxUserGroup[],
): Promise<{ ok: boolean; groups: OpenboxUserGroup[]; dropped: Array<{ name: string; reason: string }> }> =>
  requestJson('/api/openbox/groups', { method: 'PUT', body: JSON.stringify({ groups }) })

export const deleteSubscription = async (id: string): Promise<{ ok: boolean }> => {
  return requestJson(`/api/openbox/subscriptions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

// Re-fetches from the subscription's saved url and replaces only that subscription's nodes.
// Omitting renameOptions reuses whatever was saved at create time (server-side default).
export const refreshSubscription = async (
  id: string,
  renameOptions?: OpenboxRenameOptions,
): Promise<OpenboxSubscriptionSaveResult> => {
  return requestJson(`/api/openbox/subscriptions/${encodeURIComponent(id)}/refresh`, {
    method: 'POST',
    body: JSON.stringify(renameOptions ? { renameOptions } : {}),
  })
}

// deploy.mjs answers with a non-2xx status for every non-'running' stage — requestJson would
// throw and lose the structured {stage,message,badTags} payload callers need to explain *why*
// it failed (see RoutingDeployBanner.vue / KernelDeployStateCard.vue), so this parses the body
// directly instead of reusing requestJson.
export const deployNow = async (): Promise<OpenboxDeployResult> => {
  const response = await fetchServerApi('/api/openbox/deploy', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })

  const data = (await response.json().catch(() => null)) as Partial<OpenboxDeployResult> | null

  return {
    ok: Boolean(data?.ok),
    stage: data?.stage || 'error',
    message: data?.message || '',
    badTags: data?.badTags || [],
  }
}

export const fetchDeployState = async (): Promise<OpenboxDeployState> => {
  const data = await requestJson<{ state: OpenboxDeployState }>('/api/openbox/deploy/state')
  return data.state
}

// Never persists — assembled fresh from the current (already-saved) profile + nodes on every
// call, so it's safe to call as often as needed to keep the read-only policy-group list current.
export const fetchConfigPreview = async (): Promise<OpenboxConfigPreview> => {
  const data = await requestJson<{ config: OpenboxConfigPreview }>('/api/openbox/config/preview')
  return data.config
}


// --- Kernel/service management, emergency rollback & penetration query (P4b Task 7) ---

export interface OpenboxServiceInfo {
  running: boolean
  raw: string
  // 只有内核那份带:开机自启是否开着
  autostart?: boolean
  // 只有内核那份带:进程运行时长(秒),没在跑或拿不到就是 null
  uptimeSeconds?: number | null
}

// Only ever populated with services detectConflicts actually found running (see
// server/system/conflicts.mjs) — `running` is always true in practice, but kept in the type
// since it's what the server literally sends.
export interface OpenboxConflictService {
  id: string
  label: string
  running: boolean
}

export interface OpenboxServiceStatus {
  core: OpenboxServiceInfo
  panel: OpenboxServiceInfo
  conflicts: OpenboxConflictService[]
}

export type OpenboxServiceAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable'

export interface OpenboxServiceActionResult {
  ok: boolean
  code: number
  stderr: string
}

export interface OpenboxKernelVersion {
  version: string
  raw: string
  // false 表示没读到版本(sing-box 缺失或无法执行),此时 version 为空字符串。
  ok: boolean
}

export const fetchServiceStatus = async (): Promise<OpenboxServiceStatus> => {
  return requestJson<OpenboxServiceStatus>('/api/openbox/service/status')
}

// POST /service/core/:action always answers 200 with {ok,code,stderr} for the five valid
// actions (see server/api/service.mjs) — a false `ok` here means the underlying init.d command
// itself failed (e.g. this dev machine has no /etc/init.d), not a request-level error, so it's
// never thrown; callers read `.ok` to decide how to render the result.
export const runServiceAction = async (action: OpenboxServiceAction): Promise<OpenboxServiceActionResult> => {
  return requestJson<OpenboxServiceActionResult>(`/api/openbox/service/core/${action}`, { method: 'POST' })
}

export const fetchKernelVersion = async (): Promise<OpenboxKernelVersion> => {
  return requestJson<OpenboxKernelVersion>('/api/openbox/kernel/version')
}

// Mirrors server/api/penetration.mjs's PENETRATION_TARGET_PATTERN — used client-side purely so
// the UI can reject an obviously flag-like target (e.g. "--help") before it round-trips to the
// server; the server's own check is still the actual authority.
export const PENETRATION_TARGET_PATTERN = /^[A-Za-z0-9._:-]+$/
export const isValidPenetrationTarget = (value: string): boolean => {
  return Boolean(value) && !value.startsWith('-') && PENETRATION_TARGET_PATTERN.test(value)
}

// The rule condition object is one entry of buildRoute()'s `route.rules` (server/engine/routing.mjs)
// — only the shape penetration.mjs ever echoes back (the private-IP check, or a rule-set match
// with its outbound/reject action) is typed; unconditional rules (sniff/dns hijack) never match
// so they never appear here.
export interface OpenboxPenetrationRuleCondition {
  ip_is_private?: boolean
  rule_set?: string
  outbound?: string
  action?: string
}

export interface OpenboxPenetrationMatched {
  index: number
  rule: OpenboxPenetrationRuleCondition
  outbound?: string
  action?: string
  // 具体命中的域名/IP 条目(规则集解码后逐条比出来的,或站点集里手写的 'custom');最多 20 条
  entries?: Array<{ type: string; value: string; source: string }>
  entriesTotal?: number
}

export interface OpenboxPenetrationResult {
  matched: OpenboxPenetrationMatched | null
  // 按内核当前配置里的 DNS 规则推出来的解析方式(目标是 IP 时为 skipped)
  dns?:
    | { skipped: true }
    | { error: string }
    | { ruleIndex: number | null; rejected?: boolean; server?: { tag: string; type?: string; server?: string; detour?: string }; viaProxy?: boolean }
  // Starts with the resolved policy target (outbound) and drills down through clash_api's `now`
  // field to the leaf node; empty when the match was an outright reject (nothing to route).
  chain: string[]
  finalOutbound: string | null
  // Present only when the chain couldn't be fully resolved (clash_api unreachable/non-2xx/bad
  // JSON) — `chain` still holds whatever was resolved before the failure (at least the starting
  // group name).
  chainError?: string
  // Present only when the server couldn't actually run `sing-box rule-set match` for some rule
  // along the way (missing binary, missing compiled .srs, or the process exiting abnormally with
  // no output — server/api/penetration.mjs's matchRuleSet). When this is set, `matched` is
  // deliberately left `null` and `finalOutbound` is `null` too — NOT a confident "nothing
  // matched, falls through to the default" answer, just "couldn't check". Render this distinctly
  // from a genuine no-match (P4b final review, Important 1).
  matchError?: string
}

export const queryPenetration = async (target: string): Promise<OpenboxPenetrationResult> => {
  return requestJson<OpenboxPenetrationResult>('/api/openbox/penetration', {
    method: 'POST',
    body: JSON.stringify({ target }),
  })
}

// 「域名穿透」:一个站点集会命中哪些域名/IP(规则集展开 + 手写条件),分档/搜索/排序/分页
export type OpenboxPolicyEntryFamily = 'domain' | 'ip' | 'other'
export interface OpenboxPolicyEntry {
  type: string
  family: OpenboxPolicyEntryFamily
  content: string
  // 来源:规则集名,或 'custom'(站点集里手写的条件)
  source: string
}
export interface OpenboxPolicyEntries {
  name: string
  fallback: boolean
  counts: { all: number; domain: number; ip: number }
  total: number
  matched: number
  offset: number
  limit: number
  hasMore: boolean
  entries: OpenboxPolicyEntry[]
  missing: string[]
}
export const fetchPolicyEntries = async (params: {
  name: string
  tab?: 'all' | 'domain' | 'ip'
  q?: string
  sort?: 'type' | 'content' | 'source' | ''
  dir?: 'asc' | 'desc'
  offset?: number
  limit?: number
}): Promise<OpenboxPolicyEntries> => {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) search.set(k, String(v))
  }
  return requestJson<OpenboxPolicyEntries>(`/api/openbox/policies/entries?${search.toString()}`)
}

// ---- Open-Box 自身升级 / Geo 规则集刷新 ----
export interface OpenboxUpdateProgress {
  stage: string
  pid?: string
  bytes: number | null
  total: number | null
  message: string
  running: boolean
}
export interface OpenboxUpdateStatus {
  version: string
  singboxVersion: string
  builtAt: string
  channel: { mode: 'direct' | 'mirror'; prefix: string }
  status: OpenboxUpdateProgress
  logTail: string
}
export const fetchUpdateStatus = () => requestJson<OpenboxUpdateStatus>('/api/openbox/update/status')
export const checkUpdate = () =>
  requestJson<{ current: string; latest: string; via: string; hasUpdate: boolean }>('/api/openbox/update/check')
export const runUpdate = (channel: 'auto' | 'direct' | 'mirror') =>
  requestJson<{ ok: boolean; output: string }>('/api/openbox/update/run', { method: 'POST', body: JSON.stringify({ channel }) })
export const cancelUpdate = () => requestJson<{ result: string }>('/api/openbox/update/cancel', { method: 'POST' })

export interface OpenboxRulesetsRefreshResult {
  ok: boolean
  updated: string[]
  failed: Array<{ tag: string; message: string }>
  total?: number
  restarted: boolean
  restartMessage?: string
  message?: string
}
export const refreshRulesets = () =>
  requestJson<OpenboxRulesetsRefreshResult>('/api/openbox/rulesets/refresh', { method: 'POST' })
export const fetchRulesetsRefreshStatus = () =>
  requestJson<{ count: number; lastAt: string; updated: string[]; failed: Array<{ tag: string; message: string }>; restarted: boolean }>(
    '/api/openbox/rulesets/refresh/status',
  )

// 「真实路由」:DNS 决策 + 内核解析 + 真实访问一次并从连接表里读实际链路
export interface OpenboxRouteTest {
  target: string
  dns:
    | { skipped: true }
    | { error: string }
    | { ruleIndex: number | null; rejected?: boolean; server?: { tag: string; type?: string; server?: string; detour?: string }; viaProxy?: boolean; stale?: 'direct' | 'proxy'; runtimeLeaf?: string }
  resolve?: { ok: boolean; status?: number; answers: string[]; ms: number; error?: string }
  exit: {
    url: string
    ok?: boolean
    status?: number
    ms?: number
    error?: string
    chains?: string[]
    rule?: string
    rulePayload?: string
    destinationIP?: string
    notSeen?: boolean
    connectionsError?: string
    debug?: { connections: number; sample: string[] }
  }
}
export const testRoute = (target: string, port?: number) =>
  requestJson<OpenboxRouteTest>('/api/openbox/route-test', { method: 'POST', body: JSON.stringify({ target, port }) })

// ---- 每日流量(server/api/traffic.mjs)。up = 发往外网的字节(出口),down = 收到的(入口)
export interface OpenboxTrafficRow {
  key: string
  up: number
  down: number
  conns: number
  // 访问终端那份带:DHCP 租约里的主机名,没有就是空串
  name?: string
}
export interface OpenboxTrafficDaySummary {
  day: string
  up: number
  down: number
  conns: number
}
export interface OpenboxTrafficMonth {
  month: string
  today: string
  days: OpenboxTrafficDaySummary[]
  total: { up: number; down: number; conns: number }
  avg: { up: number; down: number }
  avgDays: number
}
export interface OpenboxTrafficDay {
  day: string
  today: string
  total: { up: number; down: number; conns: number }
  nodes: OpenboxTrafficRow[]
  hosts: OpenboxTrafficRow[]
  clients: OpenboxTrafficRow[]
  hostsCount: number
  clientsCount: number
  // 总量减去各节点之和:没采样到的短连接
  other: { up: number; down: number }
}
export const fetchTrafficMonth = (month?: string) =>
  requestJson<OpenboxTrafficMonth>(`/api/openbox/traffic/month${month ? `?month=${encodeURIComponent(month)}` : ''}`)
export const fetchTrafficDay = (day: string, limit = 500) =>
  requestJson<OpenboxTrafficDay>(`/api/openbox/traffic/day?day=${encodeURIComponent(day)}&limit=${limit}`)

// 共享网络 · 保存前的端口检测(server/api/servers.mjs)
export interface OpenboxPortCheck {
  ok: boolean
  reason?: 'invalid' | 'reserved' | 'server' | 'listening'
  name?: string
}
export const checkServerPort = (port: number, id: string) =>
  requestJson<OpenboxPortCheck>(`/api/openbox/servers/port-check?port=${port}&id=${encodeURIComponent(id)}`)

// 终端分流选来源用:DHCP 租约里的设备 + 今天流量里出现过的来源 IP
export const fetchKnownClients = () => requestJson<{ clients: Array<{ ip: string; name: string }> }>('/api/openbox/clients')
