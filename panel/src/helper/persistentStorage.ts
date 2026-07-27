import { fetchServerApi, serverAccessPasswordEnabled, serverAuthenticated } from '@/store/auth'

const STORAGE_PREFIXES = ['config/']
const STORAGE_API_URL = '/api/storage'
const SYNC_DELAY_MS = 400
const LEGACY_ACCESS_AUTH_KEY = 'config/access-password-authenticated'

let syncTimer: number | undefined
let patchInstalled = false

const isManagedKey = (key: string) => {
  return STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
}

const readLocalSnapshot = () => {
  const snapshot: Record<string, string> = {}

  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)

    if (!key || !isManagedKey(key)) continue

    const value = localStorage.getItem(key)

    if (value !== null) {
      snapshot[key] = value
    }
  }

  return snapshot
}

export const getManagedStorageSnapshot = () => {
  return readLocalSnapshot()
}

export const normalizeManagedStorageSnapshot = (snapshot: Record<string, unknown>) => {
  const normalized: Record<string, string> = {}

  Object.entries(snapshot).forEach(([key, value]) => {
    if (key === LEGACY_ACCESS_AUTH_KEY) {
      return
    }

    if (!isManagedKey(key) || typeof value !== 'string') {
      return
    }

    normalized[key] = value
  })

  return normalized
}

export const stabilizeManagedStorageSnapshot = (
  snapshot: Record<string, string>,
  fallbackSnapshot: Record<string, string> = {},
) => {
  void fallbackSnapshot

  const stabilized = { ...snapshot }
  delete stabilized[LEGACY_ACCESS_AUTH_KEY]

  return stabilized
}

const replaceLocalSnapshot = (snapshot: Record<string, string>) => {
  Object.keys(readLocalSnapshot()).forEach((key) => {
    if (!(key in snapshot)) {
      localStorage.removeItem(key)
    }
  })

  Object.entries(snapshot).forEach(([key, value]) => {
    localStorage.setItem(key, value)
  })

  localStorage.removeItem(LEGACY_ACCESS_AUTH_KEY)
}

export const applyManagedStorageSnapshot = (snapshot: Record<string, string>) => {
  replaceLocalSnapshot(snapshot)
}

const fetchRemoteSnapshot = async () => {
  const response = await fetchServerApi(STORAGE_API_URL, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch persisted storage: ${response.status}`)
  }

  const data = (await response.json()) as {
    entries?: Record<string, string>
  }

  return data.entries || {}
}

const saveRemoteSnapshot = async (
  snapshot: Record<string, string>,
  options: {
    keepalive?: boolean
  } = {},
) => {
  const response = await fetchServerApi(STORAGE_API_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entries: snapshot }),
    keepalive: options.keepalive ?? false,
  })

  if (!response.ok) {
    throw new Error(`Failed to save persisted storage: ${response.status}`)
  }
}

export const persistManagedStorageSnapshot = async (snapshot: Record<string, string>) => {
  await saveRemoteSnapshot(snapshot)
}

const flushSnapshot = async () => {
  syncTimer = undefined
  await saveRemoteSnapshot(readLocalSnapshot())
}

const scheduleSync = () => {
  if (syncTimer) {
    window.clearTimeout(syncTimer)
  }

  syncTimer = window.setTimeout(() => {
    void flushSnapshot().catch((error) => {
      console.warn('Failed to sync persisted storage', error)
    })
  }, SYNC_DELAY_MS)
}

const installStoragePatch = () => {
  if (patchInstalled) return

  patchInstalled = true

  const nativeSetItem = localStorage.setItem.bind(localStorage)
  const nativeRemoveItem = localStorage.removeItem.bind(localStorage)
  const nativeClear = localStorage.clear.bind(localStorage)

  localStorage.setItem = ((key: string, value: string) => {
    nativeSetItem(key, value)

    if (isManagedKey(key)) {
      scheduleSync()
    }
  }) as typeof localStorage.setItem

  localStorage.removeItem = ((key: string) => {
    nativeRemoveItem(key)

    if (isManagedKey(key)) {
      scheduleSync()
    }
  }) as typeof localStorage.removeItem

  localStorage.clear = (() => {
    return () => {
      const hadManagedEntries = Object.keys(readLocalSnapshot()).length > 0

      nativeClear()

      if (hadManagedEntries) {
        scheduleSync()
      }
    }
  })() as typeof localStorage.clear

  window.addEventListener('beforeunload', () => {
    if (!syncTimer) return

    void saveRemoteSnapshot(readLocalSnapshot(), { keepalive: true }).catch(() => {
      // Ignore final sync errors during page unload.
    })
  })
}

export const initializePersistentStorage = async () => {
  const localSnapshot = readLocalSnapshot()

  if (serverAccessPasswordEnabled.value && !serverAuthenticated.value) {
    installStoragePatch()
    return
  }

  try {
    const remoteSnapshot = await fetchRemoteSnapshot()
    const stabilizedRemoteSnapshot = stabilizeManagedStorageSnapshot(remoteSnapshot, localSnapshot)

    if (Object.keys(stabilizedRemoteSnapshot).length > 0) {
      replaceLocalSnapshot(stabilizedRemoteSnapshot)
      if (JSON.stringify(stabilizedRemoteSnapshot) !== JSON.stringify(remoteSnapshot)) {
        await saveRemoteSnapshot(stabilizedRemoteSnapshot)
      }
    } else if (Object.keys(localSnapshot).length > 0) {
      await saveRemoteSnapshot(stabilizeManagedStorageSnapshot(localSnapshot))
    }

    installStoragePatch()
  } catch (error) {
    console.warn(
      'Persistent storage backend unavailable, falling back to browser storage only',
      error,
    )
  }
}
