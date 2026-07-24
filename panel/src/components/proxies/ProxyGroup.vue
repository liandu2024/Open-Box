<template>
  <CollapseCard
    :name="proxyGroup.name"
    :content-scrollable="false"
    @contextmenu.prevent.stop="handlerLatencyTest"
  >
    <template v-slot:title>
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
            :margin="0"
          />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex min-w-0 items-center gap-1">
            <div class="flex min-w-0 flex-1 items-center gap-1">
              <span class="shrink-0 text-base">
                {{ name }}
              </span>
              <button
                type="button"
                :class="[
                  'btn btn-sm bg-base-200 border-base-200 text-base-content/80 hover:text-base-content h-6 min-h-6 shrink-0 cursor-pointer px-2 text-xs font-medium shadow-none',
                  domainPenetrationHoverClass,
                ]"
                @click.stop="openRulePenetrationDialog"
              >
                {{ t('domainPenetration') }}
              </button>
              <span class="text-base-content/60 min-w-0 truncate text-xs">
                {{ proxyGroup.type }}
              </span>
            </div>
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
          <div class="text-base-content/80 flex w-full items-center pt-0.5 pb-1.5">
            <div class="min-w-0 flex-1 pr-3 text-sm">
              <ProxyGroupNow :name="name" />
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
          <div class="flex shrink-0 items-center">
            <ProxyIcon
              v-if="proxyGroup.icon"
              :icon="proxyGroup.icon"
              :size="proxyGroupIconSize"
              :margin="proxyGroupIconMargin"
            />
            <span class="">
              {{ name }}
            </span>
          </div>
          <button
            type="button"
            :class="[
              'btn btn-sm bg-base-200 border-base-200 text-base-content/80 hover:text-base-content h-6 min-h-6 shrink-0 cursor-pointer px-2 text-xs font-medium shadow-none',
              domainPenetrationHoverClass,
            ]"
            @click.stop="openRulePenetrationDialog"
          >
            {{ t('domainPenetration') }}
          </button>
          <span class="text-base-content/60 text-xs">
            {{ proxyGroup.type }}
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
        class="text-base-content/80 mt-1.5 mb-1 flex items-start gap-2"
      >
        <div class="min-w-0 flex-1 text-sm">
          <ProxyGroupNow :name="name" />
        </div>
        <div class="min-w-12 shrink-0 text-right text-xs">
          {{ prettyBytesHelper(downloadTotal) }}/s
        </div>
      </div>
    </template>
    <template v-slot:preview>
      <div
        v-if="isWindowResizing"
        class="bg-base-content/10 mt-2 h-4 rounded-full"
      />
      <ProxiesByProvider
        v-else-if="groupProxiesByProvider"
        :name="name"
        :now="proxyGroup.now"
        :render-proxies="renderProxies"
        :preview-only="true"
        @select="handlerProxySelect(name, $event)"
      />
      <ProxyPreview
        v-else
        :nodes="renderProxies"
        :now="proxyGroup.now"
        :group-name="proxyGroup.name"
        :relaxed-dots-spacing="true"
        @nodeclick="handlerProxySelect(name, $event)"
      />
    </template>
    <template v-slot:content>
      <div class="flex flex-col gap-0">
        <Component
          :is="groupProxiesByProvider ? ProxiesByProvider : ProxiesContent"
          :name="name"
          :now="proxyGroup.now"
          :render-proxies="renderProxies"
          :render-all="true"
        />
        <ProxyPenetrationSection :group-name="name" />
      </div>
    </template>
  </CollapseCard>
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
import { openProxyGroupRulePenetrationDialog } from '@/store/proxyGroupRulePenetration'
import {
  groupProxiesByProvider,
  manageHiddenGroup,
  proxyGroupIconMargin,
  proxyGroupIconSize,
  theme,
  useLargeProxyGroupIcon,
} from '@/store/settings'
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline'
import { twMerge } from 'tailwind-merge'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CollapseCard from '../common/CollapseCard.vue'
import LatencyTag from './LatencyTag.vue'
import ProxiesByProvider from './ProxiesByProvider.vue'
import ProxiesContent from './ProxiesContent.vue'
import ProxyGroupNow from './ProxyGroupNow.vue'
import ProxyIcon from './ProxyIcon.vue'
import ProxyPenetrationSection from './ProxyPenetrationSection.vue'
import ProxyPreview from './ProxyPreview.vue'

const props = defineProps<{
  name: string
}>()
const { t } = useI18n()
const proxyGroup = computed(() => proxyMap.value[props.name])
const allProxies = computed(() => proxyGroup.value.all ?? [])
const { renderProxies } = useRenderProxies(allProxies, props.name)
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
  const speed = activeConnections.value
    .filter((conn) => conn.chains.includes(props.name))
    .reduce((total, conn) => total + conn.downloadSpeed, 0)

  return speed
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

const openRulePenetrationDialog = () => {
  openProxyGroupRulePenetrationDialog(props.name)
}

const titleIconSize = computed(() => Math.max(proxyGroupIconSize.value, 46))
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
const domainPenetrationHoverClass = computed(() => {
  return DARK_HOVER_THEMES.has(theme.value)
    ? 'hover:!bg-[#4b4428] hover:!border-base-content/[0.16]'
    : 'hover:!bg-[#f1ead6] hover:!border-base-content/[0.16]'
})

useBounceOnVisible()
</script>
