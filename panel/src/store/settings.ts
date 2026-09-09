import {
  CONNECTIONS_TABLE_ACCESSOR_KEY,
  DETAILED_CARD_STYLE,
  EMOJIS,
  FONTS,
  GLOBAL,
  IP_INFO_API,
  IS_APPLE_DEVICE,
  LANG,
  OVERVIEW_CARD,
  PROXY_CARD_SIZE,
  PROXY_CHAIN_DIRECTION,
  PROXY_PREVIEW_TYPE,
  PROXY_SORT_TYPE,
  SETTINGS_MENU_KEY,
  TABLE_SIZE,
  TABLE_WIDTH_MODE,
  DIRECT_TEST_URL, TEST_URL,
} from '@/constant'
import { detectDefaultLanguage, getMinCardWidth, isMiddleScreen, isPreferredDark } from '@/helper/utils'
import type { SourceIPLabel } from '@/types'
import { useStorage } from '@vueuse/core'
import { computed } from 'vue'

// global
// 主题只有三档:跟随系统 / 亮色 / 暗色。亮色 = daisyUI 的 emerald,暗色 = forest;
// 不再有主题列表和自定义主题。默认亮色。
export type ThemeMode = 'system' | 'light' | 'dark'
export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']
export const LIGHT_THEME = 'emerald'
export const DARK_THEME = 'forest'
export const themeMode = useStorage<ThemeMode>('config/theme-mode', 'light')
export const theme = computed(() => {
  if (themeMode.value === 'dark') return DARK_THEME
  if (themeMode.value === 'system' && isPreferredDark.value) return DARK_THEME
  return LIGHT_THEME
})

export const language = useStorage<LANG>('config/language', detectDefaultLanguage(navigator.language))
// 首次进面板侧边栏默认展开(窄屏仍强制折叠,见下方 isMiddleScreen)
export const isSidebarCollapsedConfig = useStorage('config/is-sidebar-collapsed', false)
// 概览「每日流量」的「统计直连流量」开关:关掉后走内置直连出站的流量不计入(服务端查询时扣掉,库里数据不动)
export const trafficCountDirect = useStorage('config/traffic-count-direct', true)
export const isSidebarCollapsed = computed({
  get: () => {
    if (isMiddleScreen.value) {
      return true
    }

    return isSidebarCollapsedConfig.value
  },
  set: (value) => {
    isSidebarCollapsedConfig.value = value
  },
})
const fontConfig = useStorage<FONTS>('config/font', FONTS.MI_SANS)
export const font = computed({
  get: () => {
    const mode = import.meta.env.MODE
    if (Object.values(FONTS).includes(mode as FONTS)) {
      return mode as FONTS
    }
    return fontConfig.value
  },
  set: (val) => {
    fontConfig.value = val
  },
})
export const emoji = useStorage<EMOJIS>(
  'config/emoji',
  IS_APPLE_DEVICE ? EMOJIS.TWEMOJI : EMOJIS.NOTO_COLOR_EMOJI,
)
export const customBackgroundURL = useStorage('config/custom-background-image', '')
export const dashboardTransparent = useStorage('config/dashboard-transparent', 90)
export const globalRadius = useStorage('config/global-radius', 16)
export const autoUpgrade = useStorage('config/auto-upgrade', false)
export const checkUpgradeCore = useStorage('config/check-upgrade-core', true)
export const autoUpgradeCore = useStorage('config/auto-upgrade-core', false)
export const swipeInPages = useStorage('config/swipe-in-pages', true)
export const swipeInTabs = useStorage('config/swipe-in-tabs', false)
export const disablePullToRefresh = useStorage('config/disable-pull-to-refresh', true)
export const displayAllFeatures = useStorage('config/display-all-features', false)
export const blurIntensity = useStorage('config/blur-intensity', 10)
export const scrollAnimationEffect = useStorage('config/scroll-animation-effect', true)
export const IPInfoAPI = useStorage('config/geoip-info-api', IP_INFO_API.IPSB)
export const autoDisconnectIdleUDP = useStorage('config/auto-disconnect-idle-udp', false)
export const autoDisconnectIdleUDPTime = useStorage('config/auto-disconnect-idle-udp-time', 300)

