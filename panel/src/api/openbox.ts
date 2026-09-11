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
  // 图标缩放:整数像素偏移,0 = 不缩放(见 components/common/IconScaleInput.vue)
  iconScale?: number
  // selector 的默认选中项(direct / 某个节点组 / block)
  default?: string
  // 停用 = 留在列表里,不进内核配置
  enabled?: boolean
  rulesets?: string[]
  // 规则集链接:一个网址,里面是现成的域名 / IP 名单(Clash 的 .list 或一行一个),
  // 部署时下回来编成规则集(见 server/system/rule-lists.mjs)
  ruleUrls?: string[]
  domain?: string[]
  domainSuffix?: string[]
  domainKeyword?: string[]
  ipCidr?: string[]
}

// 前置自定义分流:固定置顶、删不掉的一条,排在所有站点集之前。
// 和站点集的区别是每一行各带一个出口:站点集整个集共用一条线路、还只能选到节点组,
// 这里一行一条规则、一行一个出口,而且能选到具体节点。
export interface OpenboxCustomRule {
  // port:目标端口(「51820」「1000-2000」,逗号分隔多个),只有前置自定义分流有这一档
  type: 'domainSuffix' | 'domain' | 'domainKeyword' | 'ipCidr' | 'geosite' | 'geoip' | 'ruleUrl' | 'ruleset' | 'port'
  value: string
  // 这一行自己的出口:出站 tag(节点名或节点组名),或 direct / block 占位
  outbound: string
}

export interface OpenboxCustomPolicy {
  name?: string
  icon?: string
  iconScale?: number
  enabled?: boolean
  // 顺序即匹配顺序,先命中的先生效
  rules?: OpenboxCustomRule[]
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
  fallbackIconScale?: number
  // 代理页「策略」页签的显示顺序(站点集名字),在「策略设置」里拖出来的;和命中顺序分开
  displayOrder?: string[]
  // 改版前的地区层;服务端读出来时会翻译成站点集,并把结果写回档案
  regions?: unknown[]
  regionId?: string
  regionMode?: string
  outboundOptions?: OpenboxOutboundOptions
  // 前置自定义分流(固定置顶那一条)
  custom?: OpenboxCustomPolicy
  policies?: OpenboxRoutingPolicy[]
  adBlock?: boolean
  adRuleset?: string
  // 改版前的老字段,界面不再写;服务端读出来时会翻译成上面的新模型
  categories?: OpenboxProfileRoutingCategory[]
  directRulesets?: string[]
  fallback?: string
}

// DNS 劫持方式:off 不碰 DNS / hijack 防火墙(nft)劫持 / dnsmasq 转发(默认)
export type OpenboxDnsMode = 'off' | 'hijack' | 'dnsmasq'
// DNS 重写的一条规则(server/engine/dns-rewrite.mjs):源域名(精确或 *.泛域名)→ 目标域名(动态解析)或固定地址
export interface OpenboxDnsRewriteRule {
  id: string
  enabled?: boolean
  source: string
  domain?: string
  addresses?: string[]
  note?: string
}
export interface OpenboxProfileDns {
  filter?: DnsFilterSettings
  split?: boolean
  mode?: OpenboxDnsMode
  direct?: string
  proxy?: string
  // 走代理的域名由内核发占位地址(FakeIP 原型):域名交给选中的节点解析,解析和连接落在同一个节点
  fakeIpForProxy?: boolean
  // DNS 重写:initialized 记「默认规则补过了」,rules 是整份规则表(空数组 = 用户不要任何重写)
  rewrite?: { initialized?: number; rules: OpenboxDnsRewriteRule[] }
}

