<template>
  <!-- 故障转移组的卡片内容:不是节点网格,而是按主备顺序列页签。当前在哪个页签、每个页签健康与否、
       多节点页签内核实际选中的节点、最近一次切换,都从服务端的运行状态来(浏览器关了它照样切) -->
  <div
    v-if="compact"
    class="text-base-content/70 mt-2 flex min-w-0 items-center gap-2 text-xs"
  >
    <span :class="['badge badge-xs shrink-0', statusBadgeClass]">{{ statusText }}</span>
    <span
      v-if="currentLane"
      class="min-w-0 truncate"
    >{{ laneLabel(currentLane) }}<template v-if="currentNode"> · {{ currentNode }}</template></span>
    <span
      v-else-if="status"
      class="min-w-0 truncate"
    >{{ $t('failoverNoLane') }}</span>
  </div>
  <div
    v-else
    class="flex flex-col gap-2 py-1"
  >
    <div class="text-base-content/70 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span :class="['badge badge-sm', statusBadgeClass]">{{ statusText }}</span>
      <span v-if="status?.paused === 'kernel'">{{ $t('failoverPausedKernel') }}</span>
      <span v-else-if="status?.paused === 'kernel-mismatch'">{{ $t('failoverPausedMismatch') }}</span>
      <span v-if="status?.lastError" class="text-error">{{ status.lastError }}</span>
      <span
        v-if="status?.lastSwitch"
        class="min-w-0 truncate"
      >{{ lastSwitchText }}</span>
      <span
        v-if="status?.lastRoundAt"
        class="tabular-nums"
      >{{ $t('failoverLastRound', { time: timeText(status.lastRoundAt) }) }}</span>
      <span
        v-else-if="!status"
        class="text-base-content/50"
      >{{ $t('failoverNoStatus') }}</span>
    </div>
    <div
      v-for="lane in lanes"
      :key="lane.id"
      :class="[
        'border-base-content/10 flex flex-col gap-1 rounded-lg border px-3 py-2',
        lane.current ? 'bg-primary/5 border-primary/40' : '',
      ]"
    >
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span class="flex items-center font-medium">
          <ProxyIcon
            v-if="laneIconUrl(lane)"
            :icon="laneIconUrl(lane)"
            :size="16"
            :scale="definition?.iconScale"
          />{{ laneLabel(lane) }}
        </span>
        <span
          v-if="lane.current"
          class="text-primary text-xs font-medium"
        >{{ $t('failoverCurrent') }}</span>
        <span :class="['badge badge-xs', healthBadgeClass(lane.health)]">{{ healthText(lane.health) }}</span>
        <span class="text-base-content/60 text-xs">{{ modeText(lane) }}</span>
        <span
          v-if="lane.invalid.length"
          class="text-base-content/60 text-xs"
        >· {{ $t('failoverInvalidCount', { count: lane.invalid.length }) }}</span>
        <span
          v-if="lane.failStreak"
          class="text-base-content/60 text-xs tabular-nums"
        >· {{ $t('failoverFailStreak', { count: lane.failStreak }) }}</span>
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-1">
        <div
          v-for="member in lane.members"
          :key="member.name"
          :class="['flex min-w-0 items-center gap-1 text-xs', member.invalid && 'line-through opacity-60']"
        >
          <ProxyName
            :name="member.name"
            :icon-size="14"
            :icon-margin="2"
            class="min-w-0"
          />
          <span
            v-if="lane.kernelNow === member.name && lane.mode === 'urltest'"
            class="badge badge-outline badge-xs"
          >{{ $t('failoverKernelNow') }}</span>
          <span
            v-if="member.invalid"
            class="text-base-content/50"
          >{{ $t('failoverInvalid') }}</span>
          <span
            v-else-if="member.probe?.ok === true"
            class="text-success tabular-nums"
          >{{ member.probe.delay }}ms</span>
          <span
            v-else-if="member.probe?.ok === false"
            class="text-error"
          >{{ $t('failoverProbeFailed') }}</span>
          <span
            v-else-if="member.probe"
            class="text-base-content/50"
          >{{ $t('failoverProbeUnknown') }}</span>
        </div>
        <span
          v-if="!lane.members.length"
          class="text-base-content/50 text-xs"
        >{{ $t('failoverLaneEmpty') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxFailoverLaneHealth, OpenboxFailoverLaneStatus } from '@/api/openbox'
import { managedOutbounds } from '@/store/openboxSiteSets'
import { failoverGroupByTag, watchFailoverStatus } from '@/store/openboxFailover'
import { proxyMap } from '@/store/proxies'
import { iconUrlFor } from '@/helper/iconUrl'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import ProxyIcon from './ProxyIcon.vue'
import ProxyName from './ProxyName.vue'

const props = defineProps<{
  name: string
  compact?: boolean
}>()
const { t } = useI18n()

// 定义从节点管理来(页签、成员、顺序),健康 / 当前页签从运行状态来;运行状态还没拉到时只显示定义
const definition = computed(() => managedOutbounds.value.find((g) => g.name === props.name))
const status = computed(() => failoverGroupByTag.value.get(props.name) ?? null)
// 内核 /proxies 里有的才是当前配置里真实存在的节点;定义里引用了但内核没有的就是失效引用
const isKnownNode = (name: string) => Boolean(proxyMap.value[name]) && !proxyMap.value[name].all?.length

interface LaneView {
  id: string
  name: string
  icon: string
  index: number
  mode: 'single' | 'urltest' | 'empty'
  health: OpenboxFailoverLaneHealth
  current: boolean
  failStreak: number
  kernelNow: string | null
  invalid: string[]
  members: Array<{ name: string; invalid: boolean; probe: OpenboxFailoverLaneStatus['nodes'][string] | undefined }>
}

const lanes = computed<LaneView[]>(() => {
  const defLanes = definition.value?.lanes ?? []
  const statusLanes = new Map((status.value?.lanes ?? []).map((l) => [l.id, l]))
  const currentId = status.value?.currentLaneId ?? null
  return defLanes.map((lane, index) => {
    const st = statusLanes.get(lane.id)
    const validSet = st ? new Set(st.valid) : null
    const members = lane.members.map((name) => {
      const invalid = validSet ? !validSet.has(name) : !isKnownNode(name)
      return { name, invalid, probe: st?.nodes?.[name] ?? undefined }
    })
    const validCount = members.filter((m) => !m.invalid).length
    const mode: LaneView['mode'] = st ? st.mode : validCount === 0 ? 'empty' : validCount === 1 ? 'single' : 'urltest'
    return {
      id: lane.id,
      name: lane.name,
      icon: lane.icon || '',
      index,
      mode,
      health: st?.health ?? (mode === 'empty' ? 'down' : 'unknown'),
      current: currentId === lane.id,
      failStreak: st?.failStreak ?? 0,
      kernelNow: st?.kernelNow ?? null,
      invalid: members.filter((m) => m.invalid).map((m) => m.name),
      members,
    }
  })
})
const currentLane = computed(() => lanes.value.find((l) => l.current) ?? null)
// 当前页签实际在用的节点:单节点页签就是那个节点;多节点页签是内核子组此刻选中的
const currentNode = computed(() => {
  const lane = currentLane.value
  if (!lane) return ''
  if (lane.mode === 'single') return lane.members.find((m) => !m.invalid)?.name ?? ''
  return lane.kernelNow ?? ''
})

const roleText = (index: number) => (index === 0 ? t('failoverPrimary') : t('failoverBackupN', { n: index }))
// 页签图标:自己挑的,没挑继承分组的
const laneIconUrl = (lane: { icon: string }) => iconUrlFor(lane.icon || definition.value?.icon || '')
const laneLabel = (lane: { index: number; name: string }) =>
  lane.name ? `${roleText(lane.index)} · ${lane.name}` : roleText(lane.index)
const modeText = (lane: LaneView) => {
  const valid = lane.members.filter((m) => !m.invalid).length
  if (lane.mode === 'empty') return t('failoverModeEmpty')
  if (lane.mode === 'single') return t('failoverModeSingle')
  return t('failoverModeUrltest', { count: valid })
}
const healthText = (h: OpenboxFailoverLaneHealth) =>
  h === 'up' ? t('failoverHealthUp') : h === 'down' ? t('failoverHealthDown') : t('failoverHealthUnknown')
const healthBadgeClass = (h: OpenboxFailoverLaneHealth) =>
  h === 'up' ? 'badge-success' : h === 'down' ? 'badge-error' : 'badge-ghost'

const statusText = computed(() => {
  const s = status.value?.status
  if (!s || s === 'pending') return t('failoverStatusPending')
  if (s === 'ok') return t('failoverStatusOk')
  if (s === 'backup') return t('failoverStatusBackup')
  if (s === 'failing') return t('failoverStatusFailing')
  if (s === 'reject') return t('failoverStatusReject')
  return t('failoverStatusUnknown')
})
const statusBadgeClass = computed(() => {
  const s = status.value?.status
  if (s === 'ok') return 'badge-success'
  if (s === 'backup') return 'badge-warning'
  if (s === 'failing' || s === 'reject') return 'badge-error'
  return 'badge-ghost'
})

const timeText = (at: number) => new Date(at).toLocaleTimeString()
const laneById = (id: string | null) => (id ? lanes.value.find((l) => l.id === id) ?? null : null)
const refLabel = (laneId: string | null, ref: string) => {
  const lane = laneById(laneId)
  if (lane) return laneLabel(lane)
  if (status.value && ref === status.value.rejectTag) return t('failoverReject')
  return ref || '—'
}
const reasonText = (reason: string) => {
  const key: Record<string, string> = {
    'lane-failed': 'failoverReasonLaneFailed',
    'restore-primary': 'failoverReasonRestore',
    'all-failed': 'failoverReasonAllFailed',
    recovered: 'failoverReasonRecovered',
    initial: 'failoverReasonInitial',
  }
  return key[reason] ? t(key[reason]) : reason
}
const lastSwitchText = computed(() => {
  const sw = status.value?.lastSwitch
  if (!sw) return ''
  return t('failoverLastSwitch', {
    from: refLabel(sw.from.laneId, sw.from.ref),
    to: refLabel(sw.to.laneId, sw.to.ref),
    reason: reasonText(sw.reason),
    time: timeText(sw.at),
  })
})

let release: (() => void) | null = null
onMounted(() => {
  release = watchFailoverStatus()
})
onBeforeUnmount(() => {
  release?.()
})
</script>
