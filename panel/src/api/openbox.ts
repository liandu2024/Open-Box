// Thin fetch wrappers around the Open-Box backend (panel/server/api/{profile,subscriptions,deploy}.mjs).
// Every call goes through fetchServerApi so a 401/403 auth hiccup mid-wizard is handled the
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
  featureDict?: OpenboxRenameFeatureEntry[]
  template?: string
  unknownLabel?: string
  seqPad?: number
}

export interface OpenboxSubscription {
  id: string
  name: string
  url: string
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
    const message = (data && typeof data === 'object' && 'error' in data && String(data.error)) || ''
    throw new Error(message || `request failed: ${response.status}`)
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
  renameOptions?: OpenboxRenameOptions
}): Promise<OpenboxSubscriptionPreview> => {
  return requestJson<OpenboxSubscriptionPreview>('/api/openbox/subscriptions/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// NOTE: the create route only accepts a fetchable `url` (no `content`-only body) — pasted
// content can be previewed but not saved directly. See server/api/subscriptions.mjs's `/` POST
// handler: `if (typeof url !== 'string' || !url.trim()) throw new Error('url is required')`.
export const createSubscription = async (payload: {
  url: string
  name: string
  renameOptions?: OpenboxRenameOptions
}): Promise<OpenboxSubscriptionSaveResult> => {
  return requestJson('/api/openbox/subscriptions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

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
// throw and lose the structured {stage,message,badTags} payload the wizard needs to explain
// *why* it failed, so this parses the body directly instead of reusing requestJson.
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
