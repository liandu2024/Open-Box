import { ROUTE_NAME } from '@/constant'
import { ref } from 'vue'

export const ACCESS_PASSWORD_REQUIRED_CODE = 'ACCESS_PASSWORD_REQUIRED'
export const ACCESS_PASSWORD_INVALID_CODE = 'ACCESS_PASSWORD_INVALID'
export const PASSWORD_SETUP_REQUIRED_CODE = 'PASSWORD_SETUP_REQUIRED'
export const PASSWORD_ALREADY_SET_CODE = 'PASSWORD_ALREADY_SET'
export const PASSWORD_TOO_SHORT_CODE = 'PASSWORD_TOO_SHORT'

const AUTH_STATUS_API_URL = '/api/auth/status'
const AUTH_LOGIN_API_URL = '/api/auth/login'
const AUTH_LOGOUT_API_URL = '/api/auth/logout'
const AUTH_SETUP_API_URL = '/api/auth/setup'
const AUTH_CHANGE_PASSWORD_API_URL = '/api/auth/change-password'

type ServerAuthStatus = {
  enabled: boolean
  authenticated: boolean
  // Whether the panel has an access password configured at all. False only
  // during first-run, before POST /api/auth/setup has ever succeeded.
  passwordSet: boolean
}

type ServerAuthResponse = Partial<ServerAuthStatus> & {
  code?: string
  error?: string
  message?: string
  ok?: boolean
}

export const serverAccessPasswordEnabled = ref(false)
export const serverAuthenticated = ref(true)
export const serverPasswordSet = ref(true)
export const serverAuthInitialized = ref(false)

const defaultServerAuthStatus = (): ServerAuthStatus => ({
  enabled: false,
  authenticated: true,
  // Fail open on a status-fetch failure (e.g. offline) rather than trapping
  // the user on the setup screen because of a transient network error.
  passwordSet: true,
})

const normalizeServerAuthStatus = (value: unknown): ServerAuthStatus => {
  const data = (value || {}) as Partial<ServerAuthStatus>
  const enabled = Boolean(data.enabled)
  const authenticated = enabled ? Boolean(data.authenticated) : true
  // Call sites that only report a 401/403 auth hiccup (e.g. markServerAuthenticationRequired)
  // don't know passwordSet and must not accidentally flip it — keep the last known value
  // whenever the caller didn't explicitly report one.
  const passwordSet = data.passwordSet === undefined ? serverPasswordSet.value : Boolean(data.passwordSet)

  return {
    enabled,
    authenticated,
    passwordSet,
  }
}

export const applyServerAuthStatus = (value: unknown) => {
  const status = normalizeServerAuthStatus(value)

  serverAccessPasswordEnabled.value = status.enabled
  serverAuthenticated.value = status.authenticated
  serverPasswordSet.value = status.passwordSet
  serverAuthInitialized.value = true

  return status
}

const getCurrentRoutePath = () => {
  const hash = window.location.hash || '#/'

  if (hash.startsWith('#')) {
    return hash.slice(1) || '/'
  }

  return hash || '/'
}

// Both the login screen and the password-setup screen are dead-end routes: a
// pending redirect should never point back at either one of them.
const AUTH_FLOW_ROUTE_NAMES: ROUTE_NAME[] = [ROUTE_NAME.login, ROUTE_NAME.setup]

const normalizeRedirectPath = (value?: string) => {
  if (!value) {
    return ''
  }

  if (AUTH_FLOW_ROUTE_NAMES.some((name) => value.startsWith(`#/${name}`) || value.startsWith(`/${name}`))) {
    return ''
  }

  if (value.startsWith('#')) {
    return value.slice(1) || '/'
  }

  return value.startsWith('/') ? value : `/${value}`
}

const getAuthFlowHash = (routeName: ROUTE_NAME, redirectPath?: string) => {
  const params = new URLSearchParams()
  const normalizedRedirect = normalizeRedirectPath(redirectPath)

  if (normalizedRedirect) {
    params.set('redirect', normalizedRedirect)
  }

  return `#/${routeName}${params.size ? `?${params.toString()}` : ''}`
}

export const getLoginHash = (redirectPath?: string) => getAuthFlowHash(ROUTE_NAME.login, redirectPath)
export const getSetupHash = (redirectPath?: string) => getAuthFlowHash(ROUTE_NAME.setup, redirectPath)

const redirectToAuthFlow = (routeName: ROUTE_NAME, redirectPath: string) => {
  const nextHash = getAuthFlowHash(routeName, redirectPath)

  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash
  }
}

export const redirectToLogin = (redirectPath = getCurrentRoutePath()) => {
  redirectToAuthFlow(ROUTE_NAME.login, redirectPath)
}

export const redirectToSetup = (redirectPath = getCurrentRoutePath()) => {
  redirectToAuthFlow(ROUTE_NAME.setup, redirectPath)
}

export const markServerAuthenticationRequired = (redirectPath?: string) => {
  applyServerAuthStatus({
    enabled: true,
    authenticated: false,
  })

  if (typeof window !== 'undefined') {
    redirectToLogin(redirectPath)
  }
}

export const markPasswordSetupRequired = (redirectPath?: string) => {
  applyServerAuthStatus({
    enabled: false,
    authenticated: true,
    passwordSet: false,
  })

  if (typeof window !== 'undefined') {
    redirectToSetup(redirectPath)
  }
}

