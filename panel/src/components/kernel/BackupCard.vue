<template>
  <!-- 导出 / 导入:把这台路由器上配出来的东西打成一个 JSON(server/api/backup.mjs),
       新设备导入就能用。导入只写库不重启内核,和订阅那边一个规矩:提示「重启内核生效」。 -->
  <!-- 整张卡片都能拖文件进来导入:拖到上面时描一圈虚线、盖一层「松开导入」。dragenter / dragleave
       在子元素之间来回触发,用计数器判断是不是真的离开了卡片 -->
  <div
    class="card bg-base-100 border-base-300/60 relative border transition-colors"
    :class="dragging && 'border-primary'"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- 盖一层不透明底把卡片内容遮掉,提示才看得清;虚线框画在这一层里,和卡片圆角对齐 -->
    <div
      v-if="dragging"
      class="bg-base-100 pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] p-2"
    >
      <div class="border-primary bg-primary/10 text-primary flex h-full w-full items-center justify-center gap-2 rounded-[inherit] border-2 border-dashed text-base font-semibold">
        <ArrowUpTrayIcon class="h-6 w-6" />
        {{ $t('backupDropHint') }}
      </div>
    </div>
    <div class="card-body gap-3 p-4">
      <div>
        <h2 class="text-base font-semibold">{{ $t('backupTitle') }}</h2>
        <p class="text-base-content/60 text-xs">{{ $t('backupDescription') }}</p>
      </div>

      <!-- 导出:[导出] [包含订阅和节点] [包含终端分流] [包含共享网络]。按钮放最前面,和下面的「导入」左对齐 -->
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="btn btn-sm"
          :disabled="exporting"
          @click="doExport"
        >
          <span
            v-if="exporting"
            class="loading loading-spinner loading-xs"
          />
          <ArrowDownTrayIcon
            v-else
            class="h-4 w-4"
          />
          {{ $t('backupExport') }}
        </button>
        <!-- 这台路由器上没有的部分(没订阅、没终端分流、没共享网络)置灰不可选 -->
        <label
          v-for="opt in EXPORT_OPTIONS"
          :key="opt.key"
          class="flex items-center gap-2 text-sm"
          :class="available[opt.key] ? 'cursor-pointer' : 'text-base-content/40 cursor-not-allowed'"
        >
          <input
            v-model="include[opt.key]"
            type="checkbox"
            class="checkbox checkbox-sm"
            :disabled="!available[opt.key]"
          />
          {{ $t(opt.label) }}
        </label>
        <span class="text-base-content/50 text-xs">{{ $t('backupExportHint') }}</span>
      </div>

      <!-- 导入:[导入] 选文件 → 确认 → 写库 -->
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="btn btn-sm"
          :disabled="importing"
          @click="inputRef?.click()"
        >
          <ArrowUpTrayIcon class="h-4 w-4" />
          {{ $t('backupImport') }}
        </button>
        <span class="text-base-content/50 text-xs">{{ $t('backupImportHint') }}</span>
        <input
          ref="inputRef"
          type="file"
          accept=".json,application/json"
          class="hidden"
          @change="onFilePicked"
        />
      </div>
    </div>

    <!-- 导入会覆盖这台路由器上的配置,先确认一次 -->
    <DialogWrapper
      v-model="showConfirm"
      :title="$t('backupImportConfirmTitle')"
    >
      <div class="flex flex-col gap-4 p-2">
        <p class="text-sm">
          {{ $t('backupImportConfirm', { file: pendingName, exportedAt: pendingExportedAt, parts: pendingParts }) }}
        </p>
        <!-- 文件带订阅和节点时二选一:覆盖 / 追加。只针对订阅和节点,其他配置一概覆盖 -->
        <div
          v-if="pendingHasSubscriptions"
          class="flex flex-col gap-2"
        >
          <span class="text-sm font-medium">{{ $t('backupSubscriptionsModeLabel') }}</span>
          <label class="flex cursor-pointer items-start gap-2 text-sm">
            <input
              v-model="subscriptionsMode"
              type="radio"
              value="replace"
              class="radio radio-sm mt-0.5"
            />
            <span>
              {{ $t('backupModeReplace') }}
              <span class="text-base-content/60 block text-xs">{{ $t('backupModeReplaceHint') }}</span>
            </span>
          </label>
          <label class="flex cursor-pointer items-start gap-2 text-sm">
            <input
              v-model="subscriptionsMode"
              type="radio"
              value="append"
              class="radio radio-sm mt-0.5"
            />
            <span>
              {{ $t('backupModeAppend') }}
              <span class="text-base-content/60 block text-xs">{{ $t('backupModeAppendHint') }}</span>
            </span>
          </label>
          <p class="text-base-content/60 text-xs">{{ $t('backupModeOthersHint') }}</p>
        </div>
        <!-- 导入完带链接的订阅会逐条刷新一遍拿最新节点,这里报进度 -->
        <p
          v-if="refreshProgress"
          class="text-base-content/70 text-xs"
        >
          {{ $t('backupRefreshingSubscriptions', { done: refreshProgress.done, total: refreshProgress.total }) }}
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showConfirm = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="importing"
            @click="confirmImport"
          >
            <span
              v-if="importing"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('confirm') }}
          </button>
        </div>
      </div>
    </DialogWrapper>
  </div>
