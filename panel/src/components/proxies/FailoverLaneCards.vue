<template>
  <!-- 策略穿透里故障转移组的上面一栏:各主备页签一张卡(标题是页签名 / 角色,卡片本身是它在内核里的出站:
       单节点页签就是那个节点,多节点页签是内部自动择优子组);点一张卡,下面一栏换成它的节点,不改内核的
       选择(主备由服务端按检测结果切;内核此刻在哪个页签看父组标题下的链路) -->
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
          :icon="iconUrlFor(lane.icon)"
          :icon-scale="lane.iconScale"
          :group-name="groupName"
          :active="lane.id === selectedLaneId"
          @click.stop="$emit('select', lane.id)"
        />
      </div>
      <div
        v-else
        class="bg-base-200 border-base-content/[0.08] flex min-w-0 flex-col items-start gap-2 rounded-md border p-2 opacity-60"
      >
        <span class="flex w-full min-w-0 items-center truncate text-sm">
          <ProxyIcon
            v-if="iconUrlFor(lane.icon)"
            class="-mt-[2px] shrink-0 align-middle"
            :icon="iconUrlFor(lane.icon)"
            :size="16"
            :scale="lane.iconScale"
          />{{ lane.label }}
        </span>
        <span class="text-base-content/60 text-xs">{{ $t('failoverModeEmpty') }}</span>
      </div>
    </template>
  </ProxyNodeGrid>
</template>

<script setup lang="ts">
import { iconUrlFor } from '@/helper/iconUrl'
import { failoverLanesOf } from '@/store/openboxFailover'
import { proxyMap } from '@/store/proxies'
import { computed } from 'vue'
import ProxyIcon from './ProxyIcon.vue'
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
</script>