export const handlePossibleAuthRequiredResponse = async (
  response: Response,
  redirectPath?: string,
) => {
  if (response.status === 403) {
    const data = (await response.clone().json().catch(() => null)) as ServerAuthResponse | null

    if (data?.error !== PASSWORD_SETUP_REQUIRED_CODE) {
      return false
    }

    markPasswordSetupRequired(redirectPath)
    return true
  }

  if (response.status !== 401) {
    return false
  }

  const data = (await response.clone().json().catch(() => null)) as ServerAuthResponse | null

  if (data?.code !== ACCESS_PASSWORD_REQUIRED_CODE) {
    return false
  }

  markServerAuthenticationRequired(redirectPath)
  return true
}

const getDashboardLocale = () => {
  if (typeof window === 'undefined') {
    return 'en-US'
  }

  return window.localStorage.getItem('config/language') || navigator.language || 'en-US'
}

const mergeServerApiHeaders = (headers?: HeadersInit) => {
  const mergedHeaders = new Headers(headers)

  if (!mergedHeaders.has('Accept-Language')) {
    mergedHeaders.set('Accept-Language', getDashboardLocale())
  }

  if (!mergedHeaders.has('X-Zashboard-Locale')) {
    mergedHeaders.set('X-Zashboard-Locale', getDashboardLocale())
  }

  return mergedHeaders
}

export const fetchServerApi = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const response = await fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers: mergeServerApiHeaders(init.headers),
  })

  await handlePossibleAuthRequiredResponse(response)
  return response
}

export const fetchServerAuthStatus = async () => {
  const response = await fetch(AUTH_STATUS_API_URL, {
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
    credentials: 'same-origin',
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch auth status: ${response.status}`)
  }

  return applyServerAuthStatus(await response.json())
}

export const initializeServerAuthState = async () => {
  try {
    return await fetchServerAuthStatus()
  } catch (error) {
    console.warn('Failed to initialize server auth state, falling back to open mode', error)
    return applyServerAuthStatus(defaultServerAuthStatus())
  }
}

export const loginWithAccessPassword = async (password: string) => {
  const response = await fetch(AUTH_LOGIN_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ password }),
    credentials: 'same-origin',
  })

  const data = (await response.json().catch(() => null)) as ServerAuthResponse | null

  if (!response.ok) {
    if (data?.code === ACCESS_PASSWORD_INVALID_CODE) {
      applyServerAuthStatus({
        enabled: true,
        authenticated: false,
      })

      return {
        ok: false as const,
        invalid: true,
        message: data.message || '',
      }
    }

    throw new Error(data?.message || `Failed to login: ${response.status}`)
  }

  applyServerAuthStatus(data)

  return {
    ok: true as const,
  }
}

export const logoutAccessPassword = async () => {
  try {
    await fetch(AUTH_LOGOUT_API_URL, {
      method: 'POST',
      credentials: 'same-origin',
    })
  } catch (error) {
    console.warn('Failed to logout access password session', error)
  }

  return fetchServerAuthStatus().catch(() =>
    applyServerAuthStatus({
      enabled: true,
      authenticated: false,
    }),
  )
}

export type PasswordFormFailureCode =
  | typeof PASSWORD_TOO_SHORT_CODE
  | typeof PASSWORD_ALREADY_SET_CODE
  | typeof ACCESS_PASSWORD_INVALID_CODE
  | typeof PASSWORD_SETUP_REQUIRED_CODE
  | 'UNKNOWN'

// Only valid while no password exists yet (backend returns 409 once one is set).
// Sets the password, enables auth, and logs the caller in immediately.
export const setupPassword = async (password: string) => {
  const response = await fetch(AUTH_SETUP_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ password }),
    credentials: 'same-origin',
  })

  const data = (await response.json().catch(() => null)) as ServerAuthResponse | null

  if (!response.ok) {
    if (data?.error === PASSWORD_ALREADY_SET_CODE) {
      // Another tab/session raced us and already set it — resync so the
      // router stops pointing at the setup screen.
      await fetchServerAuthStatus().catch(() => undefined)
    }

    return {
      ok: false as const,
      code: (data?.error as PasswordFormFailureCode | undefined) || 'UNKNOWN',
      message: data?.message || '',
    }
  }

  applyServerAuthStatus(data)

  return {
    ok: true as const,
  }
}

// Requires the current password; re-issues the session cookie on success so
// the caller's own session survives the change without a re-login.
export const changePassword = async (currentPassword: string, newPassword: string) => {
  const response = await fetch(AUTH_CHANGE_PASSWORD_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ currentPassword, newPassword }),
    credentials: 'same-origin',
  })

  const data = (await response.json().catch(() => null)) as ServerAuthResponse | null

  if (!response.ok) {
    if (data?.error === PASSWORD_SETUP_REQUIRED_CODE) {
      markPasswordSetupRequired()
    }

    const code: PasswordFormFailureCode =
      (data?.code as PasswordFormFailureCode | undefined) ||
      (data?.error as PasswordFormFailureCode | undefined) ||
      'UNKNOWN'

    return {
      ok: false as const,
      code,
      message: data?.message || '',
    }
  }

  applyServerAuthStatus({
    enabled: data?.enabled ?? true,
    authenticated: data?.authenticated ?? true,
    passwordSet: true,
  })

  return {
    ok: true as const,
  }
}
