import { ROUTE_NAME } from '@/constant'
import { ref } from 'vue'

export const ACCESS_PASSWORD_REQUIRED_CODE = 'ACCESS_PASSWORD_REQUIRED'
export const ACCESS_PASSWORD_INVALID_CODE = 'ACCESS_PASSWORD_INVALID'

const AUTH_STATUS_API_URL = '/api/auth/status'
const AUTH_LOGIN_API_URL = '/api/auth/login'
const AUTH_LOGOUT_API_URL = '/api/auth/logout'

type ServerAuthStatus = {
  enabled: boolean
  authenticated: boolean
}

type ServerAuthResponse = Partial<ServerAuthStatus> & {
  code?: string
  message?: string
}

export const serverAccessPasswordEnabled = ref(false)
export const serverAuthenticated = ref(true)
export const serverAuthInitialized = ref(false)

const defaultServerAuthStatus = (): ServerAuthStatus => ({
  enabled: false,
  authenticated: true,
})

const normalizeServerAuthStatus = (value: unknown): ServerAuthStatus => {
  const data = (value || {}) as Partial<ServerAuthStatus>
  const enabled = Boolean(data.enabled)
  const authenticated = enabled ? Boolean(data.authenticated) : true

  return {
    enabled,
    authenticated,
  }
}

export const applyServerAuthStatus = (value: unknown) => {
  const status = normalizeServerAuthStatus(value)

  serverAccessPasswordEnabled.value = status.enabled
  serverAuthenticated.value = status.authenticated
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

const normalizeRedirectPath = (value?: string) => {
  if (!value) {
    return ''
  }

  if (value.startsWith(`#/${ROUTE_NAME.login}`) || value.startsWith(`/${ROUTE_NAME.login}`)) {
    return ''
  }

  if (value.startsWith('#')) {
    return value.slice(1) || '/'
  }

  return value.startsWith('/') ? value : `/${value}`
}

export const getLoginHash = (redirectPath?: string) => {
  const params = new URLSearchParams()
  const normalizedRedirect = normalizeRedirectPath(redirectPath)

  if (normalizedRedirect) {
    params.set('redirect', normalizedRedirect)
  }

  return `#/${ROUTE_NAME.login}${params.size ? `?${params.toString()}` : ''}`
}

export const redirectToLogin = (redirectPath = getCurrentRoutePath()) => {
  const nextHash = getLoginHash(redirectPath)

  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash
  }
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

export const handlePossibleAuthRequiredResponse = async (
  response: Response,
  redirectPath?: string,
) => {
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
