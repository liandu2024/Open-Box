<template>
  <!-- 策略穿透里故障转移组的下面一栏:上面选中的那个页签的明细节点。高亮的是内核在这个页签里选中的节点
       (多节点页签由内部自动择优子组定,单节点页签就是那个节点);失效引用另列 -->
  <div
    v-if="lane"
    class="pt-1"
  >
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span class="text-base">{{ lane.label }}</span>
      <span
        v-if="lane.index > 0 && lane.label !== roleText"
        class="text-base-content/60 text-xs"
      >{{ roleText }}</span>
      <span class="text-base-content/60 text-xs">{{ modeText }}</span>
      <span
        v-if="lane.id === currentLaneId"
        class="badge badge-xs badge-success"
      >{{ $t('failoverCurrent') }}</span>
      <span
        v-if="health"
        :class="['badge badge-xs', health === 'up' ? 'badge-success' : health === 'down' ? 'badge-error' : 'badge-ghost']"
      >{{ healthText }}</span>
    </div>
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
      v-else
      class="text-base-content/60 pt-1.5 text-xs"
    >{{ $t('failoverLaneEmpty') }}</p>
    <p
      v-if="lane.invalid.length"
      class="text-base-content/50 pt-1.5 text-xs"
    >{{ $t('failoverInvalid') }}: {{ lane.invalid.join('、') }}</p>
  </div>
</template>

<script setup lang="ts">
import { failoverCurrentLaneId, failoverGroupByTag, failoverLanesOf, failoverRoleLabel, watchFailoverStatus } from '@/store/openboxFailover'
import { handlerProxySelect, proxyMap } from '@/store/proxies'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
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
const roleText = computed(() => (lane.value ? failoverRoleLabel(lane.value.index) : ''))
const modeText = computed(() => {
  const l = lane.value
  if (!l) return ''
  if (!l.valid.length) return t('failoverModeEmpty')
  if (l.valid.length === 1) return t('failoverModeSingle')
  return t('failoverModeUrltest', { count: l.valid.length })
})
const health = computed(() => {
  const st = failoverGroupByTag.value.get(props.groupName)?.lanes.find((l) => l.id === props.laneId)
  return st?.health ?? null
})
const healthText = computed(() =>
  health.value === 'up' ? t('failoverHealthUp') : health.value === 'down' ? t('failoverHealthDown') : t('failoverHealthUnknown'),
)

// 策略页签上没有故障转移组自己的卡片在拉运行状态,这里看着穿透时自己拉(健康 / 当前页签按服务端记录来)
let release: (() => void) | null = null
onMounted(() => {
  release = watchFailoverStatus()
})
onBeforeUnmount(() => {
  release?.()
})
</script>
