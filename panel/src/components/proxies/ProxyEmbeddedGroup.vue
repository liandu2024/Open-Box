<template>
  <div
    class="pt-1 pb-0"
    @contextmenu.prevent.stop="handlerLatencyTest"
  >
    <div
      class="cursor-pointer overflow-hidden"
      @click="showCollapse = !showCollapse"
    >
      <div
        v-if="useLargeProxyGroupIcon"
        class="relative flex items-start gap-3"
      >
        <div
          v-if="proxyGroup.icon"
          class="flex h-13 w-13 shrink-0 items-start justify-center overflow-visible pt-0.5"
        >
          <ProxyIcon
            :icon="proxyGroup.icon"
            :size="titleIconSize"
            :scale="proxyGroup.iconScale"
            :margin="0"
          />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex min-w-0 items-center gap-1">
            <span class="shrink-0 text-base">{{ displayName }}</span>
            <span class="text-base-content/60 min-w-0 flex-1 truncate text-xs">
              {{ typeText }} ({{ proxiesCount }})
            </span>
            <button
              v-if="manageHiddenGroup"
              class="btn btn-circle btn-xs z-10"
              @click.stop="handlerGroupToggle"
            >
              <EyeIcon
                v-if="!hiddenGroup"
                class="h-3 w-3"
              />
              <EyeSlashIcon
                v-else
                class="h-3 w-3"
              />
            </button>
          </div>
          <div class="text-base-content/80 flex w-full items-center">
            <div class="flex min-w-0 flex-1 items-center gap-1 truncate pr-3 text-sm">
              <ProxyGroupNow
                :name="name"
              />
            </div>
          </div>
        </div>
        <div class="flex w-16 shrink-0 flex-col items-end gap-2 self-stretch">
          <LatencyTag
            :class="twMerge('bg-base-200/50 hover:bg-base-200 z-10')"
            :loading="isLatencyTesting"
            :name="proxyGroup.now"
            :group-name="proxyGroup.name"
            @click.stop="handlerLatencyTest"
          />
          <div class="text-base-content/80 mt-auto w-full text-right text-xs">
            {{ prettyBytesHelper(downloadTotal) }}/s
          </div>
        </div>
      </div>
      <div
        v-else
        class="relative flex items-center gap-2"
      >
        <div class="flex flex-1 items-center gap-1">
          <ProxyName
            :name="name"
            :icon-size="proxyGroupIconSize"
            :icon-margin="proxyGroupIconMargin"
          />
          <span class="text-base-content/60 ml-1 text-xs">
            {{ typeText }} ({{ proxiesCount }})
          </span>
          <button
            v-if="manageHiddenGroup"
            class="btn btn-circle btn-xs z-10 ml-1"
            @click.stop="handlerGroupToggle"
          >
            <EyeIcon
              v-if="!hiddenGroup"
              class="h-3 w-3"
            />
            <EyeSlashIcon
              v-else
              class="h-3 w-3"
            />
          </button>
        </div>
        <LatencyTag
          :class="twMerge('bg-base-200/50 hover:bg-base-200 z-10')"
          :loading="isLatencyTesting"
          :name="proxyGroup.now"
          :group-name="proxyGroup.name"
          @click.stop="handlerLatencyTest"
        />
      </div>
      <div
        v-if="!useLargeProxyGroupIcon"
        class="text-base-content/80 mt-1.5 flex items-center gap-2"
      >
        <div class="flex flex-1 items-center gap-1 truncate text-sm">
          <ProxyGroupNow
            :name="name"
          />
        </div>
        <div class="min-w-12 shrink-0 text-right text-xs">
          {{ prettyBytesHelper(downloadTotal) }}/s
        </div>
      </div>

      <div
        v-if="!showCollapse"
        class="pt-0"
      >
        <div
          v-if="isWindowResizing"
          class="bg-base-content/10 h-4 rounded-full"
        />
        <ProxyPreview
          v-else
          :nodes="renderProxies"
          :now="proxyGroup.now"
          :groupName="proxyGroup.name"
          :relaxed-dots-spacing="true"
          @nodeclick="handlePreviewSelect"
        />
      </div>
    </div>

    <div
      v-if="showCollapse && !isWindowResizing"
      class="pt-1.5"
    >
      <!-- 故障转移组这一层:上面一栏是各个主备页签(当前页签高亮,点哪个下面一栏就看哪个的节点) -->
      <FailoverLaneCards
        v-if="isFailover"
        :group-name="name"
        :selected-lane-id="selectedLaneId"
        @select="(laneId) => emit('lane-change', name, laneId)"
      />
      <Component
        v-else
        :is="groupProxiesByProvider ? ProxiesByProvider : ProxiesContent"
        :name="name"
        :now="proxyGroup.now"
        :render-proxies="renderProxies"
        :render-all="true"
        @select="handleSelectionChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useBounceOnVisible } from '@/composables/bouncein'