</template>

<script setup lang="ts">
import {
  fetchBackup,
  importBackup,
  refreshSubscription,
  type OpenboxBackup,
  type OpenboxBackupOptions,
  type OpenboxBackupSubscriptionsMode,
  type OpenboxProfile,
  type OpenboxSubscription,
} from '@/api/openbox'
import { applyManagedStorageSnapshot } from '@/helper/persistentStorage'
import { loadOpenboxSubscriptions, openboxSubscriptions } from '@/store/openboxSubscriptions'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { showNotification } from '@/helper/notification'
import { ArrowDownTrayIcon, ArrowUpTrayIcon } from '@heroicons/vue/24/outline'
import dayjs from 'dayjs'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ profile: OpenboxProfile | null }>()
const emit = defineEmits<{ imported: [] }>()
const { t } = useI18n()

// 导出时可勾可不勾的三块,默认都带
const EXPORT_OPTIONS: { key: keyof OpenboxBackupOptions; label: string }[] = [
  { key: 'subscriptions', label: 'backupIncludeSubscriptions' },
  { key: 'clientRoutes', label: 'backupIncludeClientRoutes' },
  { key: 'servers', label: 'backupIncludeServers' },
]
const include = reactive<OpenboxBackupOptions>({ subscriptions: true, clientRoutes: true, servers: true })
// 这台路由器上有没有这三块:订阅看订阅列表,终端分流 / 共享网络看档案。没有的置灰、不勾
const available = computed<OpenboxBackupOptions>(() => ({
  subscriptions: openboxSubscriptions.value.length > 0,
  clientRoutes: (props.profile?.clientRoutes?.length ?? 0) > 0,
  servers: (props.profile?.servers?.length ?? 0) > 0,
}))
watch(
  () => JSON.stringify(available.value),
  () => {
    for (const key of Object.keys(include) as (keyof OpenboxBackupOptions)[]) include[key] = available.value[key]
  },
  { immediate: true },
)
// 导入带面板设置的文件后会刷新页面让设置生效;刷新前把要弹的提示(文案 key + 参数)存进
// sessionStorage,回来再弹
const IMPORTED_FLAG = 'openbox/backup-imported'
type DoneToast = { content: string; params: Record<string, string> }
const refreshProgress = ref<{ done: number; total: number } | null>(null)
onMounted(() => {
  void loadOpenboxSubscriptions()
  try {
    const raw = sessionStorage.getItem(IMPORTED_FLAG)
    if (raw) {
      sessionStorage.removeItem(IMPORTED_FLAG)
      let toast: DoneToast = { content: 'backupImportedNeedRestart', params: {} }
      try {
        const parsed = JSON.parse(raw) as Partial<DoneToast>
        if (parsed && typeof parsed.content === 'string') toast = { content: parsed.content, params: parsed.params || {} }
      } catch { /* 老记号只是 '1' */ }
      showNotification({ ...toast, type: 'alert-success', timeout: 6000 })
    }
  } catch { /* 拿不到 sessionStorage 就不提示 */ }
})
const exporting = ref(false)
const importing = ref(false)
const inputRef = ref<HTMLInputElement>()
const showConfirm = ref(false)
const pending = ref<OpenboxBackup | null>(null)
const pendingName = ref('')
// 订阅和节点:覆盖还是追加(其他配置不分,一律覆盖)
const subscriptionsMode = ref<OpenboxBackupSubscriptionsMode>('replace')
const pendingHasSubscriptions = computed(() => Array.isArray(pending.value?.subscriptions))

const pad2 = (n: number) => String(n).padStart(2, '0')

// 拖拽导入:进入 / 离开计数,子元素间切换不算离开
const dragging = ref(false)
let dragDepth = 0
const onDragEnter = () => {
  dragDepth += 1
  dragging.value = true
}
const onDragLeave = () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragging.value = false
}
const onDrop = (e: DragEvent) => {
  dragDepth = 0
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) handleFile(file)
}

// 拉一份 JSON,浏览器存成文件:open-box-backup-20260905-2130.json
const doExport = async () => {
  exporting.value = true
  try {
    const data = await fetchBackup({ ...include })
    const d = new Date()
    const name = `open-box-backup-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.json`
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    showNotification({ content: 'backupExported', params: { file: name }, type: 'alert-success' })
  } catch (err) {
    showNotification({
      content: 'backupExportFailed',
      params: { message: err instanceof Error ? err.message : String(err) },
      type: 'alert-error',
    })
  } finally {
    exporting.value = false
  }
}