export interface DnsFilterList { id: string; name: string; url: string; enabled: boolean }
export interface DnsFilterSettings { enabled: boolean; lists: DnsFilterList[]; allowDomains: string[] }
export interface DnsFilterStatus {
  settings: DnsFilterSettings
  lists: Record<string, { count: number; unsupported: number; unsupportedExamples?: string[]; updatedAt: number; error?: string }>
  pending: boolean
  applied: { enabled: boolean; key: string } | null
  busy: boolean
  connected: boolean
}
export interface DnsFilterSummary {
  enabled: boolean; connected: boolean; queries: number; blocked: number; averageMs: number | null
  hourly: { hour: number; queries: number; blocked: number; elapsed: number; timed: number }[]
  topDomains: { domain: string; count: number }[]
}
export interface DnsFilterRecord { id: number; at: number; domain: string; qtype: string; source: string; result: string; list: string; elapsed: number | null }
export interface DnsFilterPreviewEntry {
  type: string; value: string; rule: string; action: 'allow' | 'block'; important: boolean; conditional: boolean
}
export type DnsFilterPreviewAction = 'all' | DnsFilterPreviewEntry['action']
export interface DnsFilterPreview {
  rows: DnsFilterPreviewEntry[]; count: number; total: number; page: number; pageSize: number
  ruleCount: number; unsupported: number; unsupportedExamples: string[]
  source: 'downloaded' | 'url'; updatedAt: number | null
}
export const fetchDnsFilter = () => requestJson<DnsFilterStatus>('/api/openbox/dns-filter')
export const saveDnsFilter = (settings: DnsFilterSettings) => requestJson('/api/openbox/dns-filter', { method: 'PUT', body: JSON.stringify(settings) })
export const applyDnsFilter = (update = false) => requestJson<DnsFilterStatus>('/api/openbox/dns-filter/apply', { method: 'POST', body: JSON.stringify({ update }) })
export const fetchDnsFilterSummary = () => requestJson<DnsFilterSummary>('/api/openbox/dns-filter/summary')
export const fetchDnsFilterRecords = (search: string, result: string, page: number, pageSize = 20) => requestJson<{ rows: DnsFilterRecord[]; total: number; page: number; pageSize: number }>(`/api/openbox/dns-filter/records?${new URLSearchParams({ search, result, page: String(page), pageSize: String(pageSize) })}`)
export const fetchDnsFilterPreview = (url: string, search: string, page: number, pageSize = 20, action: DnsFilterPreviewAction = 'all') => requestJson<DnsFilterPreview>(`/api/openbox/dns-filter/preview?${new URLSearchParams({ url, search, action, page: String(page), pageSize: String(pageSize) })}`)

// The backend deep-merges patches onto this shape (see server/store/openbox-store.mjs), so a
// profile is always fully populated — no field is ever missing on GET.
// 自动更新计划(面板进程内的定时器)
// channel 是自动更新走的通道;checkChannel 是卡片上手动检查 / 更新那个下拉框上次选的通道
export interface OpenboxUpdatePlans {
  openbox?: { auto?: boolean; hour?: number; days?: number; channel?: 'auto' | 'direct' | 'mirror'; checkChannel?: 'auto' | 'direct' | 'mirror' }
  geo?: { auto?: boolean; hour?: number; days?: number; channel?: 'auto' | 'direct' | 'mirror'; checkChannel?: 'auto' | 'direct' | 'mirror' }
}

// 「共享网络」里的一台服务器:本机开的一个入站(server/engine/servers.mjs)
// mixed:SOCKS5 + HTTP 共用一个端口,只给局域网用(server/engine/servers.mjs)
export type OpenboxServerProtocol = 'shadowsocks' | 'vless' | 'tuic' | 'hysteria2' | 'mixed'
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
  // 仅 mixed:可选的认证用户名(和 password 成对)
  username?: string
}

// 「终端分流」里的一条规则:这些来源 IP / 网段的全部流量走 outbound(server/engine/client-routes.mjs)
export interface OpenboxClientRoute {
  id: string
  enabled: boolean
  name: string
  sources: string[]
  // 出站名:内置直连 / 拒绝、节点组、站点集;不进内核(bypass)时可以为空
  outbound: string
  // 不进内核:按 MAC 在入口就放行(sing-box 1.14 的 exclude_mac_address,需要 auto_redirect),像 OpenClash 的黑名单
  bypass?: boolean
  macs?: string[]
}

