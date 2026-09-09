<template>
  <div
    ref="cardRef"
    :class="
      twMerge(
        'proxy-node-card bg-base-200 border-base-content/[0.08] flex flex-col items-start rounded-md border transition-colors duration-150',
        selectable ? 'cursor-pointer' : 'cursor-default',
        hoverClass,
        isSmallCard ? 'gap-1 p-1' : 'gap-2 p-2',
        latencyTipAnimationClass,
      )
    "
    @contextmenu.stop.prevent="handlerLatencyTest"
    @click="onClick"
  >
    <div
      class="w-full flex-1 text-sm"
      :class="truncateProxyName && 'truncate'"
      @mouseenter="checkTruncation"
    >
      <ProxyIcon
        v-if="shownIcon"
        class="-mt-[2px] shrink-0 align-middle"
        :icon="shownIcon"
        :size="16"
        :scale="icon !== undefined ? iconScale : node.iconScale"
        :fill="active ? 'fill-primary-content' : 'fill-base-content'"
      /><span
        v-if="active"
        class="text-primary-content"
        >{{ displayName }}</span
      ><span
        v-else
        class="text-base-content"
        >{{ displayName }}</span
      >
    </div>

    <div class="flex h-4 w-full items-center justify-between">
      <span
        :class="`truncate text-xs tracking-tight ${active ? 'text-primary-content' : 'text-base-content/60'}`"
        @mouseenter="checkTruncation"
      >
        {{ typeDescription }}
      </span>
      <LatencyTag
        :class="[isSmallCard && 'h-4! w-8! rounded-md!', 'shrink-0', active && 'hover:bg-base-300']"
        :name="node.name"
        :loading="isLatencyTesting"
        :group-name="groupName"
        @click.stop="handlerLatencyTest"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { failoverDisplayName, isFailoverGroup } from '@/store/openboxFailover'
import { PROXY_CARD_SIZE, PROXY_SORT_TYPE, PROXY_TYPE } from '@/constant'
import { checkTruncation } from '@/helper/tooltip'
import { scrollIntoCenter } from '@/helper/utils'
import { getIPv6ByName, getTestUrl, isManualSelectable, proxyGroupLatencyTest, proxyLatencyTest, proxyMap } from '@/store/proxies'
import { IPv6test, proxyCardSize, proxySortType, theme, truncateProxyName } from '@/store/settings'
import { smartWeightsMap } from '@/store/smart'
import { twMerge } from 'tailwind-merge'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LatencyTag from './LatencyTag.vue'
import ProxyIcon from './ProxyIcon.vue'

const DARK_HOVER_THEMES = new Set([
  'dark',
  'dark-legacy',
  'synthwave',
  'halloween',
  'forest',
  'aqua',
  'black',
  'luxury',
  'dracula',
  'business',
  'night',
  'coffee',
  'dim',
  'sunset',
  'abyss',
  'silk',
])

const { t } = useI18n()
const props = defineProps<{
  name: string
  active?: boolean
  groupName?: string
  // 卡片标题用别的文字(故障转移的页签卡片:标题是页签名 / 角色,name 仍是它在内核里的出站)
  label?: string
  // 卡片图标用别的(URL;故障转移的页签卡片用页签图标,没挑就是父组的);给了空串 = 不显示图标
  icon?: string
  iconScale?: number
}>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()

const cardRef = ref()
// 能不能点了切换,按所在的组判(store/proxies.ts 的 isManualSelectable):站点集 / 手动组的成员可点;自动择优 /
// 故障转移(含页签子组)的成员不可点——它们走哪个节点不由用户定。不用布尔 prop:Vue 对没传的布尔 prop 一律当
// false,会把所有卡片都变成不可点
const selectable = computed(() => isManualSelectable(props.groupName))
// 点击只在可选的组里往外发(父组件据此切换);不可选的把事件吞掉,不让它冒泡到外层的折叠开关
const onClick = (event: MouseEvent) => {
  event.stopPropagation()
  if (selectable.value) emit('click', event)
}
const node = computed(() => proxyMap.value[props.name])
// 故障转移的内部子组显示成页签名 / 角色,不露 __fo: 技术 tag
const displayName = computed(() => props.label ?? failoverDisplayName(node.value.name))
const shownIcon = computed(() => (props.icon !== undefined ? props.icon : node.value?.icon))
const isLatencyTesting = ref(false)
const typeFormatter = (type: string) => {
  type = type.toLowerCase()
  type = type.replace('shadowsocks', 'ss')
  type = type.replace('hysteria', 'hy')
  type = type.replace('wireguard', 'wg')

  return type
}
const isSmallCard = computed(() => proxyCardSize.value === PROXY_CARD_SIZE.SMALL)
const hoverClass = computed(() => {
  if (props.active) {
    return 'bg-primary border-base-content/[0.16] sm:hover:bg-primary/95 sm:hover:border-base-content/[0.24]'
  }

  return DARK_HOVER_THEMES.has(theme.value)
    ? 'sm:hover:!bg-[#4b4428] sm:hover:border-base-content/[0.16]'
    : 'sm:hover:!bg-[#f1ead6] sm:hover:border-base-content/[0.16]'
})
const typeDescription = computed(() => {
  const type = typeFormatter(node.value.type)
  const smartUsage = smartWeightsMap.value[props.groupName ?? '']?.[props.name]
  const smartDesc = smartUsage ? t(smartUsage) : ''
  const isV6 = IPv6test.value && getIPv6ByName(node.value.name) ? 'IPv6' : ''
  const isUDP = node.value.udp ? (node.value.xudp ? 'xudp' : 'udp') : ''

  return [type, isUDP, smartDesc, isV6].filter(Boolean).join(isSmallCard.value ? '/' : ' / ')
})

const latencyTipAnimationClass = ref<string[]>([])
const handlerLatencyTest = async () => {
  if (isLatencyTesting.value) return

  isLatencyTesting.value = true
  try {
    // 这张卡片本身是个自动择优组(站点集 / 组的成员列表里会出现)时,测的应该是"这个组"
    // 而不是"经这个组出去有多快":后者只从组当前选中的那个节点上跑一次,既不重测其它成员,
    // 也不会重新择优——当前选中的节点已经不通时,点它必然超时,而且线路不会自己换。
    // 走 proxyGroupLatencyTest 就是内核的 /group/<name>/delay:强制重测全部成员并立即重新择优。
    // 故障转移组同理:整组按页签测,报统一的提示(store/proxies.ts 的 failoverGroupLatencyTest)
    if (node.value.type?.toLowerCase() === PROXY_TYPE.URLTest || isFailoverGroup(props.name)) {
      await proxyGroupLatencyTest(props.name)
    } else {
      await proxyLatencyTest(props.name, getTestUrl(props.groupName))
    }
    isLatencyTesting.value = false
  } catch {
    isLatencyTesting.value = false
  }

  if (
    [PROXY_SORT_TYPE.LATENCY_ASC, PROXY_SORT_TYPE.LATENCY_DESC].includes(proxySortType.value) &&
    cardRef.value
  ) {
    const classList = ['bg-info/20!', 'transition-colors', 'duration-1500']

    scrollIntoCenter(cardRef.value)
    latencyTipAnimationClass.value = classList
    setTimeout(() => {
      latencyTipAnimationClass.value = []
    }, 1500)
  }
}

onMounted(() => {
  if (props.active) {
    setTimeout(() => {
      scrollIntoCenter(cardRef.value)
    }, 300)
  }
})
</script>

<style scoped>
.tooltip:before {
  z-index: 20;
}
</style>
