<template>
  <!-- 设置 · 共享网络:在本路由器上开服务器(SS / VLESS / TUIC / Hysteria2),别的设备连上来
       就经过这里的分流规则上网。列表 + 右上角「+」,样式对齐订阅管理 / 站点集卡片。 -->
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <Teleport
      defer
      to="#settings-header-actions"
    >
      <button
        type="button"
        class="btn btn-circle btn-sm"
        v-tip="$t('serverAdd')"
        :aria-label="$t('serverAdd')"
        @click="openCreate"
      >
        <PlusIcon class="h-4 w-4" />
      </button>
    </Teleport>

    <div
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      :style="padding"
    >
      <div class="flex flex-col gap-2 px-2 md:py-2">
        <div
          v-if="loading"
          class="card"
        >
          <div class="app-card-inset flex items-center gap-2 text-sm">
            <span class="loading loading-spinner loading-xs" />
          </div>
        </div>

        <div
          v-else-if="!servers.length"
          class="card"
        >
          <div class="app-card-inset text-base-content/50 text-sm">
            {{ $t('serverEmpty') }}
          </div>
        </div>

        <!-- 拖拽排序:内核里的入站顺序跟着它 -->
        <Draggable
          v-model="servers"
          :animation="150"
          :force-fallback="true"
          :fallback-on-body="true"
          handle=".drag-handle"
          ghost-class="opacity-40"
          item-key="id"
          class="flex flex-col gap-2"
          @end="persist([...servers])"
        >
          <template #item="{ element: s }">
            <!-- 一行一台服务器。卡片外观和内边距用列表行的统一写法(和目标分流 / 终端分流 /
             节点管理 三处一致:border + p-3),不要再单独用 app-card-inset 的 16px -->
            <div
              class="card bg-base-100 border-base-content/10 flex flex-row items-center gap-2 border p-3"
            >
              <Bars3Icon class="drag-handle text-base-content/40 h-4 w-4 shrink-0 cursor-move" />
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <span class="text-base">{{ s.name }}</span>
                  <!-- 和站点集卡片一致:只在停用时挂个标签 -->
                  <StatusBadge
                    v-if="s.enabled === false"
                    :on="false"
                    on-text=""
                    :off-text="$t('groupDisabledBadge')"
                  />
                </div>
                <div class="text-base-content/60 flex flex-wrap gap-x-3 text-xs">
                  <span>{{ protocolLabel(s.protocol) }}</span>
                  <span>{{ $t('serverPortLabel') }} {{ s.port }}</span>
                  <span v-if="s.address">{{ s.address }}</span>
                  <span
                    v-else
                    class="text-warning"
                    >{{ $t('serverNoAddress') }}</span
                  >
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  class="btn btn-circle btn-sm"
                  :disabled="!buildShareLink(s)"
                  v-tip="$t('copyLink')"
                  @click="copyText(buildShareLink(s))"
                >
                  <ClipboardDocumentIcon class="h-4 w-4" />
                </button>
                <!-- 电源键按状态变色:启用中绿色,停用后灰色(和站点集 / 节点管理一致) -->
                <button
                  type="button"
                  class="btn btn-circle btn-sm"
                  :class="s.enabled === false ? 'text-base-content/40' : 'text-success'"
                  v-tip="$t(s.enabled === false ? 'groupEnable' : 'groupDisable')"
                  @click="toggle(s)"
                >
                  <PowerIcon class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="btn btn-circle btn-sm"
                  v-tip="$t('edit')"
                  @click="openEdit(s)"
                >
                  <PencilSquareIcon class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="btn btn-circle btn-sm"
                  v-tip="$t('delete')"
                  @click="remove(s)"
                >
                  <TrashIcon class="h-4 w-4" />
                </button>
              </div>
            </div>
          </template>
        </Draggable>
      </div>
    </div>

    <ServerEditDialog
      v-model="dialogOpen"
      :server="editing"
      :used-ports="usedPorts"
      @saved="onSaved"
    />
  </div>
</template>

<script setup lang="ts">
import {
  fetchProfile,
  saveProfile,
  type OpenboxServer,
  type OpenboxServerProtocol,
} from '@/api/openbox'
import StatusBadge from '@/components/common/StatusBadge.vue'
import ServerEditDialog from '@/components/share/ServerEditDialog.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { copyText as copyToClipboard } from '@/helper/clipboard'
import { showNotification } from '@/helper/notification'
import { buildShareLink } from '@/helper/shareLink'
import {
  Bars3Icon,
  ClipboardDocumentIcon,
  PencilSquareIcon,
  PlusIcon,
  PowerIcon,
  TrashIcon,
} from '@heroicons/vue/24/outline'
import { computed, onMounted, ref } from 'vue'
import Draggable from 'vuedraggable'

const { padding } = usePaddingForViews({ offsetTop: 0, offsetBottom: 0 })

const servers = ref<OpenboxServer[]>([])
const loading = ref(true)
const dialogOpen = ref(false)
const editing = ref<OpenboxServer | null>(null)

const PROTOCOL_LABEL: Record<OpenboxServerProtocol, string> = {
  shadowsocks: 'Shadowsocks',
  vless: 'VLESS',
  tuic: 'TUIC',
  hysteria2: 'Hysteria2',
  mixed: 'SOCKS5 / HTTP',
}
const protocolLabel = (p: OpenboxServerProtocol) => PROTOCOL_LABEL[p] || p

const usedPorts = computed(() =>
  servers.value.filter((s) => s.id !== editing.value?.id).map((s) => s.port),
)

const load = async () => {
  loading.value = true
  try {
    servers.value = (await fetchProfile()).servers || []
  } catch (error) {
    showNotification({
      content: 'routingLoadFailed',
      params: { message: error instanceof Error ? error.message : String(error) },
      type: 'alert-error',
    })
  } finally {
    loading.value = false
  }
}

// 每次改动整份写回档案;成功后提示重启内核生效(和站点集保存后的提示一致)
const persist = async (next: OpenboxServer[]) => {
  try {
    const profile = await saveProfile({ servers: next })
    servers.value = profile.servers || []
    showNotification({ content: 'serverSaved', type: 'alert-success' })
  } catch (error) {
    showNotification({
      content: 'saveFailed',
      params: { message: error instanceof Error ? error.message : String(error) },
      type: 'alert-error',
    })
  }
}

const openCreate = () => {
  editing.value = null
  dialogOpen.value = true
}
const openEdit = (s: OpenboxServer) => {
  editing.value = s
  dialogOpen.value = true
}
const onSaved = (s: OpenboxServer) => {
  const i = servers.value.findIndex((x) => x.id === s.id)
  const next = servers.value.slice()
  if (i >= 0) next[i] = s
  else next.push(s)
  void persist(next)
}
const toggle = (s: OpenboxServer) => {
  void persist(
    servers.value.map((x) => (x.id === s.id ? { ...x, enabled: x.enabled === false } : x)),
  )
}
const remove = (s: OpenboxServer) => {
  void persist(servers.value.filter((x) => x.id !== s.id))
}
const copyText = async (text: string) => {
  if (!text) return
  const ok = await copyToClipboard(text)
  showNotification(
    ok
      ? { content: 'copySuccess', type: 'alert-success' }
      : { content: 'copyFailed', type: 'alert-error' },
  )
}

onMounted(load)
</script>
