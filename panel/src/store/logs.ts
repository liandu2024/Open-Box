import { fetchLogsAPI } from '@/api'
import { LOG_LEVEL } from '@/constant'
import type { Log, LogWithSeq } from '@/types'
import { useStorage } from '@vueuse/core'
import dayjs from 'dayjs'
import { throttle } from 'lodash'
import { ref, watch } from 'vue'
import { sourceIPLabelList } from './settings'

export const logs = ref<LogWithSeq[]>([])
export const logFilter = ref('')
export const logTypeFilter = ref('')
export const isPaused = ref(false)
export const logLevel = useStorage<string>('config/log-level', LOG_LEVEL.Info)
// 页面里保留多少条日志。原来是个设置项,但没人会去改它,固定成原来的默认值。
const LOG_RETENTION_LIMIT = 1000

let cancel: () => void
let logsTemp: LogWithSeq[] = []

const sliceLogs = throttle(() => {
  logs.value = logsTemp.concat(logs.value).slice(0, LOG_RETENTION_LIMIT)
  logsTemp = []
}, 500)

const ipSourceMatchs: [RegExp, string][] = []
const restructMatchs = () => {
  ipSourceMatchs.length = 0
  for (const { key, label } of sourceIPLabelList.value) {
    if (key.startsWith('/')) continue

    if (key.includes(':')) {
      const regex = new RegExp(`${key}]:`, 'ig')
      ipSourceMatchs.push([regex, `${key}] (${label}) :`])
    } else {
      const regex = new RegExp(`${key}:`, 'ig')
      ipSourceMatchs.push([regex, `${key} (${label}) :`])
    }
  }
}

watch(
  () => sourceIPLabelList.value,
  () => {
    restructMatchs()
  },
  {
    immediate: true,
    deep: true,
  },
)

export const initLogs = () => {
  cancel?.()
  logs.value = []
  logsTemp = []

  let idx = 1
  const ws = fetchLogsAPI<Log>({
    level: logLevel.value,
  })

  const unwatch = watch(ws.data, (data) => {
    if (!data) return

    if (isPaused.value) {
      idx++
      return
    }

    for (const [regex, label] of ipSourceMatchs) {
      data.payload = data.payload.replace(regex, label)
    }

    logsTemp.unshift({
      ...data,
      time: dayjs().format('HH:mm:ss'),
      seq: idx++,
    })

    sliceLogs()
  })

  cancel = () => {
    unwatch()
    ws.close()
  }
}
