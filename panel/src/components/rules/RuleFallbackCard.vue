<template>
  <div
    v-if="rule"
    class="card"
  >
    <div class="app-card-padding flex flex-col gap-3 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-medium">{{ $t('ruleLookupFallbackMatched') }}</span>
      </div>

      <div class="flex min-h-6 flex-wrap items-center gap-1 md:gap-2">
        <span>{{ rule.type }}</span>
        <span
          v-if="rule.payload"
          class="text-main"
        >
          {{ rule.payload }}
        </span>
      </div>

      <div class="text-base-content/80 flex min-h-6 flex-wrap items-center gap-1 md:gap-2">
        <div class="min-w-0 flex-1 overflow-hidden text-sm">
          <ProxyGroupNow
            v-if="showProxyRoute"
            v-bind="{ name: rule.proxy, includeSelf: true, forceFullRoute: true }"
          />
          <ProxyName
            v-else
            :name="rule.proxy"
            class="text-base-content/80 text-xs md:text-sm"
          />
        </div>
        <span
          v-if="latency !== NOT_CONNECTED && displayLatencyInRule"
          :class="latencyColor"
          class="ml-1 text-xs"
        >
          {{ latency }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NOT_CONNECTED } from '@/constant'
import { getColorForLatency } from '@/helper'
import { getLatencyByName, proxyMap } from '@/store/proxies'
import { displayLatencyInRule, displayNowNodeInRule } from '@/store/settings'
import type { Rule } from '@/types'
import { computed } from 'vue'
import ProxyGroupNow from '../proxies/ProxyGroupNow.vue'
import ProxyName from '../proxies/ProxyName.vue'

const props = defineProps<{
  rule: Rule | null
}>()

const showProxyRoute = computed(() => {
  return Boolean(props.rule && displayNowNodeInRule.value && proxyMap.value[props.rule.proxy]?.now)
})

const latency = computed(() => {
  if (!props.rule) {
    return NOT_CONNECTED
  }

  return getLatencyByName(props.rule.proxy, props.rule.proxy)
})

const latencyColor = computed(() => getColorForLatency(Number(latency.value)))
</script>