// overview
export const splitOverviewPage = useStorage('config/split-overview-page', false)
export const autoIPCheck = useStorage('config/auto-ip-check', true)
export const autoConnectionCheck = useStorage('config/auto-connection-check', true)
const defaultOverviewCardOrder: { card: OVERVIEW_CARD; visible: boolean }[] = [
  {
    card: OVERVIEW_CARD.ChartsCard,
    visible: true,
  },
  {
    card: OVERVIEW_CARD.NetworkCard,
    visible: true,
  },
  {
    card: OVERVIEW_CARD.ProviderTrafficOverview,
    visible: true,
  },
  {
    card: OVERVIEW_CARD.TopologyCharts,
    visible: true,
  },
  {
    card: OVERVIEW_CARD.ConnectionHistory,
    visible: true,
  },
  {
    card: OVERVIEW_CARD.RuleHitCountCard,
    visible: true,
  },
]

export const overviewCardOrder = useStorage<{ card: OVERVIEW_CARD; visible: boolean }[]>(
  'config/overview-card-order',
  defaultOverviewCardOrder,
)

// 确保所有卡片都在配置中，缺失的卡片添加到末尾
const allCardTypes = Object.values(OVERVIEW_CARD)
const existingCardTypes = new Set(overviewCardOrder.value.map((item) => item.card))
const missingCards = allCardTypes.filter((card) => !existingCardTypes.has(card))

if (missingCards.length > 0) {
  const newCards = missingCards.map((card) => ({
    card,
    visible: true,
  }))
  overviewCardOrder.value = [...overviewCardOrder.value, ...newCards]
}

// proxies
export const collapseGroupMap = useStorage<Record<string, boolean>>('config/collapse-group-map', {})
// 代理组分几列(1 / 2 / 3,GitHub #10:策略组多了单列要翻很久)。老设置 config/two-columns 是个
// 开关,第一次读到时按它换算,老用户的布局不会突然变
const legacyTwoColumnProxyGroup = useStorage('config/two-columns', true)
export const proxyGroupColumns = useStorage<number>(
  'config/proxy-group-columns',
  legacyTwoColumnProxyGroup.value ? 2 : 1,
)
export const speedtestUrl = useStorage<string>('config/speedtest-url', TEST_URL)
// 内置直连出站用的测速地址(见 constant/index.ts 的说明)
export const directTestUrl = useStorage<string>('config/direct-test-url', DIRECT_TEST_URL)
export const independentLatencyTest = useStorage('config/independent-latency-test', false)
export const speedtestTimeout = useStorage<number>('config/speedtest-timeout', 5000)
export const proxySortType = useStorage<PROXY_SORT_TYPE>(
  'config/proxy-sort-type',
  PROXY_SORT_TYPE.DEFAULT,
)
export const automaticDisconnection = useStorage('config/automatic-disconnection', true)
export const truncateProxyName = useStorage('config/truncate-proxy-name', true)
export const proxyPreviewType = useStorage('config/proxy-preview-type', PROXY_PREVIEW_TYPE.AUTO)
export const hideUnavailableProxies = useStorage('config/hide-unavailable-proxies', false)
export const lowLatency = useStorage('config/low-latency', 400)
export const mediumLatency = useStorage('config/medium-latency', 800)
export const IPv6test = useStorage('config/ipv6-test', false)
export const proxyCardSize = useStorage<PROXY_CARD_SIZE>(
  'config/proxy-card-size',
  PROXY_CARD_SIZE.LARGE,
)
export const minProxyCardWidth = useStorage<number>(
  'config/min-proxy-card-width',
  getMinCardWidth(proxyCardSize.value),
)
export const manageHiddenGroup = useStorage('config/manage-hidden-group-mode', false)

export const displayGlobalByMode = useStorage('config/display-global-by-mode', false)
export const customGlobalNode = useStorage('config/custom-global-node-name', GLOBAL)

export const proxyGroupIconSize = useStorage('config/proxy-group-icon-size', 24)
export const proxyGroupIconMargin = useStorage('config/proxy-group-icon-margin', 6)
export const useLargeProxyGroupIcon = useStorage('config/use-large-proxy-group-icon', false)
export const iconReflectList = useStorage<
  {
    icon: string
    name: string
    uuid: string
  }[]
