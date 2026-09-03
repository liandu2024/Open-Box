<template>
  <!-- 设置 · 终端分流:按局域网来源 IP / 网段指定出口。列表 + 右上角「+」,样式对齐目标分流。 -->
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <Teleport
      defer
      to="#settings-header-actions"
    >
      <button
        v-if="profile"
        type="button"
        class="btn btn-primary btn-sm btn-square"
        v-tip="$t('clientRouteAdd')"
        :aria-label="$t('clientRouteAdd')"
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
          class="flex justify-center py-14"
        >
          <span class="loading loading-spinner loading-md" />
        </div>

        <div
          v-else-if="!routes.length"
          class="card"
        >
          <div class="app-card-inset text-base-content/50 text-sm">
            {{ $t('clientRouteEmpty') }}
          </div>
        </div>

        <div
          v-for="r in routes"
          :key="r.id"
          class="card bg-base-100 border-base-content/10 flex flex-row items-center gap-2 border p-3"
          :class="r.enabled === false && 'opacity-50'"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="max-w-full truncate text-base font-medium">{{ r.name }}</span>
              <span class="badge badge-outline badge-sm shrink-0 whitespace-nowrap">{{ r.outbound }}</span>
              <StatusBadge
                v-if="r.enabled === false"
                :on="false"
                on-text=""
                :off-text="$t('groupDisabledBadge')"
              />
              <span
                v-if="!outboundExists(r.outbound)"
                class="text-warning text-xs"
              >{{ $t('clientRouteOutboundMissing', { name: r.outbound }) }}</span>
            </div>
            <div class="text-base-content/60 mt-0.5 text-xs break-all">
              {{ r.sources.map(labelOf).join(' · ') }}
            </div>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-square btn-sm"
            :class="r.enabled === false ? 'text-base-content/40' : 'text-success'"
            v-tip="$t(r.enabled === false ? 'groupEnable' : 'groupDisable')"
            @click="toggle(r)"
          >
            <PowerIcon class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-square btn-sm"
            v-tip="$t('edit')"
            @click="openEdit(r)"
          >
            <PencilSquareIcon class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-square btn-sm"
            v-tip="$t('delete')"
            @click="remove(r)"
          >
            <TrashIcon class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>

    <ClientRouteEditDialog
      v-model="dialogOpen"
      :route="editing"
      :known-clients="knownClients"
      :options="outboundOptions"
      @saved="onSaved"
    />
  </div>
</template>

<script setup lang="ts">
import {
  fetchKnownClients,
  fetchNodeGroups,
  fetchProfile,
  saveProfile,
  type OpenboxClientRoute,
  type OpenboxProfile,
  type OpenboxUserGroup,
} from '@/api/openbox'
import ClientRouteEditDialog from '@/components/clients/ClientRouteEditDialog.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { showNotification } from '@/helper/notification'
import { PencilSquareIcon, PlusIcon, PowerIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { computed, onMounted, ref } from 'vue'

const { padding } = usePaddingForViews({ offsetTop: 0, offsetBottom: 0 })

const profile = ref<OpenboxProfile | null>(null)
const groups = ref<OpenboxUserGroup[]>([])
const availableNodes = ref<Array<{ name: string; subscription: string }>>([])
const knownClients = ref<Array<{ ip: string; name: string }>>([])
const loading = ref(true)
const dialogOpen = ref(false)
const editing = ref<OpenboxClientRoute | null>(null)

const routes = computed(() => profile.value?.clientRoutes || [])

// 出口候选:内置直连 / 拒绝(用它们当前的名字)、启用的节点组、单个节点(带订阅名)
const outboundOptions = computed(() => {
  const builtin = groups.value.filter((g) => g.kind && g.enabled !== false).map((g) => g.name)
  const userGroups = groups.value.filter((g) => !g.kind && g.enabled !== false).map((g) => g.name)
  return { builtin, groups: userGroups, nodes: availableNodes.value }
})
const outboundExists = (name: string) => {
  const o = outboundOptions.value
  return o.builtin.includes(name) || o.groups.includes(name) || o.nodes.some((n) => n.name === name)
}
const labelOf = (src: string) => {
  const ip = src.replace(/\/(32|128)$/, '')
  const known = knownClients.value.find((c) => c.ip === ip)
  return known?.name ? `${ip} (${known.name})` : src
}

const load = async () => {
  loading.value = true
  try {
    const [p, g] = await Promise.all([fetchProfile(), fetchNodeGroups()])
    profile.value = p
    groups.value = g.groups || []
    availableNodes.value = g.availableNodes || []
  } catch (error) {
    showNotification({
      content: 'routingLoadFailed',
      params: { message: error instanceof Error ? error.message : String(error) },
      type: 'alert-error',
    })
  } finally {
    loading.value = false
  }
  try {
    knownClients.value = (await fetchKnownClients()).clients || []
  } catch {
    knownClients.value = []
  }
}

const persist = async (next: OpenboxClientRoute[]) => {
  try {
    profile.value = await saveProfile({ clientRoutes: next })
    showNotification({ content: 'clientRouteSaved', type: 'alert-success' })
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
const openEdit = (r: OpenboxClientRoute) => {
  editing.value = r
  dialogOpen.value = true
}
const onSaved = (r: OpenboxClientRoute) => {
  const i = routes.value.findIndex((x) => x.id === r.id)
  const next = routes.value.slice()
  if (i >= 0) next[i] = r
  else next.push(r)
  void persist(next)
}
const toggle = (r: OpenboxClientRoute) => {
  void persist(routes.value.map((x) => (x.id === r.id ? { ...x, enabled: x.enabled === false } : x)))
}
const remove = (r: OpenboxClientRoute) => {
  void persist(routes.value.filter((x) => x.id !== r.id))
}

onMounted(load)
</script>
