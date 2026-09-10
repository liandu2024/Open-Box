<template>
  <div class="relative flex h-full min-h-0 flex-col overflow-hidden">
    <SettingsMenu
      :menu-items="tabItems"
      :active-menu-key="activeTab"
      @menu-click="handleTabClick"
    />

    <!-- 「面板设置」仍是一列堆叠的卡片,分组与顺序由 settingsMenuOrder 决定、可在
         齿轮里的可见性弹窗中调整——这部分和改版前一致,只是它们从"顶部页签各占一格"
         变成了同一个页签里的若干张卡片。 -->
    <div
      v-if="activeTab === SETTINGS_TAB.panel"
      ref="scrollContainerRef"
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
    >
      <div
        class="grid grid-cols-1 gap-2 p-2"
        :style="padding"
      >
        <div class="flex flex-col gap-2">
          <div
            v-for="item in panelSections"
            :key="item.key"
            :id="`item-${item.key}`"
            :data-key="item.key"
            class="card"
          >
            <component :is="item.component" />
          </div>
        </div>
      </div>
    </div>

    <!-- 其余三个页签直接装载原来的整页组件。它们各自带着自己的滚动容器与工具栏,
         塞进上面那种 .card 里会套出两层滚动条,所以这里让它们自己撑满剩余高度。 -->
    <div
      v-else
      class="min-h-0 flex-1 overflow-hidden"
    >
      <component
        :is="activeTabComponent"
        v-bind="activeTabProps"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import GeneralSettings from '@/components/settings/GeneralSettings.vue'
import ProxiesSettings from '@/components/settings/ProxiesSettings.vue'
import SettingsMenu from '@/components/settings/SettingsMenu.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { isSettingVisible } from '@/composables/settings'
import { SETTINGS_MENU_KEY, SETTINGS_TAB } from '@/constant'
import { settingsMenuOrder } from '@/store/settings'
import ClientRoutingPage from '@/views/ClientRoutingPage.vue'
import KernelPage from '@/views/KernelPage.vue'
import DnsPage from '@/views/DnsPage.vue'
import RoutingPage from '@/views/RoutingPage.vue'
import ShareNetworkPage from '@/views/ShareNetworkPage.vue'
import SubscriptionsPage from '@/views/SubscriptionsPage.vue'
import {
  CpuChipIcon,
  ServerStackIcon,
  DevicePhoneMobileIcon,
  HomeIcon,
  MapIcon,
  RectangleStackIcon,
  RssIcon,
  ShareIcon,
} from '@heroicons/vue/24/outline'
import { useStorage } from '@vueuse/core'
import type { Component } from 'vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})
const route = useRoute()

// 一级页签。订阅/分流/内核原本是侧边栏里的独立页面,现在收进设置页——它们都是
// 「配置 Open-Box 怎么跑」,和左边那些「看运行状况」的页面(代理/连接/日志/规则)
// 不是一回事,混在同一列导航里反而看不出主次。
// 订阅管理 / 节点管理 各是一个一级页签(同一个 SubscriptionsPage,靠 tab 属性切内容),
// 不再套一层「订阅与节点」再分子页签。
const tabItems: { key: SETTINGS_TAB; label: string; icon: Component }[] = [
  { key: SETTINGS_TAB.panel, label: 'zashboardSettings', icon: HomeIcon },
  { key: SETTINGS_TAB.subscriptions, label: 'subscriptionsManageTab', icon: RssIcon },
  { key: SETTINGS_TAB.groups, label: 'groupsTab', icon: RectangleStackIcon },
  { key: SETTINGS_TAB.routing, label: 'routingSettings', icon: MapIcon },
  { key: SETTINGS_TAB.clients, label: 'clientRoutingTab', icon: DevicePhoneMobileIcon },
  { key: SETTINGS_TAB.share, label: 'shareNetworkTab', icon: ShareIcon },
  { key: SETTINGS_TAB.dns, label: 'dnsSettingsTab', icon: ServerStackIcon },
  { key: SETTINGS_TAB.kernel, label: 'kernelSettings', icon: CpuChipIcon },
]

const TAB_COMPONENTS: Partial<Record<SETTINGS_TAB, Component>> = {
  [SETTINGS_TAB.subscriptions]: SubscriptionsPage,
  [SETTINGS_TAB.groups]: SubscriptionsPage,
  [SETTINGS_TAB.routing]: RoutingPage,
  [SETTINGS_TAB.clients]: ClientRoutingPage,
  [SETTINGS_TAB.kernel]: KernelPage,
  [SETTINGS_TAB.dns]: DnsPage,
  [SETTINGS_TAB.share]: ShareNetworkPage,
}

const activeTab = useStorage<SETTINGS_TAB>('cache/settings-active-tab', SETTINGS_TAB.panel)
const activeTabComponent = computed(() => TAB_COMPONENTS[activeTab.value])
const activeTabProps = computed(() => {
  if (activeTab.value === SETTINGS_TAB.subscriptions) return { tab: 'subs' }
  if (activeTab.value === SETTINGS_TAB.groups) return { tab: 'groups' }
  return {}
})

const scrollContainerRef = ref<HTMLDivElement>()

type PanelSection = {
  key: SETTINGS_MENU_KEY
  component: Component
}

const panelSections = computed<PanelSection[]>(() => {
  const itemsMap = new Map<SETTINGS_MENU_KEY, PanelSection>([
    [SETTINGS_MENU_KEY.general, { key: SETTINGS_MENU_KEY.general, component: GeneralSettings }],
    [SETTINGS_MENU_KEY.proxies, { key: SETTINGS_MENU_KEY.proxies, component: ProxiesSettings }],
  ])

  return settingsMenuOrder.value
    .map((key) => itemsMap.get(key))
    .filter((item): item is PanelSection => item !== undefined && isSettingVisible(item.key))
})

const handleTabClick = (key: string) => {
  activeTab.value = key as SETTINGS_TAB
}

// 滚到面板设置里的某一组。代理页/连接页的「设置」入口是带 ?scrollTo= 跳过来的
// (见 ProxiesCtrl / ConnectionCtrl),改版后那几组卡片不再各占一个页签,所以要先
// 切回面板设置页签,等卡片渲染出来再滚——否则元素还不在 DOM 里,滚了个寂寞。
const scrollToSection = async (key: SETTINGS_MENU_KEY) => {
  activeTab.value = SETTINGS_TAB.panel
  await nextTick()

  const element = document.getElementById(`item-${key}`)
  const container = scrollContainerRef.value
  if (!element || !container) return

  container.scrollTo({
    top: container.scrollTop + element.getBoundingClientRect().top -
      container.getBoundingClientRect().top - 8,
    behavior: 'smooth',
  })
}

// ?tab= 来自那三条重定向(老的 /subscriptions 等路径)和内核卡片里指向分流的链接;
// ?scrollTo= 来自代理页/连接页的设置入口。
const applyQuery = () => {
  const tab = route.query.tab as SETTINGS_TAB
  if (tab && tabItems.some((item) => item.key === tab)) {
    activeTab.value = tab
    return
  }

  const scrollTo = route.query.scrollTo as SETTINGS_MENU_KEY
  if (scrollTo) {
    scrollToSection(scrollTo)
  }
}

// 两处都要:onMounted 管"从别的页面跳进设置页"(首次挂载),watch 管"人已经在设置页
// 上、只是 query 变了"——后者不会重新挂载组件,只靠 onMounted 的话链接点了没反应。
onMounted(() => {
  requestAnimationFrame(applyQuery)
})
watch(() => route.query, applyQuery)
</script>
