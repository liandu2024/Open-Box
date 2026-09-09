// 升级状态是全局的,不属于「后端设置」那一页:升级到「替换文件」阶段面板会重启一次、
// 之后内核还要再重启一次,整个过程用户可能正待在任何页面(甚至刚被刷新过)。所以状态和
// 轮询放在这里当单例,弹窗由 App.vue 挂一次、盖在任何页面上;localStorage 里记一个标记,
// 页面刷新 / 重新登录之后还能接着显示。
import {
  cancelUpdate,
  fetchUpdateStatus,
  runUpdate,
  type OpenboxUpdateChannel,
  type OpenboxUpdateStatus,
} from '@/api/openbox'
import { showNotification } from '@/helper/notification'
import { serverAuthenticated, serverPasswordSet } from '@/store/auth'
import { computed, ref, watch } from 'vue'

const ACTIVE_KEY = 'openbox/update-active'
// 与 scripts/update.sh 里"可安全取消的阶段"一致:committing 之后不能取消
const CANCELLABLE = new Set(['starting', 'probing', 'downloading', 'verifying', 'extracting'])
// 面板重启窗口内最多再试这么多次(约 90 秒),重连上就清零
const MAX_OFFLINE_RETRIES = 45
// 空闲时也慢速探一下:升级可能是定时任务在 04:00 发起的,或者用户在另一台设备上点的,
// 这边不探就永远不知道后台正在升级(用户报的正是"不点进设置就不知道")
const IDLE_POLL_MS = 30_000

export const updateInfo = ref<OpenboxUpdateStatus | null>(null)
export const updateDialogOpen = ref(false)
export const updateStarting = ref(false)

export const updateProgress = computed(() => updateInfo.value?.status)
export const updateRunning = computed(() => Boolean(updateProgress.value?.running))
export const updateCancellable = computed(() => CANCELLABLE.has(updateProgress.value?.stage || ''))
export const updatePercent = computed(() => {
  const p = updateProgress.value
  if (!p || !p.total || p.bytes === null) return null
  return Math.min(100, Math.round((p.bytes / p.total) * 100))
})

const readActiveFlag = () => {
  try {
    return window.localStorage.getItem(ACTIVE_KEY) === '1'
  } catch {
    return false
  }
}
const writeActiveFlag = (on: boolean) => {
  try {
    if (on) window.localStorage.setItem(ACTIVE_KEY, '1')
    else window.localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // 隐私模式下写不了就算了,只是刷新后接不上进度
  }
}

let timer = 0
let polling = false
let wasRunning = false
let offline = 0
// 用户在这一轮升级里关掉过弹窗:轮询不再把它弹回来,新一轮开始才重新弹(#34)
let dismissed = false

const schedule = (ms: number) => {
  window.clearTimeout(timer)
  if (ms > 0) timer = window.setTimeout(() => void poll(), ms)
}

const finish = (stage: string, message: string) => {
  writeActiveFlag(false)
  polling = false
  dismissed = false
  if (stage === 'done') {
    showNotification({ content: 'obUpdateDone', type: 'alert-success' })
    window.setTimeout(() => window.location.reload(), 1500)
  } else if (stage === 'failed') {
    showNotification({ content: 'obUpdateFailed', params: { message }, type: 'alert-error', timeout: 8000 })
  } else if (stage === 'cancelled') {
    showNotification({ content: 'obUpdateCancelled', type: 'alert-warning' })
  }
}

const idleDelay = () => (serverAuthenticated.value && serverPasswordSet.value ? IDLE_POLL_MS : 0)

const poll = async () => {
  try {
    updateInfo.value = await fetchUpdateStatus()
    offline = 0
  } catch {
    // 换文件阶段面板会重启,接口短暂不可用是正常的:一直重试到它回来,
    // 否则弹窗会停在「正在替换文件」,升级其实早就完成了
    if (polling && offline < MAX_OFFLINE_RETRIES) {
      offline += 1
      schedule(2000)
    } else {
      if (polling) writeActiveFlag(false)
      polling = false
      schedule(idleDelay())
    }
    return
  }
  const running = Boolean(updateInfo.value.status.running)
  if (running) {
    polling = true
    writeActiveFlag(true)
    if (!wasRunning) dismissed = false
    if (!dismissed) updateDialogOpen.value = true
  } else if (wasRunning || polling) {
    finish(updateInfo.value.status.stage, updateInfo.value.status.message)
  }
  wasRunning = running
  schedule(running ? 1500 : idleDelay())
}

// 只读一次状态(卡片要显示当前版本 / 安装通道),不影响轮询
export const refreshUpdateInfo = async () => {
  try {
    updateInfo.value = await fetchUpdateStatus()
  } catch {
    // 读不到就保持上一次的值
  }
  return updateInfo.value
}

// App 启动、以及登录成功之后调用:后台可能正在升级(用户自己点的、或者定时任务发起的),
// 接着把弹窗显示出来
let watching = false
export const resumeUpdateWatch = async () => {
  if (!serverAuthenticated.value || !serverPasswordSet.value) return
  if (polling) return
  if (readActiveFlag()) polling = true
  if (watching && !polling) return
  watching = true
  await poll()
}

export const startUpdate = async (channel: OpenboxUpdateChannel) => {
  updateStarting.value = true
  try {
    await runUpdate(channel)
    showNotification({ content: 'obUpdateStarted', type: 'alert-info' })
    polling = true
    wasRunning = true
    offline = 0
    dismissed = false
    writeActiveFlag(true)
    updateDialogOpen.value = true
    schedule(800)
    return true
  } catch (err) {
    showNotification({
      content: 'obUpdateStartFailed',
      params: { message: err instanceof Error ? err.message : String(err) },
      type: 'alert-error',
    })
    return false
  } finally {
    updateStarting.value = false
  }
}

export const cancelRunningUpdate = async () => {
  try {
    await cancelUpdate()
    schedule(500)
  } catch (err) {
    showNotification({
      content: 'obUpdateStartFailed',
      params: { message: err instanceof Error ? err.message : String(err) },
      type: 'alert-error',
    })
  }
}

// 登录成功(或会话恢复)之后再试一次:被踢回登录页那一刻轮询会停,登录完要接上
watch([serverAuthenticated, serverPasswordSet], ([authed, hasPassword]) => {
  if (authed && hasPassword) void resumeUpdateWatch()
})

// 升级还在跑时用户关掉弹窗(关闭按钮、点遮罩、Esc 都走 v-model):这一轮不再自动弹回来
watch(updateDialogOpen, (open) => {
  if (!open && updateRunning.value) dismissed = true
})
