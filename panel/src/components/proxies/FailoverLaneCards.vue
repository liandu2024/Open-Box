<template>
  <!-- 策略穿透里故障转移组的上面一栏:各主备页签一张卡(标题是页签名 / 角色,卡片本身是它在内核里的出站:
       单节点页签就是那个节点,多节点页签是内部自动择优子组),内核此刻在的页签带「当前」;点一张卡,下面一栏
       换成它的节点,不改内核的选择(主备由服务端按检测结果切) -->
  <ProxyNodeGrid>
    <template
      v-for="lane in lanes"
      :key="lane.id"
    >
      <div
        v-if="lane.ref"
        class="relative min-w-0"
      >
        <ProxyNodeCard
          :name="lane.ref"
          :label="lane.label"
          :group-name="groupName"
          :active="lane.id === selectedLaneId"
          @click.stop="$emit('select', lane.id)"
        />
        <span
          v-if="lane.id === currentLaneId"
          class="badge badge-xs badge-success pointer-events-none absolute top-1 right-1"
        >{{ $t('failoverCurrent') }}</span>
      </div>
      <div
        v-else
        class="bg-base-200 border-base-content/[0.08] flex min-w-0 flex-col items-start gap-2 rounded-md border p-2 opacity-60"
      >
        <span class="w-full truncate text-sm">{{ lane.label }}</span>
        <span class="text-base-content/60 text-xs">{{ $t('failoverModeEmpty') }}</span>
      </div>
    </template>
  </ProxyNodeGrid>
</template>

<script setup lang="ts">
import { failoverCurrentLaneId, failoverLanesOf } from '@/store/openboxFailover'
import { proxyMap } from '@/store/proxies'
import { computed } from 'vue'
import ProxyNodeCard from './ProxyNodeCard.vue'
import ProxyNodeGrid from './ProxyNodeGrid.vue'

const props = defineProps<{
  groupName: string
  selectedLaneId: string | null
}>()
defineEmits<{
  select: [laneId: string]
}>()

const lanes = computed(() => failoverLanesOf(props.groupName, proxyMap.value) ?? [])
const currentLaneId = computed(() =>
  failoverCurrentLaneId(props.groupName, lanes.value, proxyMap.value[props.groupName]?.now),
)
</script>