const pendingExportedAt = computed(() => {
  const at = pending.value?.exportedAt
  return at && dayjs(at).isValid() ? dayjs(at).format('YYYY-MM-DD HH:mm') : '—'
})
// 确认框里写清文件带了什么:档案和节点组一定有;订阅 / 终端分流 / 共享网络看文件里有没有
const pendingParts = computed(() => {
  const p = pending.value
  if (!p) return ''
  let s = t('backupPartsBase')
  if (Array.isArray(p.subscriptions)) {
    s += t('backupPartsSubscriptions', { subs: p.subscriptions.length, nodes: Array.isArray(p.nodes) ? p.nodes.length : 0 })
  }
  const routes = p.profile?.clientRoutes
  if (Array.isArray(routes)) s += t('backupPartsClientRoutes', { n: routes.length })
  const servers = p.profile?.servers
  if (Array.isArray(servers)) s += t('backupPartsServers', { n: servers.length })
  if (p.panelSettings && typeof p.panelSettings === 'object') s += t(p.backgroundImage ? 'backupPartsPanelWithBackground' : 'backupPartsPanel')
  return s
})

// 选了文件(点按钮选的、或拖进来的):先读出来看格式对不对,对了再弹确认
const onFilePicked = () => {
  const file = inputRef.value?.files?.[0]
  if (inputRef.value) inputRef.value.value = ''
  if (file) handleFile(file)
}
const handleFile = (file: File) => {
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result)) as OpenboxBackup
      if (!data || data.format !== 'open-box-backup' || typeof data.profile !== 'object') {
        showNotification({ content: 'backupBadFile', params: { file: file.name }, type: 'alert-error' })
        return
      }
      pending.value = data
      pendingName.value = file.name
      subscriptionsMode.value = 'replace'
      showConfirm.value = true
    } catch {
      showNotification({ content: 'backupBadFile', params: { file: file.name }, type: 'alert-error' })
    }
  }
  reader.readAsText(file)
}

const confirmImport = async () => {
  if (!pending.value) return
  importing.value = true
  try {
    const file = pending.value
    const r = await importBackup(file, pendingHasSubscriptions.value ? subscriptionsMode.value : 'replace')
    // 导进来的订阅里有链接的,逐条刷新一遍拿最新节点(文件里的节点可能是几小时前的);
    // 粘贴保存的没链接,跳过。刷完再提示。节点进内核仍要重启内核——和订阅的规矩一样,不自动重启
    let refreshed = 0
    let failed = 0
    const toRefresh =
      r.imported.subscriptions > 0 && Array.isArray(file.subscriptions)
        ? (file.subscriptions as Partial<OpenboxSubscription>[]).filter((s) => s && typeof s.id === 'string' && ((Array.isArray(s.urls) && s.urls.length > 0) || Boolean(s.url)))
        : []
    if (toRefresh.length) {
      refreshProgress.value = { done: 0, total: toRefresh.length }
      for (const s of toRefresh) {
        try {
          await refreshSubscription(s.id as string)
          refreshed += 1
        } catch {
          failed += 1
        }
        refreshProgress.value = { done: refreshed + failed, total: toRefresh.length }
      }
      refreshProgress.value = null
    }
    const done: DoneToast = failed
      ? { content: 'backupImportedRefreshFailed', params: { n: String(refreshed), failed: String(failed) } }
      : refreshed
        ? { content: 'backupImportedRefreshed', params: { n: String(refreshed) } }
        : { content: 'backupImportedNeedRestart', params: {} }
    showConfirm.value = false
    pending.value = null
    void loadOpenboxSubscriptions()
    // 带了面板设置:本地快照换成文件里的,再刷新页面让语言 / 主题 / 圆角这些立刻生效
    // (useStorage 的值是启动时读的,不刷新不会变);提示留到刷新回来再弹
    if (r.imported.panelSettings || r.imported.backgroundImage) {
      if (file.panelSettings) applyManagedStorageSnapshot(file.panelSettings)
      try { sessionStorage.setItem(IMPORTED_FLAG, JSON.stringify(done)) } catch { /* ignore */ }
      window.setTimeout(() => window.location.reload(), 300)
      return
    }
    showNotification({ ...done, type: 'alert-success', timeout: 6000 })
    emit('imported')
  } catch (err) {
    showNotification({
      content: 'backupImportFailed',
      params: { message: err instanceof Error ? err.message : String(err) },
      type: 'alert-error',
    })
  } finally {
    importing.value = false
  }
}
</script>