>('config/icon-reflect-list', [])
export const groupProxiesByProvider = useStorage('config/group-proxies-by-provider', false)
export const useSmartGroupSort = useStorage('config/use-smart-group-sort', false)
export const providerProxyCategoryFeatureEnabled = useStorage(
  'config/provider-proxy-category-feature-enabled',
  true,
)
export const providerProxyCategoryWildcard = useStorage(
  'config/provider-proxy-category-wildcard',
  '',
)
export const providerProxyCategoryEnabled = useStorage(
  'config/provider-proxy-category-enabled',
  false,
)
export const providerProxyCategoryWildcardMap = useStorage<Record<string, string>>(
  'config/provider-proxy-category-wildcard-map',
  {},
)
export const providerProxyCategoryEnabledMap = useStorage<Record<string, boolean>>(
  'config/provider-proxy-category-enabled-map',
  {},
)
export const providerProxyCategoryCollapseMap = useStorage<Record<string, boolean>>(
  'config/provider-proxy-category-collapse-map',
  {},
)
export const providerProxyCategoryControlsCollapsedMap = useStorage<Record<string, boolean>>(
  'config/provider-proxy-category-controls-collapsed-map',
  {},
)
export const providerProxyCategoryOrderMap = useStorage<Record<string, string[]>>(
  'config/provider-proxy-category-order-map',
  {},
)
export const groupTestUrls = useStorage<
  {
    name: string
    url: string
    uuid: string
  }[]
>('config/group-test-urls', [])

// connections
export const useConnectionCard = useStorage('config/use-connecticon-card', window.innerWidth < 640)
export const proxyChainDirection = useStorage(
  'config/proxy-chain-direction',
  PROXY_CHAIN_DIRECTION.NORMAL,
)
export const tableSize = useStorage<TABLE_SIZE>('config/connecticon-table-size', TABLE_SIZE.SMALL)
export const tableWidthMode = useStorage('config/table-width-mode', TABLE_WIDTH_MODE.AUTO)
// 默认表头照正式路由器上用顺手的那套:关闭、源 IP、代理链、主机、进站 / 出站速率、进站 / 出站、连接时间
// (server/defaults/storage-defaults.json 里全新安装的初始值要和这里一致)
export const connectionTableColumns = useStorage<CONNECTIONS_TABLE_ACCESSOR_KEY[]>(
  'config/connection-table-columns',
  [
    CONNECTIONS_TABLE_ACCESSOR_KEY.Close,
    CONNECTIONS_TABLE_ACCESSOR_KEY.SourceIP,
    CONNECTIONS_TABLE_ACCESSOR_KEY.Chains,
    CONNECTIONS_TABLE_ACCESSOR_KEY.Host,
    CONNECTIONS_TABLE_ACCESSOR_KEY.DlSpeed,
    CONNECTIONS_TABLE_ACCESSOR_KEY.UlSpeed,
    CONNECTIONS_TABLE_ACCESSOR_KEY.Download,
    CONNECTIONS_TABLE_ACCESSOR_KEY.Upload,
    CONNECTIONS_TABLE_ACCESSOR_KEY.ConnectTime,
  ],
)
export const connectionCardLines = useStorage<CONNECTIONS_TABLE_ACCESSOR_KEY[][]>(
  'config/connection-card-lines',
  DETAILED_CARD_STYLE,
)

export const sourceIPLabelList = useStorage<SourceIPLabel[]>('config/source-ip-label-list', [])

// rules

// logs
export const logSearchHistory = useStorage<string[]>('config/log-search-history', [])

// settings visibility
// 使用扁平结构，key 格式为 "大设置项.小设置项" 或 "大设置项"（仅大设置项）
// 默认所有项都可见，只有隐藏的项才会记录在此对象中
export const hiddenSettingsItems = useStorage<Record<string, boolean>>(
  'config/hidden-settings-items',
  {},
)

// settings menu order
// 存储设置菜单项的顺序
export const settingsMenuOrder = useStorage<SETTINGS_MENU_KEY[]>('config/settings-menu-order', [
  SETTINGS_MENU_KEY.general,
  SETTINGS_MENU_KEY.overview,
  SETTINGS_MENU_KEY.backend,
  SETTINGS_MENU_KEY.proxies,
  SETTINGS_MENU_KEY.connections,
])
