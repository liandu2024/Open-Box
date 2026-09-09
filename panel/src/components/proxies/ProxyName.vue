<template>
  <div class="flex shrink-0 items-center select-text">
    <ProxyIcon
      v-if="icon"
      :icon="icon"
      :margin="iconMargin"
      :size="iconSize"
      :scale="node?.iconScale"
    />
    {{ displayName }}
    <template v-if="dialerProxy"> ({{ dialerProxy }}) </template>
  </div>
</template>

<script setup lang="ts">
import { proxyMap } from '@/store/proxies'
import { failoverDisplayName } from '@/store/openboxFailover'
import { computed } from 'vue'
import ProxyIcon from './ProxyIcon.vue'

const props = withDefaults(
  defineProps<{
    name: string
    iconSize?: number
    iconMargin?: number
  }>(),
  {
    iconSize: 16,
    iconMargin: 4,
  },
)

const node = computed(() => proxyMap.value[props.name])
// 故障转移的内部子组 tag(__fo:组id:页签id)不是产品名称:显示成页签名,没起名就显示「主用 / 备用 N」
const displayName = computed(() => failoverDisplayName(props.name))
const icon = computed(() => {
  return node.value?.icon
})
const dialerProxy = computed(() => {
  return node.value?.['dialer-proxy']
})
</script>