export interface OpenboxProfile {
  updates?: OpenboxUpdatePlans
  servers?: OpenboxServer[]
  clientRoutes?: OpenboxClientRoute[]
  // 订阅链接和节点服务器的地址一律直连(默认开)
  directForNodes?: boolean
  region: string
  ipv6: boolean
  // IPv6 开着时走代理的目标怎么处理:node 交给节点(默认)/ ipv4 降为 IPv4(走代理的域名不给 AAAA,裸 v6 明确拒绝)
  ipv6Proxy?: 'node' | 'ipv4' | 'bypass'
  tun?: { autoRedirect?: boolean }
  dns: OpenboxProfileDns
  routing: OpenboxProfileRouting
  // 测速地址:testUrl 给自动择优组和面板延迟测试用;directTestUrl 只给内置直连用
  testUrl?: string
  directTestUrl?: string
  // 每日流量这些分析数据留多久(月,1~36)
  traffic?: { keepMonths?: number }
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
  // 重命名总开关:关掉后节点保留机场原始名字(手工改名、订阅名前缀照常),地区仍识别用于国旗和节点组;默认开
  enabled?: boolean
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

// 订阅的定期更新计划:每隔 days 天、hour 点重新拉一次(服务端定时任务来做)
export interface OpenboxSubscriptionAutoUpdate {
  enabled: boolean
  days: number
  hour: number
}

export interface OpenboxSubscription {
  id: string
  name: string
  url: string
  // 停用(false)的订阅节点不进内核,重启内核生效;没有这个字段 = 启用
  enabled?: boolean
  autoUpdate?: OpenboxSubscriptionAutoUpdate | null
  // 全部订阅地址(可以有多个,节点合在一起);url 是其中第一条,老记录只有 url
  urls?: string[]
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

// 订阅里没能导入的条目:reason 说明为什么(类型不认识 / 插件内核没有 / 字段不合法),detail 是插件名或报错原文
export interface OpenboxSkippedNode {
  name: string
  type: string
  reason?: 'unsupported-type' | 'unsupported-plugin' | 'invalid'
  detail?: string
}
export interface OpenboxSubscriptionPreview {
  format: string
  nodes: OpenboxNodeSummary[]
  skipped: OpenboxSkippedNode[]
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
  skipped: OpenboxSkippedNode[]
  // 节点池变没变:变了面板提示"重启内核生效"(订阅的动作从不自动重启内核)
  changed?: boolean
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

// 「DNS 重写」的两条默认项(恢复默认用)
export const fetchDnsRewriteDefaults = async (): Promise<OpenboxDnsRewriteRule[]> => {
  const data = await requestJson<{ dnsRewriteDefaults?: OpenboxDnsRewriteRule[] }>('/api/openbox/profile/defaults?region=cn')
  return data.dnsRewriteDefaults ?? []
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
  urls?: string[]
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
  urls?: string[]
  content?: string
  name: string
  renameOptions?: OpenboxRenameOptions
  autoUpdate?: OpenboxSubscriptionAutoUpdate
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
  payload: { name?: string; url?: string; urls?: string[]; content?: string; renameOptions?: OpenboxRenameOptions; autoUpdate?: OpenboxSubscriptionAutoUpdate; enabled?: boolean },
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
  urls?: string[]
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

// 用户自定义节点组(策略组)。内核只有 urltest / selector 两种——Clash 的 fallback 在 sing-box 里
// 不存在(实测 1.13.14 报 unknown outbound type)。failover(故障转移)是应用层类型:内核里落成
// 一个 selector(父组)+ 每个多节点页签一个私有 urltest 子组,主备切换由面板服务端后台做。
export type OpenboxGroupType = 'urltest' | 'selector' | 'failover'

// 故障转移的主备页签:顺序即优先级(第一个主用,后面依次备用),id 稳定(拖拽、保存、运行状态都按它认),
// name 可选(不决定主备顺序),members 只放真实节点名
export interface OpenboxFailoverLane {
  id: string
  name: string
  // 页签图标(和分组图标同一套短码);空 = 继承分组的图标
  icon?: string
  members: string[]
}
export interface OpenboxFailoverSettings {
  // 单次节点端到端探测的等待上限
  timeoutMs: number
  // 当前页签连续几轮确认没有可用节点才转移
  failureThreshold: number
  // 主用恢复后切回
  restorePrimary: boolean
  // 主用持续通过检查多久才切回
  recoveryHoldMs: number
}

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
  // 图标缩放:整数像素偏移,0 = 不缩放
  iconScale?: number
  // dynamic 用:命中任一关键词的节点即成员;为空 = 全部节点
  keywords?: string[]
  // static 用:手工挑出来的节点名/组名
  members: string[]
  interval?: string
  tolerance?: number
  // urltest 用:多久没流量经过就停止健康检查(内核默认 30 分钟,见 engine/user-groups.mjs)
  idleTimeout?: string
  // urltest / failover 用:这个组自己的测速地址,空 = 用档案里的全局地址
  testUrl?: string
  // failover 用:主备页签(唯一的成员来源;members 对故障转移没有意义,服务端会清空)
  lanes?: OpenboxFailoverLane[]
  failover?: OpenboxFailoverSettings
}

// 故障转移组的运行状态(服务端 system/failover-manager.mjs 维护)
export type OpenboxFailoverLaneHealth = 'up' | 'down' | 'unknown'
export interface OpenboxFailoverLaneStatus {
  id: string
  name: string
  index: number
  role: string
  // 派生模式:single = 直接用那个节点;urltest = 内部自动择优子组;empty = 没有有效节点
  mode: 'single' | 'urltest' | 'empty'
  ref: string | null
  subTag: string | null
  members: string[]
  valid: string[]
  health: OpenboxFailoverLaneHealth
  failStreak: number
  upSince: number | null
  // 多节点页签:内核子组此刻选中的节点,以及它是否被确认可用
  kernelNow: string | null
  confirmed: boolean | null
  nodes: Record<string, { ok: boolean | null; delay: number | null; at: number; reason: string | null } | null>
}
export interface OpenboxFailoverGroupStatus {
  id: string
  tag: string
  status: 'pending' | 'ok' | 'backup' | 'failing' | 'reject' | 'unknown'
  paused: string
  lastError: string
  rejectTag: string
  currentLaneId: string | null
  currentSince: number | null
  kernelNow: string | null
  lastSwitch: { at: number; from: { laneId: string | null; ref: string }; to: { laneId: string | null; ref: string }; reason: string } | null
  lastRoundAt: number | null
  nextRoundAt: number | null
  // 已应用的页签顺序(稳定 id);用户改了顺序后的「按新顺序重选」待办,办完为 null
  laneOrder?: string[]
  reorder?: { since: number; reason: 'priority-changed' | 'order-unknown'; evaluated: boolean } | null
  inFlight: boolean
  settings: { interval?: string; intervalMs?: number; tolerance?: number; testUrl?: string } & Partial<OpenboxFailoverSettings>
  lanes: OpenboxFailoverLaneStatus[]
}
export interface OpenboxFailoverStatus {
  version: string | null
  paused: string
  lastError?: string
  running?: boolean
  groups: OpenboxFailoverGroupStatus[]
}
export const fetchFailoverStatus = async (): Promise<OpenboxFailoverStatus> =>
  requestJson<OpenboxFailoverStatus>('/api/openbox/failover/status')
export const refreshFailover = async (): Promise<void> => {
  await requestJson<{ ok: boolean }>('/api/openbox/failover/refresh', { method: 'POST' })
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
  // 按规则集名查的带 tag,按「规则集链接」预览的带 url
  tag?: string
  url?: string
  total: number
  matched: number
  offset: number
  limit: number
  entries: { type: string; value: string }[]
}

// 「规则集链接」的预览:网址还没保存、没部署时就把它拉回来解析给用户看(server/api/rulesets.mjs)
export const fetchRuleListPreview = async (
  url: string,
  { q = '', offset = 0, limit = 50 }: { q?: string; offset?: number; limit?: number } = {},
): Promise<OpenboxRulesetEntries> => {
  const params = new URLSearchParams({ url, offset: String(offset), limit: String(limit) })
  if (q) params.set('q', q)
  return requestJson<OpenboxRulesetEntries>(`/api/openbox/rulesets/preview?${params.toString()}`)
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
): Promise<{
  ok: boolean
  groups: OpenboxUserGroup[]
  dropped: Array<{ name: string; reason: string }>
  // 成员里既不是节点也不是组的名字(生成配置时会被忽略);改名时服务端已把引用迁移过
  dangling?: Array<{ name: string; members: string[] }>
  renamed?: Array<{ from: string; to: string }>
}> =>
  requestJson('/api/openbox/groups', { method: 'PUT', body: JSON.stringify({ groups }) })

// 拖拽排序:传全部订阅 id 的新顺序;服务端把节点池也按这个顺序重排(选择器、内核出站顺序都跟着)
export const reorderSubscriptions = async (ids: string[]): Promise<{ ok: boolean; subscriptions: OpenboxSubscription[]; changed?: boolean }> => {
  return requestJson('/api/openbox/subscriptions/order', { method: 'PUT', body: JSON.stringify({ ids }) })
}

export const deleteSubscription = async (id: string): Promise<{ ok: boolean; changed?: boolean }> => {
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
  // 内核起来了但有降级(auto_redirect 起不来改成纯 tun)时的说明,见 server/system/deploy.mjs
  warning?: string
  ok: boolean
  code: number
  stderr: string
  // 启动 / 重启时整条部署流程的耗时(生成配置 → 校验 → 重启内核 → 确认在跑)
  durationMs?: number
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
  // 命中的是哪一条分流条目。站点集的名字就是它的出站名,所以不带这个字段、界面直接用
  // outbound;前置自定义分流的出站是具体节点或直连,名字对不上,服务端单独给出来。
  ownerName?: string
}

// 推算时按"不满足它"处理的规则:needs 是它要看而这次没给的信息;outbound / action 是它命中时的去向
export interface OpenboxRuleAssumption {
  index: number
  rule: Record<string, unknown>
  needs: ('sourceIp' | 'port' | 'ipVersion')[]
  outbound?: string
  action?: string
  // 它命中时下钻到的叶子出站;sameOutcome:和这次推算的结果是同一个出站(那它对这次查询没有影响)
  leaf?: string
  sameOutcome?: boolean
}
// DNS 规则里按来源分的那几条,没给来源时同样记成前提
export interface OpenboxDnsAssumption {
  ruleIndex: number
  needs: string[]
  sourceIpCidr: string[]
  server?: string
  action?: string
  sameOutcome?: boolean
}
// 规则页:这个域名命中了哪条 DNS 重写(server/api/route-test.mjs 的 decideDnsServer)
export interface OpenboxDnsRewriteHit {
  source: string
  domain: string
  addresses: string[]
}

export interface OpenboxPenetrationResult {
  matched: OpenboxPenetrationMatched | null
  // 要看终端来源 IP / 目标端口 / 地址族才能判、这次查询没给的规则:推算按"不满足它"的情况继续,这里把前提列出来
  assumed?: OpenboxRuleAssumption[]
  // 规则表里有预解析动作(按 IP 判的规则排在域名规则前面):以域名进内核的连接先解析成真实 IP 再判
  preResolve?: boolean
  // 按内核当前配置里的 DNS 规则推出来的解析方式(目标是 IP 时为 skipped)
  dns?:
    | { skipped: true }
    | { error: string }
    | { ruleIndex: number | null; rejected?: boolean; server?: { tag: string; type?: string; server?: string; detour?: string }; viaProxy?: boolean; assumed?: OpenboxDnsAssumption[]; rewrite?: OpenboxDnsRewriteHit }
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
  // 内核还在跑旧的分流配置(改了没重启)。为真时「规则路由」是按当前设置推算的,
  // 下面的「真实路由」才是内核此刻的实际行为,两者对不上是正常的。
  routingStale?: boolean
  // 部署时第一层的判定(config.meta.json 的 firstLayer,见 server/system/deploy.mjs)
  firstLayer?: {
    dnsMode: string
    dnsForward: 'none' | 'domains' | 'all'
    dnsForwardReason: string
    nativeBypass: { enabled: boolean; sets: string[]; reason: string; via?: 'nft' | 'route' }
    dnsSourceRules: boolean
    // 走代理的域名由内核发占位地址(FakeIP 原型)
    fakeIp?: boolean
    // IPv6 分层:off 老关闭语义 / node 代理 v6 交给节点 / ipv4 走代理的降为 IPv4
    ipv6?: 'off' | 'node' | 'ipv4'
  }
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

export type OpenboxUpdateChannel = 'auto' | 'direct' | 'mirror'
// Geo 规则集的"版本":上游两个仓库(SagerNet/sing-geosite、sing-geoip)的发布 tag
export type OpenboxGeoRepo = 'geosite' | 'geoip'
export type OpenboxGeoVersions = Partial<Record<OpenboxGeoRepo, string>>
export interface OpenboxRulesetsRefreshResult {
  ok: boolean
  updated: string[]
  failed: Array<{ tag: string; message: string }>
  total?: number
  versions?: OpenboxGeoVersions
  restarted: boolean
  restartMessage?: string
  message?: string
  // 一个规则集都没有可更新(内核还没成功部署过),message 里说明
  nothing?: boolean
}
export const refreshRulesets = (channel: OpenboxUpdateChannel = 'auto') =>
  requestJson<OpenboxRulesetsRefreshResult>('/api/openbox/rulesets/refresh', { method: 'POST', body: JSON.stringify({ channel }) })
export const fetchRulesetsRefreshStatus = () =>
  requestJson<{ count: number; lastAt: string; updated: string[]; failed: Array<{ tag: string; message: string }>; restarted: boolean; versions: OpenboxGeoVersions }>(
    '/api/openbox/rulesets/refresh/status',
  )
// 探上游有没有新版:current 是上次下载时记下的 tag(老安装没记过就是空),used 是配置用到的仓库
export const checkGeoUpdate = (channel: OpenboxUpdateChannel = 'auto') =>
  requestJson<{ current: OpenboxGeoVersions; latest: OpenboxGeoVersions; hasUpdate: boolean; via: string; used: OpenboxGeoRepo[] }>(
    `/api/openbox/rulesets/check?channel=${channel}`,
  )

// 「真实路由」:DNS 决策 + 内核解析 + 真实访问一次并从连接表里读实际链路
export interface OpenboxRouteTest {
  target: string
  dns:
    | { skipped: true }
    | { error: string }
    // runtimeChain:代理侧解析时查询实际经过的线路,detour 的站点集 → 节点组 → 节点(按内核此刻的选择);runtimeLeaf 是它的末尾
    // fakeIpRule:内核自己的 fakeip 规则(FakeIP 原型)先命中,A / AAAA 拿占位地址;server 是其它查询类型走的真解析器
    | { ruleIndex: number | null; rejected?: boolean; server?: { tag: string; type?: string; server?: string; detour?: string }; viaProxy?: boolean; stale?: 'direct' | 'proxy'; runtimeLeaf?: string; runtimeChain?: string[]; fakeIpRule?: number; assumed?: OpenboxDnsAssumption[]; rewrite?: OpenboxDnsRewriteHit }
  // fakeIp:答案落在 fake-ip 段(198.18.0.0/15),不是配置里那台 DNS 答的;fakeIpFrom 是代理侧解析时
  // 截下查询并应答的那个节点(detour 此刻落到的节点),直连解析回 fake-ip 时没有这个字段;
  // fakeIpLocal:占位地址是内核自己发的(FakeIP 原型),连接时按它找回域名交给选中的节点解析
  // ttl:答案的剩余 TTL(秒);cached:代理侧解析几毫秒就回来了,是内核缓存里的答案,这次没有经线路去问
  // answers 是 A 记录;档案开了 IPv6 时再查一次 AAAA 放 answers6(没开就没有这个字段)
  resolve?: { ok: boolean; status?: number; answers: string[]; answers6?: string[]; ok6?: boolean; status6?: number; error6?: string; ms: number; error?: string; fakeIp?: boolean; fakeIpFrom?: string; fakeIpLocal?: boolean; ttl?: number; cached?: boolean }
  // 有 AAAA 记录时按第一个 v6 地址再访问一次的结果(只有探测结果,没有连接表信息)
  exit6?: { connectTo: string; ok?: boolean; status?: number; ms?: number; error?: string }
  // 查询时指定了终端来源:上面的 DNS 判定是按该终端预测的;解析和访问仍是面板自己发起、没有该终端
  // 的来源,sourceVerified 恒为 false——终端的实际路径要在终端上观测
  context?: { sourceIp: string; predictedFor: 'terminal'; probeOrigin: 'panel'; sourceVerified: false }
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
    // connectTo:探测像终端一样按解析出来的第一个 IP 去连,这是那个 IP;目标本身是 IP 时没有
    connectTo?: string
    // viaProxy:链路末尾是节点(不是内置的直连 / 拒绝)
    viaProxy?: boolean
    notSeen?: boolean
    connectionsError?: string
    debug?: { connections: number; sample: string[] }
  }
}
// 服务端每次都会先清内核 DNS 缓存再探测,结果才是当前线路真的问出来的(见 api/route-test.mjs)
export const testRoute = (target: string, port?: number) =>
  requestJson<OpenboxRouteTest>('/api/openbox/route-test', { method: 'POST', body: JSON.stringify({ target, port }) })

// ---- 模拟 LAN 终端的真实路由测试(server/api/terminal-test.mjs)
// 面板在路由器上建一个虚拟终端(独立网络命名空间 + veth 接到 LAN 网桥 + DHCP 取址),让它像一台普通 LAN 设备
// 一样问 LAN 的 DNS、从 LAN 入口进入路由器;入口旁路还是进内核由实际入口规则决定,判旁路要有系统转发证据。
export type OpenboxTerminalMissing = 'root' | 'netns' | 'veth' | 'lan' | 'conntrack' | 'dhcp'
export interface OpenboxTerminalCapability {
  ok: boolean
  missing: OpenboxTerminalMissing[]
  lan?: { device: string; address: string; mask: number | null } | null
}
export interface OpenboxTerminalEntry {
  // bypass:入口旁路、系统直接转发;kernel:进了内核;unknown:证据不足,不判
  kind: 'bypass' | 'kernel' | 'unknown'
  // kernel 的依据:redirect(conntrack 回复方改写成路由器地址)/ tun(打了 tun 标记)/ connection-table(内核连接表里有)
  via?: 'redirect' | 'tun' | 'connection-table' | 'forward'
  // unknown 的原因:no-conntrack / dnat-elsewhere / no-route / route-tun / not-connected / no-connection / evidence-failed
  reason?: string
  redirectPort?: number
  rewrittenTo?: string
  device?: string
  gateway?: string
  masquerade?: boolean
  error?: string
  evidence: {
    conntrack?: string
    mark?: number | null
    route?: string
    kernelConn?: boolean
    set?: string | null
    setHit?: boolean
    conntrackError?: string
    kernelError?: string
    autoRedirect?: boolean
    tunDevice?: string
  }
}
export type OpenboxTerminalKernelDnsResult = 'exchanged' | 'cached' | 'optimistic' | 'failed' | 'rejected' | 'action' | 'pending'
export type OpenboxTerminalKernelDns =
  | { seen: false; reason: 'no-log' | 'not-seen'; error?: string }
  | {
    seen: true
    source: string
    ruleIndex: number | null
    ruleText: string
    action: string
    server: { tag: string; type: string; server: string; port: number | null; detour: string } | null
    viaProxy: boolean
    rewrite: boolean
    // 日志里实际拨号的出站(节点);chain 是 detour 此刻的选择链,叶子以日志为准
    outbound: string
    chain: string[]
    result: OpenboxTerminalKernelDnsResult
    rcode: string
    ttl: number | null
    answers: string[]
    ms: number | null
    error: string
    fakeIp: boolean
    // 占位地址是内核自己的 FakeIP 服务器发的(不是上游 / 对端回的)
    fakeIpLocal: boolean
    v6?: { result: OpenboxTerminalKernelDnsResult; rcode: string; answers: string[]; ms: number | null; error: string }
  }
export interface OpenboxTerminalTest {
  target: string
  mode: 'lan'
  capable: boolean
  missing?: OpenboxTerminalMissing[]
  // 具备条件但虚拟终端没建起来(建命名空间 / DHCP 失败),原因原文
  setupError?: string
  firstLayer?: { bypassEnabled: boolean; bypassSets: string[]; dnsMode: string; dnsForward: string }
  source?: { kind: 'virtual'; name: string; ip: string; mac: string; via: 'dhcp'; dns: string[]; gateway: string; lanDevice: string; reused: boolean; dhcpMs?: number }
  dns?: { skipped: true } | { server: string; ok: boolean; answers: string[]; answers6?: string[]; ms: number; error?: string; error6?: string }
  // dnsmasq 按转发清单把这个域名交给内核 DNS 还是直接问上游(配置推算)
  dnsForward?: { forward: 'kernel' | 'upstream' | 'unknown'; plan: string; suffix?: string; to?: string }
  // conntrack 里虚拟终端发往 DNS 服务器的查询:回复方是不是它本人(被内核劫持时回复方是 tun 对端)
  dnsEvidence?: { flows: number; hijacked: boolean; answeredBy: string; line: string }
  // 内核侧的解析过程(server/system/dns-trace.mjs 从内核日志流里截的,不是推算):命中哪条 DNS 规则、交给哪个
  // 解析器、经哪个节点发出、上游回了什么。seen=false 时 reason:no-log 连不上日志流 / not-seen 日志里没这条查询
  kernelDns?: OpenboxTerminalKernelDns
  entry?: OpenboxTerminalEntry
  kernel?: { seen: boolean; inbound?: string; rule?: string; rulePayload?: string; chains?: string[]; destinationIP?: string; host?: string; viaProxy?: boolean }
  exit?: {
    url: string
    port: number
    connectTo?: string
    localPort?: number
    connectMs?: number
    ok?: boolean
    status?: number
    ms?: number
    error?: string
    // 旁路时:系统从哪个设备转出去、经哪个网关、有没有 NAT 成该设备的地址
    forward?: { device: string; gateway: string; masquerade: boolean; address: string }
  }
  probeStderr?: string
  timing?: { totalMs: number }
}
export const fetchTerminalCapability = () => requestJson<OpenboxTerminalCapability>('/api/openbox/terminal-test/capability')
export const testTerminal = (target: string, port?: number) =>
  requestJson<OpenboxTerminalTest>('/api/openbox/terminal-test', { method: 'POST', body: JSON.stringify({ target, port }) })

// ---- 延迟历史(server/api/latency-history.mjs):每个节点最近 10 次测速结果,服务端记、所有浏览器共享
// node:组的样本带当时选中的节点;节点自己的样本没有
export type OpenboxLatencySample = { time: string; delay: number; node?: string }
export type OpenboxLatencyHistory = Record<string, OpenboxLatencySample[]>
export const fetchLatencyHistory = () => requestJson<{ history: OpenboxLatencyHistory; updatedAt: number }>('/api/openbox/latency-history')
// 只回最近一次写入的时刻:代理页每 15 秒轮询它,变了才拉整份
export const fetchLatencyHistoryVersion = () => requestJson<{ updatedAt: number }>('/api/openbox/latency-history/version')
// 面板手动测出来的超时:内核那边只是删记录,得自己报上去
export const postLatencySamples = (samples: Array<{ name: string; time: string; delay: number }>) =>
  requestJson<{ ok: boolean; history: OpenboxLatencyHistory }>('/api/openbox/latency-history/samples', { method: 'POST', body: JSON.stringify({ samples }) })
// 让服务端立刻读一次内核把新结果记下来(手动测完后调,不用等它下一个 tick)
export const syncLatencyHistory = () => requestJson<{ history: OpenboxLatencyHistory }>('/api/openbox/latency-history/sync', { method: 'POST', body: '{}' })

// ---- 每日流量(server/api/traffic.mjs)。up = 发往外网的字节(出口),down = 收到的(入口)
export interface OpenboxTrafficRow {
  key: string
  up: number
  down: number
  conns: number
  // 终端设备那份带:DHCP 租约里的主机名,没有就是空串
  name?: string
  // 这个地址是路由器自己的(WAN / LAN 接口地址),打环、路由器自身的直连会以它当"终端"出现
  self?: { iface: string; kind: 'lan' | 'wan' | 'other' }
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
  // 「统计直连流量」关掉时 excluded 为真:走内置直连出站(tag)的流量已从数字里扣掉
  direct?: { excluded: boolean; tag: string }
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
  // 24 小时曲线:每小时的进站 / 出站字节数(和总量同源)
  hours: OpenboxTrafficHour[]
  // 路由器此刻的本地小时(小时桶按它算),今天的曲线画到这里;老服务端没有这个字段
  nowHour?: number
  // 只看某个小时时是那个小时(0~23),整天是 null;小时明细只保留最近这么多天
  hour?: number | null
  hourDetailKeepDays?: number
  direct?: { excluded: boolean; tag: string }
}
export interface OpenboxTrafficHour {
  hour: number
  up: number
  down: number
  conns?: number
}
// 「分析数据保留时长」卡片:库里存了多少、大概占多大、每天涨多少
export interface OpenboxTrafficUsage {
  rows: number
  days: number
  bytes: number
  // 按天记录的日增量;小时明细(只留 hourKeepDays 天)另算 hourPerDay
  perDay: number
  hourPerDay?: number
  hourKeepDays?: number
  oldestDay: string
  newestDay: string
}
export const fetchTrafficUsage = () =>
  requestJson<OpenboxTrafficUsage>('/api/openbox/traffic/usage')

// countDirect=false 时带 direct=0:服务端把走直连出站的流量从数字里扣掉(概览「统计直连流量」开关)
const directParam = (countDirect: boolean) => (countDirect ? '' : '&direct=0')
export const fetchTrafficMonth = (month?: string, countDirect = true) =>
  requestJson<OpenboxTrafficMonth>(`/api/openbox/traffic/month?${month ? `month=${encodeURIComponent(month)}` : ''}${directParam(countDirect)}`)
// hour 给了就只看那个小时的明细(0~23),不给是整天
export const fetchTrafficDay = (day: string, limit = 500, hour?: number | null, countDirect = true) =>
  requestJson<OpenboxTrafficDay>(
    `/api/openbox/traffic/day?day=${encodeURIComponent(day)}&limit=${limit}${hour === null || hour === undefined ? '' : `&hour=${hour}`}${directParam(countDirect)}`,
  )
// 一条记录的构成:kind/key 定位点开的那条(终端 IP / 节点名 / 域名),by 是拆成哪一维
export type OpenboxTrafficDim = 'client' | 'node' | 'host'
export interface OpenboxTrafficDrill {
  day: string
  hour?: number | null
  kind: OpenboxTrafficDim
  key: string
  by: OpenboxTrafficDim
  count: number
  // 全部构成的合计(不受 limit 影响);父行总量减它 = 没记到交叉表里的部分
  sum?: { up: number; down: number }
  rows: OpenboxTrafficRow[]
}
export const fetchTrafficDrill = (
  day: string,
  kind: OpenboxTrafficDim,
  key: string,
  by: OpenboxTrafficDim,
  limit = 200,
  hour?: number | null,
  countDirect = true,
) =>
  requestJson<OpenboxTrafficDrill>(
    `/api/openbox/traffic/drill?day=${encodeURIComponent(day)}&kind=${kind}&key=${encodeURIComponent(key)}&by=${by}&limit=${limit}${hour === null || hour === undefined ? '' : `&hour=${hour}`}${directParam(countDirect)}`,
  )

// 导出 / 导入(server/api/backup.mjs):档案 + 节点组,可选订阅和节点
export interface OpenboxBackup {
  format: string
  version: number
  exportedAt: string
  openboxVersion?: string
  // 导出时勾了哪些可选部分(老文件没有这个字段)
  includes?: { subscriptions: boolean; clientRoutes: boolean; servers: boolean }
  profile: OpenboxProfile
  groups: unknown[]
  subscriptions?: unknown[]
  nodes?: unknown[]
  // 面板设置(config/* 的键值,不含密码)和背景图(data URL,空串是没有)
  panelSettings?: Record<string, string>
  backgroundImage?: string
}
export interface OpenboxBackupOptions {
  subscriptions: boolean
  clientRoutes: boolean
  servers: boolean
}
export type OpenboxBackupSubscriptionsMode = 'replace' | 'append'
export interface OpenboxBackupImportResult {
  ok: boolean
  imported: {
    profile: boolean
    groups: number
    subscriptions: number
    nodes: number
    subscriptionsMode: OpenboxBackupSubscriptionsMode | null
    panelSettings?: number
    backgroundImage?: boolean
  }
}
// 诊断包(server/api/diagnostics.mjs):版本、固件、内核状态、脱敏配置、最近日志,给 issue 用
export const fetchDiagnostics = () => requestJson<Record<string, unknown>>('/api/openbox/diagnostics')

export const fetchBackup = (opts: OpenboxBackupOptions) =>
  requestJson<OpenboxBackup>(
    `/api/openbox/backup?subscriptions=${opts.subscriptions ? 1 : 0}&clientRoutes=${opts.clientRoutes ? 1 : 0}&servers=${opts.servers ? 1 : 0}`,
  )
export const importBackup = (data: OpenboxBackup, subscriptionsMode: OpenboxBackupSubscriptionsMode = 'replace') =>
  requestJson<OpenboxBackupImportResult>(`/api/openbox/backup/import?subscriptions=${subscriptionsMode}`, {
    method: 'POST',
    body: JSON.stringify(data),
  })

// 共享网络 · 保存前的端口检测(server/api/servers.mjs)
export interface OpenboxPortCheck {
  ok: boolean
  reason?: 'invalid' | 'reserved' | 'server' | 'listening'
  name?: string
}
export const checkServerPort = (port: number, id: string) =>
  requestJson<OpenboxPortCheck>(`/api/openbox/servers/port-check?port=${port}&id=${encodeURIComponent(id)}`)

// 终端分流选来源用:DHCP 租约里的设备 + 今天流量里出现过的来源 IP
export const fetchKnownClients = () => requestJson<{ clients: Array<{ ip: string; name: string; mac?: string }> }>('/api/openbox/clients')
