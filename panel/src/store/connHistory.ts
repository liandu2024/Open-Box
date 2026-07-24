import { getProcessFromConnection } from '@/helper'
import {
  ConnectionHistoryType,
  getConnectionHistoryFromIndexedDB,
  saveConnectionHistoryToIndexedDB,
  type ConnectionHistoryData,
} from '@/helper/indexeddb'
import type { Connection } from '@/types'
import ipaddr from 'ipaddr.js'
import { ref } from 'vue'
import { activeBackend } from './setup'

const isInitializedPromise = ref(
  new Promise((resolve) => {
    resolve(false)
  }),
)
const uuid = () => activeBackend.value?.uuid || ''
const allHistoryTypes = [
  ConnectionHistoryType.SourceIP,
  ConnectionHistoryType.Destination,
  ConnectionHistoryType.Process,
  ConnectionHistoryType.Outbound,
]

export const aggregatedDataMap = ref<Record<ConnectionHistoryType, ConnectionHistoryData[]>>({
  [ConnectionHistoryType.SourceIP]: [],
  [ConnectionHistoryType.Destination]: [],
  [ConnectionHistoryType.Process]: [],
  [ConnectionHistoryType.Outbound]: [],
})

export const initAggregatedDataMap = () => {
  aggregatedDataMap.value = {
    [ConnectionHistoryType.SourceIP]: [],
    [ConnectionHistoryType.Destination]: [],
    [ConnectionHistoryType.Process]: [],
    [ConnectionHistoryType.Outbound]: [],
  }
  isInitializedPromise.value = new Promise(async (resolve) => {
    for (const type of allHistoryTypes) {
      const historicalData = await getConnectionHistoryFromIndexedDB(uuid(), type)

      let finalData = historicalData
      if (historicalData.length > 2000) {
        finalData = historicalData.sort((a, b) => b.download - a.download).slice(0, 1500)
        await saveConnectionHistoryToIndexedDB(uuid(), type, finalData)
      }

      aggregatedDataMap.value[type] = finalData
    }
    resolve(true)
  })
}

export const aggregateConnections = (
  connections: Connection[],
  type: ConnectionHistoryType,
): ConnectionHistoryData[] => {
  const map = new Map<string, ConnectionHistoryData>()

  connections.forEach((connection) => {
    let key: string = ''

    if (type === ConnectionHistoryType.SourceIP) {
      key = connection.metadata.sourceIP
    } else if (type === ConnectionHistoryType.Destination) {
      const hostkey =
        connection.metadata.host ||
        connection.metadata.sniffHost ||
        connection.metadata.destinationIP
      if (ipaddr.IPv4.isValid(hostkey) || ipaddr.IPv6.isValid(hostkey)) {
        key = hostkey
      } else {
        key = hostkey.split('.').slice(-2).join('.')
      }
    } else if (type === ConnectionHistoryType.Process) {
      key = getProcessFromConnection(connection)
    } else if (type === ConnectionHistoryType.Outbound) {
      key = connection.chains[0] || '-'
    }

    if (map.has(key)) {
      const existing = map.get(key)!
      existing.download += connection.download
      existing.upload += connection.upload
      existing.count += 1
    } else {
      map.set(key, {
        key,
        download: connection.download,
        upload: connection.upload,
        count: 1,
      })
    }
  })

  return Array.from(map.values())
}

export const mergeAggregatedData = (
  historical: ConnectionHistoryData[],
  newData: ConnectionHistoryData[],
): ConnectionHistoryData[] => {
  const map = new Map<string, ConnectionHistoryData>()

  historical.forEach((item) => {
    map.set(item.key, { ...item })
  })

  newData.forEach((item) => {
    if (map.has(item.key)) {
      const existing = map.get(item.key)!
      existing.download += item.download
      existing.upload += item.upload
      existing.count += item.count
    } else {
      map.set(item.key, { ...item })
    }
  })

  return Array.from(map.values())
}

export const saveConnectionHistory = async (newClosedConnections: Connection[]) => {
  if (newClosedConnections.length === 0) {
    return
  }

  await isInitializedPromise.value

  for (const type of allHistoryTypes) {
    try {
      const newAggregatedData = aggregateConnections(newClosedConnections, type)
      const historicalData = aggregatedDataMap.value[type]
      const mergedData = mergeAggregatedData(historicalData, newAggregatedData)

      aggregatedDataMap.value[type] = mergedData
      await saveConnectionHistoryToIndexedDB(uuid(), type, mergedData)
    } catch (error) {
      console.error(`Failed to save connection history for ${type}:`, error)
    }
  }
}
