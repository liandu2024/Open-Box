import { fetchServerApi } from '@/store/auth'
import { customBackgroundURL } from '@/store/settings'
import dayjs from 'dayjs'
import { computed, ref, watch } from 'vue'
const BACKGROUND_IMAGE_API_URL = '/api/background-image'

const useIndexedDB = (dbKey: string) => {
  const cacheMap = new Map<string, string>()
  const openDatabase = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbKey, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(dbKey)) {
          db.createObjectStore(dbKey, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => {
        const db = request.result
        const store = db.transaction(dbKey, 'readonly').objectStore(dbKey)
        const cursorRequest = store.openCursor()

        cursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result

          if (cursor) {
            cacheMap.set(cursor.key as string, cursor.value.value)
            cursor.continue()
          } else {
            resolve(request.result)
          }
        }
        cursorRequest.onerror = () => reject(cursorRequest.error)
      }
      request.onerror = () => reject(request.error)
    })

  const dbPromise = openDatabase()

  const executeTransaction = async <T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ) => {
    const db = await dbPromise
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(dbKey, mode)
      const store = transaction.objectStore(dbKey)
      const request = operation(store)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  const put = async (key: string, value: string) => {
    await dbPromise
    cacheMap.set(key, value)
    return executeTransaction('readwrite', (store) =>
      store.put({
        key,
        value,
      }),
    )
  }

  const get = async (key: string) => {
    await dbPromise
    return cacheMap.get(key)
  }

  const clear = async () => {
    await dbPromise
    cacheMap.clear()
    return executeTransaction('readwrite', (store) => store.clear())
  }

  const isExists = async (key: string) => {
    await dbPromise
    return cacheMap.has(key)
  }

  const del = async (key: string) => {
    await dbPromise
    cacheMap.delete(key)
    return executeTransaction('readwrite', (store) => store.delete(key))
  }

  const getAllKeys = async () => {
    await dbPromise
    return Array.from(cacheMap.keys())
  }

  return {
    put,
    get,
    del,
    getAllKeys,
    isExists,
    clear,
  }
}

const backgroundDB = useIndexedDB('base64')
const backgroundImageKey = 'background-image'

export const LOCAL_IMAGE = 'local-image'

const saveBase64ToServer = async (image: string) => {
  const response = await fetchServerApi(BACKGROUND_IMAGE_API_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ image }),
  })

  if (!response.ok) {
    throw new Error(`Failed to persist background image: ${response.status}`)
  }
}

const getBase64FromServer = async () => {
  const response = await fetchServerApi(BACKGROUND_IMAGE_API_URL, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch background image: ${response.status}`)
  }

  const data = (await response.json()) as { image?: string }
  return data.image || ''
}

const deleteBase64FromServer = async () => {
  const response = await fetchServerApi(BACKGROUND_IMAGE_API_URL, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(`Failed to delete background image: ${response.status}`)
  }
}

export const saveBase64ToIndexedDB = async (val: string) => {
  await backgroundDB.put(backgroundImageKey, val)

  try {
    await saveBase64ToServer(val)
  } catch (error) {
    console.warn('Failed to persist background image to server storage', error)
  }
}

export const getBase64FromIndexedDB = async () => {
  try {
    const remoteImage = await getBase64FromServer()

    if (remoteImage) {
      await backgroundDB.put(backgroundImageKey, remoteImage)
      return remoteImage
    }
  } catch (error) {
    console.warn('Failed to fetch background image from server storage', error)
  }

  return (await backgroundDB.get(backgroundImageKey)) || ''
}

export const deleteBase64FromIndexedDB = async () => {
  await backgroundDB.clear()

  try {
    await deleteBase64FromServer()
  } catch (error) {
    console.warn('Failed to delete background image from server storage', error)
  }
}

const date = dayjs().format('YYYY-MM-DD')
const backgroundInDB = ref('')
const getBackgroundInDB = async () => {
  backgroundInDB.value = (await getBase64FromIndexedDB()) || ''
}

watch(
  () => customBackgroundURL.value,
  () => {
    if (customBackgroundURL.value.includes(LOCAL_IMAGE)) {
      getBackgroundInDB()
    }
  },
  {
    immediate: true,
  },
)

export const backgroundImage = computed(() => {
  if (!customBackgroundURL.value) {
    return ''
  }

  if (customBackgroundURL.value.includes(LOCAL_IMAGE)) {
    return `background-image: url('${backgroundInDB.value}');`
  }
  return `background-image: url('${customBackgroundURL.value}?v=${date}');`
})

export interface ConnectionHistoryData {
  key: string
  download: number
  upload: number
  count: number
}

export enum ConnectionHistoryType {
  SourceIP = 'sourceIP',
  Destination = 'destination',
  Process = 'process',
  Outbound = 'outbound',
}

const connectionHistoryDB = useIndexedDB('connection-history')

export const saveConnectionHistoryToIndexedDB = async (
  uuid: string,
  aggregationType: ConnectionHistoryType,
  data: ConnectionHistoryData[],
) => {
  const jsonData = JSON.stringify(data)
  return connectionHistoryDB.put(`${uuid}-${aggregationType}`, jsonData)
}

export const getConnectionHistoryFromIndexedDB = async (
  uuid: string,
  aggregationType: ConnectionHistoryType,
): Promise<ConnectionHistoryData[]> => {
  const jsonData = await connectionHistoryDB.get(`${uuid}-${aggregationType}`)
  if (!jsonData) {
    return []
  }
  try {
    return JSON.parse(jsonData) as ConnectionHistoryData[]
  } catch {
    return []
  }
}

export const clearConnectionHistoryFromIndexedDB = async () => {
  return connectionHistoryDB.clear()
}
