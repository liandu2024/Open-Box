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
      <ExclamationTriangleIcon
        v-if="isStale"
        class="text-warning h-4 w-4 shrink-0"
        @mouseenter="tipForStale"
      />
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
import { getProxyRouteChain, isUrlTestGroupStale, proxyMap } from '@/store/proxies'
import {
  ArrowRightCircleIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
} from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ProxyName from './ProxyName.vue'

const props = defineProps<{
  name: string
  mobile?: boolean
  includeSelf?: boolean
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

  // 一律显示完整的路由链(站点集 → 节点组 → 节点):以前有个「显示完整路由节点」开关,
  // 默认就是开的,关掉只会让人看不出流量最终落在哪条线路上,所以去掉了开关。
  const routeChain = getProxyRouteChain(props.name)
  const baseRouteNames = routeChain.length > 0 ? routeChain : [now]

  if (!props.includeSelf || baseRouteNames[0] === props.name) {
    return baseRouteNames
  }

  return [props.name, ...baseRouteNames]
})

// 自动择优组选中的线路已经失效(见 store/proxies.ts):面板已经在后台替它重测重选,
// 这里只是把"为什么这条线路没有延迟"说清楚,免得看起来像面板没测。
const isStale = computed(() => isUrlTestGroupStale(props.name))

const tipForStale = (e: Event) => {
  showTip(e, t('urlTestStaleTip'), { delay: [300, 0] })
}

const tipForFixed = (e: Event) => {
  if (!isFixed.value) {
    return
  }

  showTip(e, t('tipForFixed', { type: proxyGroup.value.type }), {
    delay: [500, 0],
  })
}
</script>
