<template>
  <!-- 每日流量明细的一行:点击展开,下面接一行放这条记录的构成(TrafficDrillPanel) -->
  <tr
    class="hover cursor-pointer"
    @click="$emit('toggle')"
  >
    <td class="max-w-[28rem]">
      <span class="flex items-center gap-1">
        <ChevronDownIcon
          class="text-base-content/50 h-3.5 w-3.5 shrink-0 transition-transform"
          :class="expanded && 'rotate-180'"
        />
        <span
          class="min-w-0 truncate"
          :title="row.key"
        >{{ row.key || '—' }}</span>
        <span
          v-if="note"
          class="text-base-content/60 shrink-0"
        >{{ note }}</span>
      </span>
    </td>
    <td class="text-right tabular-nums">{{ fmt(row.down) }}</td>
    <td class="text-right tabular-nums">{{ fmt(row.up) }}</td>
    <td class="text-right tabular-nums">{{ fmt(row.up + row.down) }}</td>
    <td>
      <div class="flex items-center gap-2">
        <progress
          class="progress progress-primary w-24"
          :value="share"
          max="100"
        />
        <span class="w-10 text-xs tabular-nums">{{ share }}%</span>
      </div>
    </td>
  </tr>
  <tr v-if="expanded">
    <td
      colspan="5"
      class="bg-base-200/40 p-2 pl-6"
    >
      <TrafficDrillPanel
        :day="day"
        :hour="hour"
        :kind="kind"
        :item-key="row.key"
        :dims="dims"
        :total="row"
      />
    </td>
  </tr>
</template>

<script setup lang="ts">
import type { OpenboxTrafficDim, OpenboxTrafficRow } from '@/api/openbox'
import { prettyBytesHelper } from '@/helper/utils'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { trafficRowNote } from '@/helper/trafficName'
import TrafficDrillPanel from './TrafficDrillPanel.vue'

const props = defineProps<{
  row: OpenboxTrafficRow
  share: number
  expanded: boolean
  day: string
  // 只看某个小时时是那个小时,整天是 null
  hour?: number | null
  kind: OpenboxTrafficDim
  dims: OpenboxTrafficDim[]
}>()
defineEmits<{ toggle: [] }>()

const { t } = useI18n()
const note = computed(() => trafficRowNote(props.row, t))
const fmt = (n?: number) => prettyBytesHelper(Math.max(0, Math.round(n || 0)), { maximumFractionDigits: 1 })
</script>
