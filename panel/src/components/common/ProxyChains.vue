<template>
  <div
    v-for="(name, index) in proxyChains"
    :key="name"
  >
    <div
      v-if="index > 0"
      class="border-base-content/15 border-b"
    />
    <ProxyGroup
      :name="name"
      class="transparent-collapse"
    />
  </div>
</template>

<script setup lang="ts">
import { getProxyGroupChains } from '@/store/proxies'
import { computed } from 'vue'
import ProxyGroup from '../proxies/ProxyGroup.vue'

const props = defineProps<{
  name: string
}>()

const proxyChains = computed(() => {
  return getProxyGroupChains(props.name)
})
</script>
