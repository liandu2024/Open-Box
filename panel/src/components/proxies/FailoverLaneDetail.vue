<template>
  <!-- 策略穿透里故障转移组的下面一栏:上面选中的那个页签的明细。头部和上一栏(ProxyEmbeddedGroup)同一套
       布局——大图标 / 标题 + 类型 / 当前节点链 / 右侧延迟标签和速率,下面是页签的节点卡片,高亮内核在这个
       页签里选中的节点(多节点页签由内部自动择优子组定,单节点页签就是那个节点);失效引用另列 -->
  <div
    v-if="lane"
    class="pt-1 pb-0"
    @contextmenu.prevent.stop="handlerLatencyTest"
  >
    <div
      v-if="useLargeProxyGroupIcon"
      class="relative flex items-start gap-3"
    >
      <div
        v-if="iconUrl"
        class="flex h-13 w-13 shrink-0 items-start justify-center overflow-visible pt-0.5"
      >
        <ProxyIcon
          :icon="iconUrl"
          :size="titleIconSize"
          :scale="lane.iconScale"
          :margin="0"
        />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="flex min-w-0 items-center gap-1">
          <span class="shrink-0 text-base">{{ lane.label }}</span>
          <span class="text-base-content/60 min-w-0 truncate text-xs">
            {{ modeText }} ({{ nodeStats.valid }}/{{ nodeStats.total }})
          </span>
          <span
            v-if="lane.id === currentLaneId"
            class="badge badge-xs badge-success shrink-0"
          >{{ $t('failoverCurrent') }}</span>
          <span
            v-if="health"
            :class="['badge badge-xs shrink-0', healthBadgeClass]"
          >{{ healthText }}</span>
        </div>
        <div class="text-base-content/80 flex w-full items-center">
          <div class="flex min-w-0 flex-1 items-center gap-1 truncate pr-3 text-sm">
            <ProxyName
              v-if="lane.kernelNow"
              :name="lane.kernelNow"
              class="text-base-content/80 text-xs md:text-sm"
            />
            <span
              v-else
              class="text-base-content/50 text-xs"
            >{{ $t('failoverLaneEmpty') }}</span>
          </div>
        </div>
      </div>
      <div class="flex w-16 shrink-0 flex-col items-end gap-2 self-stretch">
        <LatencyTag
          :class="twMerge('bg-base-200/50 hover:bg-base-200 z-10')"
          :loading="isLatencyTesting"
          :name="lane.kernelNow ?? undefined"
          :group-name="lane.subTag ?? groupName"
          @click.stop="handlerLatencyTest"
        />
        <div class="text-base-content/80 mt-auto w-full text-right text-xs">
          {{ prettyBytesHelper(downloadTotal) }}/s
        </div>
      </div>
    </div>
    <template v-else>
      <div class="relative flex items-center gap-2">
        <div class="flex min-w-0 flex-1 items-center gap-1">
          <div class="flex shrink-0 items-center">
            <ProxyIcon
              v-if="iconUrl"
              :icon="iconUrl"
              :size="proxyGroupIconSize"
              :scale="lane.iconScale"
              :margin="proxyGroupIconMargin"
            />
            <span>{{ lane.label }}</span>
          </div>
          <span class="text-base-content/60 ml-1 min-w-0 truncate text-xs">
            {{ modeText }} ({{ nodeStats.valid }}/{{ nodeStats.total }})
          </span>
          <span
            v-if="lane.id === currentLaneId"
            class="badge badge-xs badge-success shrink-0"
          >{{ $t('failoverCurrent') }}</span>
          <span
            v-if="health"
            :class="['badge badge-xs shrink-0', healthBadgeClass]"
          >{{ healthText }}</span>
        </div>
        <LatencyTag
          :class="twMerge('bg-base-200/50 hover:bg-base-200 z-10')"
          :loading="isLatencyTesting"
          :name="lane.kernelNow ?? undefined"
          :group-name="lane.subTag ?? groupName"
          @click.stop="handlerLatencyTest"
        />
      </div>
      <div class="text-base-content/80 mt-1.5 flex items-center gap-2">
        <div class="flex min-w-0 flex-1 items-center gap-1 truncate text-sm">
          <ProxyName
            v-if="lane.kernelNow"
            :name="lane.kernelNow"
            class="text-base-content/80 text-xs md:text-sm"
          />
          <span
            v-else
            class="text-base-content/50 text-xs"
          >{{ $t('failoverLaneEmpty') }}</span>
        </div>
        <div class="min-w-12 shrink-0 text-right text-xs">
          {{ prettyBytesHelper(downloadTotal) }}/s
        </div>
      </div>
    </template>

    <div
      v-if="lane.valid.length"
      class="pt-1.5"
    >
      <ProxyNodeGrid>
        <ProxyNodeCard
          v-for="node in lane.valid"
          :key="node"
          :name="node"
          :group-name="lane.subTag ?? groupName"
          :active="node === lane.kernelNow"
          @click.stop="handlerProxySelect(lane.subTag ?? groupName, node)"
        />
      </ProxyNodeGrid>
    </div>
    <p
      v-if="lane.invalid.length"
      class="text-base-content/50 pt-1.5 text-xs"
    >{{ $t('failoverInvalid') }}: {{ lane.invalid.join('、') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useGroupNodeStats } from '@/composables/groupNodeStats'
import { iconUrlFor } from '@/helper/iconUrl'
import { prettyBytesHelper } from '@/helper/utils'
import { activeConnections } from '@/store/connections'
import { failoverCurrentLaneId, failoverGroupByTag, failoverLanesOf, watchFailoverStatus } from '@/store/openboxFailover'
import { getTestUrl, handlerProxySelect, proxyGroupLatencyTest, proxyLatencyTest, proxyMap } from '@/store/proxies'
import { proxyGroupIconMargin, proxyGroupIconSize, useLargeProxyGroupIcon } from '@/store/settings'
import { twMerge } from 'tailwind-merge'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LatencyTag from './LatencyTag.vue'
import ProxyIcon from './ProxyIcon.vue'
import ProxyName from './ProxyName.vue'
import ProxyNodeCard from './ProxyNodeCard.vue'
import ProxyNodeGrid from './ProxyNodeGrid.vue'

const props = defineProps<{
  groupName: string
  laneId: string
}>()
const { t } = useI18n()

const lanes = computed(() => failoverLanesOf(props.groupName, proxyMap.value) ?? [])
const lane = computed(() => lanes.value.find((l) => l.id === props.laneId) ?? null)
const currentLaneId = computed(() =>
  failoverCurrentLaneId(props.groupName, lanes.value, proxyMap.value[props.groupName]?.now),
)
const iconUrl = computed(() => iconUrlFor(lane.value?.icon))
const titleIconSize = computed(() => Math.max(proxyGroupIconSize.value, 46))
const modeText = computed(() => {
  const l = lane.value
  if (!l) return ''
  if (!l.valid.length) return t('failoverModeEmpty')
  if (l.valid.length === 1) return t('failoverModeSingle')
  return t('failoverModeUrltest', { count: l.valid.length })
})
// 标题后的「有效 / 总数」和上一栏同一口径:最近一次延迟测试有结果的算有效
const validNodes = computed(() => lane.value?.valid ?? [])
const nodeStats = useGroupNodeStats(validNodes, props.groupName)
const health = computed(() => {
  const st = failoverGroupByTag.value.get(props.groupName)?.lanes.find((l) => l.id === props.laneId)
  return st?.health ?? null
})
const healthText = computed(() =>
  health.value === 'up' ? t('failoverHealthUp') : health.value === 'down' ? t('failoverHealthDown') : t('failoverHealthUnknown'),
)
const healthBadgeClass = computed(() =>
  health.value === 'up' ? 'badge-success' : health.value === 'down' ? 'badge-error' : 'badge-ghost',
)
// 经这个页签的连接速率:多节点页签看内部子组,单节点页签看那个节点
const downloadTotal = computed(() => {
  const key = lane.value?.subTag ?? lane.value?.kernelNow
  if (!key) return 0
  return activeConnections.value
    .filter((conn) => conn.chains.includes(key))
    .reduce((total, conn) => total + conn.downloadSpeed, 0)
})

const isLatencyTesting = ref(false)
const handlerLatencyTest = async () => {
  const l = lane.value
  if (isLatencyTesting.value || !l) return
  isLatencyTesting.value = true
  try {
    if (l.subTag) await proxyGroupLatencyTest(l.subTag)
    else if (l.kernelNow) await proxyLatencyTest(l.kernelNow, getTestUrl(props.groupName))
  } finally {
    isLatencyTesting.value = false
  }
}

// 策略页签上没有故障转移组自己的卡片在拉运行状态,这里看着穿透时自己拉(健康 / 当前页签按服务端记录来)
let release: (() => void) | null = null
onMounted(() => {
  release = watchFailoverStatus()
})
onBeforeUnmount(() => {
  release?.()
})
</script>