import { useRenderProxies } from '@/composables/renderProxies'
import { isHiddenGroup } from '@/helper'
import { prettyBytesHelper } from '@/helper/utils'
import { isWindowResizing } from '@/helper/windowResizeState'
import { activeConnections } from '@/store/connections'
import {
  handlerProxySelect,
  hiddenGroupMap,
  proxyGroupLatencyTest,
  proxyMap,
} from '@/store/proxies'
import {
  collapseGroupMap,
  groupProxiesByProvider,
  manageHiddenGroup,
  proxyGroupIconMargin,
  proxyGroupIconSize,
  useLargeProxyGroupIcon,
} from '@/store/settings'
import { failoverDisplayName, failoverMembersOf, isFailoverGroup } from '@/store/openboxFailover'
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline'
import { twMerge } from 'tailwind-merge'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FailoverLaneCards from './FailoverLaneCards.vue'
import LatencyTag from './LatencyTag.vue'
import ProxiesByProvider from './ProxiesByProvider.vue'
import ProxiesContent from './ProxiesContent.vue'
import ProxyGroupNow from './ProxyGroupNow.vue'
import ProxyIcon from './ProxyIcon.vue'
import ProxyName from './ProxyName.vue'
import ProxyPreview from './ProxyPreview.vue'

const emit = defineEmits<{
  'selection-change': [groupName: string, nodeName: string]
  // 故障转移组:在上面一栏点了哪个页签(穿透的下一层就显示它的节点;不动内核的选择)
  'lane-change': [groupName: string, laneId: string]
}>()

const props = withDefaults(
  defineProps<{
    name: string
    level?: number
    rootGroupName?: string
    // 故障转移组:穿透里当前看的是哪个页签
    selectedLaneId?: string | null
  }>(),
  {
    level: 1,
    rootGroupName: '',
    selectedLaneId: null,
  },
)

const { t } = useI18n()
const proxyGroup = computed(() => proxyMap.value[props.name])
// 故障转移的内部子组显示成页签名 / 角色
const displayName = computed(() => failoverDisplayName(props.name))
const penetrationCollapseKey = computed(
  () => `penetration:${props.rootGroupName || props.name}:level-${props.level}`,
)
const showCollapse = computed({
  get() {
    return collapseGroupMap.value[penetrationCollapseKey.value] ?? false
  },
  set(value) {
    collapseGroupMap.value[penetrationCollapseKey.value] = value
  },
})
// 故障转移父组:成员是各页签的引用(单节点 = 节点,多节点 = 内部子组)加末尾的兜底拒绝;拒绝不是候选,不列。
// 折叠态的圆点按页签引用画;展开是上下两栏(页签栏 + 当前页签的节点),见 FailoverLaneCards / FailoverLaneDetail
const isFailover = computed(() => isFailoverGroup(props.name))
// 故障转移组在穿透里也叫「故障转移」,不因底层是 selector 就显示成手动组
const typeText = computed(() => (isFailover.value ? t('groupType_failover_short') : proxyGroup.value.type))
const allProxies = computed(() => failoverMembersOf(props.name, proxyGroup.value.all ?? []))
const { proxiesCount, renderProxies } = useRenderProxies(allProxies, props.name)
const isLatencyTesting = ref(false)

const handlerLatencyTest = async () => {
  if (isLatencyTesting.value) return

  isLatencyTesting.value = true
  try {
    await proxyGroupLatencyTest(props.name)
    isLatencyTesting.value = false
  } catch {
    isLatencyTesting.value = false
  }
}

const downloadTotal = computed(() => {
  return activeConnections.value
    .filter((conn) => conn.chains.includes(props.name))
    .reduce((total, conn) => total + conn.downloadSpeed, 0)
})

const hiddenGroup = computed({
  get: () => isHiddenGroup(props.name),
  set: (value: boolean) => {
    hiddenGroupMap.value[props.name] = value
  },
})

const handlerGroupToggle = () => {
  hiddenGroup.value = !hiddenGroup.value
}

const handleSelectionChange = (nodeName: string) => {
  emit('selection-change', props.name, nodeName)
}

const handlePreviewSelect = (nodeName: string) => {
  handleSelectionChange(nodeName)
  handlerProxySelect(props.name, nodeName)
}

const titleIconSize = computed(() => Math.max(proxyGroupIconSize.value, 46))

useBounceOnVisible()
</script>
