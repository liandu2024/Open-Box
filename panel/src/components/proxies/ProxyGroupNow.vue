<template>
  <template v-if="proxyGroup.now">
    <LockClosedIcon
      v-if="isFixed"
      class="h-4 w-4 shrink-0 outline-none"
      @mouseenter="tipForFixed"
    />
    <div
      class="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap"
    >
      <template
        v-for="(routeName, index) in routeNames"
        :key="`${routeName}-${index}`"
      >
        <ArrowRightCircleIcon
          v-if="index > 0"
          class="h-4 w-4 shrink-0"
        />
        <ProxyName
          :name="routeName"
          class="text-base-content/80 text-xs md:text-sm"
        />
      </template>
    </div>
  </template>
  <template v-else-if="proxyGroup.type.toLowerCase() === PROXY_TYPE.LoadBalance">
    <CheckCircleIcon class="h-4 w-4 shrink-0" />
    <span class="text-base-content/80 text-xs md:text-sm">
      {{ $t('loadBalance') }}
    </span>
  </template>
</template>

<script setup lang="ts">
import { PROXY_TYPE } from '@/constant'
import { useTooltip } from '@/helper/tooltip'
import { getProxyRouteChain, proxyMap } from '@/store/proxies'
import { displayFinalOutbound } from '@/store/settings'
import { ArrowRightCircleIcon, CheckCircleIcon, LockClosedIcon } from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ProxyName from './ProxyName.vue'

const props = defineProps<{
  name: string
  mobile?: boolean
  includeSelf?: boolean
  forceFullRoute?: boolean
}>()
const proxyGroup = computed(() => proxyMap.value[props.name])
const { showTip } = useTooltip()
const { t } = useI18n()

const isFixed = computed(() => {
  return proxyGroup.value.fixed === proxyGroup.value.now
})

const routeNames = computed(() => {
  const now = proxyGroup.value.now

  if (!now) {
    return []
  }

  const shouldShowFullRoute = props.forceFullRoute || displayFinalOutbound.value

  const baseRouteNames = !shouldShowFullRoute
    ? [now]
    : (() => {
        const routeChain = getProxyRouteChain(props.name)

        return routeChain.length > 0 ? routeChain : [now]
      })()

  if (!props.includeSelf || baseRouteNames[0] === props.name) {
    return baseRouteNames
  }

  return [props.name, ...baseRouteNames]
})

const tipForFixed = (e: Event) => {
  if (!isFixed.value) {
    return
  }

  showTip(e, t('tipForFixed', { type: proxyGroup.value.type }), {
    delay: [500, 0],
  })
}
</script>
