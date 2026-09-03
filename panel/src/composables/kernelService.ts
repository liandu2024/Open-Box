// 内核服务(启动/停止/重启)的共享状态:侧边栏底部的三个按钮和「后端设置」里的内核卡片
// 共用同一份状态、同一个进行中标记,任一处点了动作另一处同步转圈、同步刷新。
import {
  fetchServiceStatus,
  runServiceAction,
  type OpenboxServiceAction,
  type OpenboxServiceStatus,
} from '@/api/openbox'
import { showNotification } from '@/helper/notification'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

export const serviceStatus = ref<OpenboxServiceStatus | null>(null)
export const pendingAction = ref<OpenboxServiceAction | null>(null)

const ACTION_LABEL_KEYS: Record<OpenboxServiceAction, string> = {
  start: 'kernelActionStart',
  stop: 'kernelActionStop',
  restart: 'kernelActionRestart',
  enable: 'kernelActionEnable',
  disable: 'kernelActionDisable',
}

export const isStartDisabled = computed(
  () =>
    pendingAction.value !== null ||
    Boolean(serviceStatus.value?.core.running) ||
    Boolean(serviceStatus.value?.conflicts.length),
)
export const isStopDisabled = computed(() => pendingAction.value !== null || !serviceStatus.value?.core.running)
export const isRestartDisabled = computed(
  () =>
    pendingAction.value !== null ||
    !serviceStatus.value?.core.running ||
    Boolean(serviceStatus.value?.conflicts.length),
)
export const isEnableDisabled = computed(
  () => pendingAction.value !== null || serviceStatus.value?.core.autostart === true,
)
export const isDisableDisabled = computed(
  () => pendingAction.value !== null || serviceStatus.value?.core.autostart === false,
)

export const refreshServiceStatus = async () => {
  try {
    serviceStatus.value = await fetchServiceStatus()
  } catch {
    // 拿不到就保持上一次的值;按钮的可用性按已知状态算
  }
  return serviceStatus.value
}

// 有人在看(侧边栏 / 内核页)时每 10 秒刷一次状态;多处同时用只跑一个定时器
let watchers = 0
let timer: ReturnType<typeof setInterval> | null = null
export const useServiceStatusPolling = (intervalMs = 10_000) => {
  onMounted(() => {
    watchers += 1
    void refreshServiceStatus()
    if (!timer) {
      timer = setInterval(() => void refreshServiceStatus(), intervalMs)
    }
  })
  onBeforeUnmount(() => {
    watchers -= 1
    if (watchers <= 0 && timer) {
      clearInterval(timer)
      timer = null
      watchers = 0
    }
  })
}

export const useKernelActions = () => {
  const { t } = useI18n()

  const runKernelAction = async (action: OpenboxServiceAction) => {
    if (pendingAction.value) return
    pendingAction.value = action
    const actionLabel = t(ACTION_LABEL_KEYS[action])
    try {
      const result = await runServiceAction(action)
      if (result.ok) {
        showNotification({ content: 'kernelActionSucceeded', params: { action: actionLabel }, type: 'alert-success' })
      } else {
        // 这台开发机没有 /etc/init.d,ok:false 且 stderr 为空是常态:没细节时至少给个退出码
        const detail = result.stderr.trim() || t('kernelActionNoDetail', { code: String(result.code) })
        showNotification({ content: 'kernelActionFailed', params: { action: actionLabel, detail }, type: 'alert-error' })
      }
    } catch (error) {
      showNotification({
        content: 'kernelActionRequestFailed',
        params: { message: error instanceof Error ? error.message : String(error) },
        type: 'alert-error',
      })
    } finally {
      pendingAction.value = null
      await refreshServiceStatus()
    }
  }

  return { runKernelAction }
}
