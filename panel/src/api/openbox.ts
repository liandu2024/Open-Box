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

export interface OpenboxSubscription {
  id: string
  name: string
  url: string
  format: string
  nodeCount: number
  createdAt: number
  updatedAt: number
}

export interface OpenboxNodeSummary {
  tag: string
  originalTag: string
  type: string
  server: string
}

export interface OpenboxSubscriptionPreview {
  format: string
  nodes: OpenboxNodeSummary[]
  skipped: Array<{ name: string; type: string }>
}

export interface OpenboxDeployResult {
  ok: boolean
  stage: 'running' | 'conflict' | 'validate' | 'start' | 'verify' | 'error'
  message: string
  badTags: string[]
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

export const previewSubscription = async (payload: {
  url: string
}): Promise<OpenboxSubscriptionPreview> => {
  return requestJson<OpenboxSubscriptionPreview>('/api/openbox/subscriptions/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export const createSubscription = async (payload: {
  url: string
  name: string
}): Promise<{ id: string; name: string; nodeCount: number; skipped: Array<{ name: string; type: string }> }> => {
  return requestJson('/api/openbox/subscriptions', {
    method: 'POST',
    body: JSON.stringify(payload),
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
