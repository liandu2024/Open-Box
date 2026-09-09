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
import { failoverLaneOfTag, isFailoverInternalTag } from '@/store/openboxFailover'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
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
const { t } = useI18n()
// 故障转移的内部子组 tag(__fo:组id:页签id)不是产品名称:链路里显示成「主用 / 备用 1」这样的页签角色
const displayName = computed(() => {
  if (!isFailoverInternalTag(props.name)) return props.name
  const hit = failoverLaneOfTag(props.name)
  if (!hit) return t('failoverLaneFallback')
  const role = hit.index === 0 ? t('failoverPrimary') : t('failoverBackupN', { n: hit.index })
  return hit.lane.name ? `${role} · ${hit.lane.name}` : role
})
const icon = computed(() => {
  return node.value?.icon
})
const dialerProxy = computed(() => {
  return node.value?.['dialer-proxy']
})
</script>
