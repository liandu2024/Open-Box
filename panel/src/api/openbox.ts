// Thin fetch wrappers around the Open-Box backend (panel/server/api/{profile,subscriptions,deploy}.mjs).
// Every call goes through fetchServerApi so a 401/403 auth hiccup mid-request is handled the
// same way the rest of the app already handles it (redirect to login/setup).
import { fetchServerApi } from '@/store/auth'

export interface OpenboxProfileRoutingCategory {
  ruleset: string
  target: string
}

export interface OpenboxProfileRouting {
  proxyTag?: string
  categories?: OpenboxProfileRoutingCategory[]
  directRulesets?: string[]
  adBlock?: boolean
  adRuleset?: string
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
export interface OpenboxProfile {
  region: string
  ipv6: boolean
  tun?: { autoRedirect?: boolean }
  dns: OpenboxProfileDns
  routing: OpenboxProfileRouting
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
export const RULESET_TAG_PATTERN = /^[A-Za-z0-9._-]+$/

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

export interface OpenboxPolicyGroup {
  name: string
  type: string
  nodeCount: number
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
export interface OpenboxUserGroup {
  id: string
  name: string
  type: OpenboxGroupType
  // true = 成员是"当前所有有效节点",随订阅刷新自动跟着变
  allNodes: boolean
  members: string[]
  interval?: string
  tolerance?: number
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

// Region policy groups are every 'selector'/'urltest' outbound except the top-level proxy
// selector itself — see server/engine/emit-groups.mjs: emitGroupOutbounds always emits
// `[proxySelector, ...regionGroups]`, and each region group's `outbounds` is its member node
// tags (so its length is the node count). Filtering by tag instead of position is robust to
// that ordering ever changing.
export const extractPolicyGroups = (
  config: OpenboxConfigPreview | null | undefined,
  proxyTag: string,
): OpenboxPolicyGroup[] => {
  if (!config || !Array.isArray(config.outbounds)) return []

  return config.outbounds
    .filter(
      (o): o is OpenboxConfigOutbound & { outbounds: string[] } =>
        (o.type === 'selector' || o.type === 'urltest') && o.tag !== proxyTag && Array.isArray(o.outbounds),
    )
    .map((o) => ({ name: o.tag, type: o.type, nodeCount: o.outbounds.length }))
}

// --- Kernel/service management, emergency rollback & penetration query (P4b Task 7) ---

export interface OpenboxServiceInfo {
  running: boolean
  raw: string
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

export interface OpenboxRollbackResult {
  ok: boolean
  actions: string[]
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

// The "get my internet back" button: stops the core, restores dnsmasq, removes firewall rules,
// and disables autostart (server/api/deploy.mjs's rollback route). rollbackToDirect itself is
// best-effort per-step and never throws — only the trailing disableService call can, which the
// server catches and answers 500 {ok:false,message}; requestJson turns that into a thrown Error
// the caller can render.
export const emergencyRollback = async (): Promise<OpenboxRollbackResult> => {
  return requestJson<OpenboxRollbackResult>('/api/openbox/rollback', { method: 'POST' })
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
}

export interface OpenboxPenetrationResult {
  matched: OpenboxPenetrationMatched | null
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
