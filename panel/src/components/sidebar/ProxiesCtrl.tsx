import { disconnectByIdAPI, isSingBox } from '@/api'
import { nodeGroups, policyGroups, renderGroups } from '@/composables/proxies'
import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { PROXY_SORT_TYPE, PROXY_TAB_TYPE, ROUTE_NAME, SETTINGS_MENU_KEY } from '@/constant'
import {
  buildProxyCategoryGroups,
  getProxyCategoryCollapseKey,
  isProxyCategoryEnabled,
} from '@/helper/proxyCategory'
import { getMinCardWidth } from '@/helper/utils'
import { configs, updateConfigs } from '@/store/config'
import {
  openboxSubscriptions,
  refreshAllOpenboxSubscriptions,
} from '@/store/openboxSubscriptions'
import { routingPendingDeploy } from '@/store/routing'
import { activeConnections } from '@/store/connections'
import {
  allProxiesLatencyTest,
  fetchProxies,
  hasSmartGroup,
  proxiesFilter,
  proxiesTabShow,
  proxyProviederList,
} from '@/store/proxies'
import {
  automaticDisconnection,
  collapseGroupMap,
  displayFinalOutbound,
  groupProxiesByProvider,
  hideUnavailableProxies,
  manageHiddenGroup,
  minProxyCardWidth,
  providerProxyCategoryCollapseMap,
  providerProxyCategoryEnabledMap,
  providerProxyCategoryFeatureEnabled,
  providerProxyCategoryWildcardMap,
  proxyCardSize,
  proxySortType,
  twoColumnProxyGroup,
  useSmartGroupSort,
} from '@/store/settings'
import {
  ArrowPathIcon,
  BoltIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/vue/24/outline'
import { every } from 'lodash'
import { computed, defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import DialogWrapper from '../common/DialogWrapper.vue'
import TextInput from '../common/TextInput.vue'

export default defineComponent({
  name: 'ProxiesCtrl',
  setup() {
    type GlobalCollapseTarget =
      | {
          type: 'group'
          key: string
        }
      | {
          type: 'provider-category'
          key: string
        }

    const { t } = useI18n()
    const router = useRouter()
    const isUpgrading = ref(false)
    const isAllLatencyTesting = ref(false)
    const settingsModel = ref(false)
    const { isLargeCtrlsBar } = useCtrlsBar()

    // 订阅标签下的「全部刷新」现在刷的是 Open-Box 订阅,不再是 Clash provider——
    // Open-Box 从不生成 provider,原来那个按钮点了永远是空转。
    const handlerClickUpdateAllProviders = async () => {
      if (isUpgrading.value) return
      isUpgrading.value = true
      try {
        await refreshAllOpenboxSubscriptions()
        // 刷新可能换掉节点,和在订阅设置页刷新一样要提示需要重新部署
        routingPendingDeploy.value = true
        await fetchProxies()
      } finally {
        isUpgrading.value = false
      }
    }

    const defaultModes = ['direct', 'rule', 'global']
    const modeList = computed(() => {
      return configs.value?.['mode-list'] || configs.value?.['modes'] || defaultModes
    })
    const needTranslateModes = computed(() => {
      return every(modeList.value, (mode) => defaultModes.includes(mode.toLowerCase()))
    })

    const handlerModeChange = (e: Event) => {
      const mode = (e.target as HTMLSelectElement).value
      updateConfigs({ mode })
      if (isSingBox.value && automaticDisconnection.value) {
        activeConnections.value.forEach((connection) => {
          if (connection.rule.includes('clash_mode')) {
            disconnectByIdAPI(connection.id)
          }
        })
      }
    }

    const handlerClickLatencyTestAll = async () => {
      if (isAllLatencyTesting.value) return
      isAllLatencyTesting.value = true
      try {
        await allProxiesLatencyTest()
        isAllLatencyTesting.value = false
      } catch {
        isAllLatencyTesting.value = false
      }
    }

    const globalCollapseTargets = computed<GlobalCollapseTarget[]>(() => {
      if (proxiesTabShow.value === PROXY_TAB_TYPE.NODE) {
        return renderGroups.value.map((name) => ({
          type: 'group',
          key: `penetration:${name}:level-1`,
        }))
      }

      if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER) {
        const targets: GlobalCollapseTarget[] = []

        renderGroups.value.forEach((providerName) => {
          const provider = proxyProviederList.value.find((item) => item.name === providerName)

          if (!provider) {
            return
          }

          const providerAllProxies = provider.proxies.map((node) => node.name)
          const wildcard = providerProxyCategoryWildcardMap.value[providerName] ?? ''
          const categoryEnabled =
            providerProxyCategoryFeatureEnabled.value &&
            isProxyCategoryEnabled(
              providerAllProxies,
              wildcard,
              providerProxyCategoryEnabledMap.value[providerName] ?? false,
            )

          if (!categoryEnabled) {
            targets.push({
              type: 'group',
              key: providerName,
            })
            return
          }

          buildProxyCategoryGroups(
            providerAllProxies,
            wildcard,
            t('other'),
            providerAllProxies,
          ).forEach(({ name: categoryName }) => {
            targets.push({
              type: 'provider-category',
              key: getProxyCategoryCollapseKey(providerName, categoryName),
            })
          })
        })

        return targets
      }

      return renderGroups.value.map((name) => ({
        type: 'group',
        key: name,
      }))
    })

    const hasExpandedTargets = computed(() => {
      return globalCollapseTargets.value.some((target) => {
        if (target.type === 'provider-category') {
          return !providerProxyCategoryCollapseMap.value[target.key]
        }

        return Boolean(collapseGroupMap.value[target.key])
      })
    })

    const handlerClickToggleCollapse = () => {
      const nextCollapseGroupMap = { ...collapseGroupMap.value }
      const nextProviderProxyCategoryCollapseMap = {
        ...providerProxyCategoryCollapseMap.value,
      }

      globalCollapseTargets.value.forEach((target) => {
        if (target.type === 'provider-category') {
          nextProviderProxyCategoryCollapseMap[target.key] = hasExpandedTargets.value
          return
        }

        nextCollapseGroupMap[target.key] = !hasExpandedTargets.value
      })

      collapseGroupMap.value = nextCollapseGroupMap
      providerProxyCategoryCollapseMap.value = nextProviderProxyCategoryCollapseMap
    }

    const handlerResetProxyCardWidth = () => {
      minProxyCardWidth.value = getMinCardWidth(proxyCardSize.value)
    }

    const tabsWithNumbers = computed(() => {
      return Object.values(PROXY_TAB_TYPE).map((type) => {
        return {
          type,
          count:
            type === PROXY_TAB_TYPE.POLICY
              ? policyGroups.value.length
              : type === PROXY_TAB_TYPE.NODE
                ? nodeGroups.value.length
                : openboxSubscriptions.value.length,
        }
      })
    })

    return () => {
      const isProviderTab = proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER
      const moveRefreshToSecondRow = !isLargeCtrlsBar.value && isProviderTab

      const tabs = (
        <div
          role="tablist"
          class="proxy-main-tabs tabs-box tabs tabs-xs"
        >
          {tabsWithNumbers.value.map(({ type, count }) => {
            const label = t(type)

            return (
              <a
                role="tab"
                key={type}
                class={['tab', proxiesTabShow.value === type && 'tab-active']}
                onClick={() => (proxiesTabShow.value = type)}
              >
                {label} ({count})
              </a>
            )
          })}
        </div>
      )

      const upgradeAllIcon = proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER && (
        <button
          class="btn btn-circle btn-sm"
          onClick={handlerClickUpdateAllProviders}
        >
          <ArrowPathIcon class={['h-4 w-4', isUpgrading.value && 'animate-spin']} />
        </button>
      )

      const modeSelect = proxiesTabShow.value === PROXY_TAB_TYPE.POLICY && configs.value && (
        <select
          class={[
            'select select-sm shrink-0',
            isLargeCtrlsBar.value ? 'min-w-40' : 'w-20 min-w-20',
          ]}
          v-model={configs.value.mode}
          onChange={handlerModeChange}
        >
          {modeList.value.map((mode) => {
            return (
              <option
                key={mode}
                value={mode}
              >
                {needTranslateModes.value ? t(mode.toLowerCase()) : mode}
              </option>
            )
          })}
        </select>
      )

      const sort = (
        <select
          class={['select select-sm']}
          v-model={proxySortType.value}
        >
          {Object.values(PROXY_SORT_TYPE).map((type) => {
            return (
              <option
                key={type}
                value={type}
              >
                {t(type)}
              </option>
            )
          })}
        </select>
      )

      const latencyTestAll = (
        <button
          class="btn btn-circle btn-sm"
          onClick={handlerClickLatencyTestAll}
        >
          {isAllLatencyTesting.value ? (
            <span class="loading loading-spinner loading-sm"></span>
          ) : (
            <BoltIcon class="h-4 w-4" />
          )}
        </button>
      )

      const toggleCollapseAll = (
        <button
          class={[
            'btn btn-circle btn-sm',
            twoColumnProxyGroup.value &&
              proxiesTabShow.value !== PROXY_TAB_TYPE.PROVIDER &&
              'max-sm:hidden',
          ]}
          onClick={handlerClickToggleCollapse}
        >
          {hasExpandedTargets.value ? (
            <ChevronUpIcon class="h-4 w-4" />
          ) : (
            <ChevronDownIcon class="h-4 w-4" />
          )}
        </button>
      )

      const searchInput = (
        <TextInput
          class={[
            isLargeCtrlsBar.value
              ? 'w-32 max-w-80 flex-1'
              : moveRefreshToSecondRow
                ? 'w-full'
                : 'w-32 flex-1',
          ]}
          v-model={proxiesFilter.value}
          placeholder={`${t('search')} | ${t('searchMultiple')}`}
          clearable={true}
        />
      )

      const searchSection = <div class={['flex min-w-0 flex-1 items-center']}>{searchInput}</div>

      const settingsModal = (
        <>
          <button
            class="btn btn-circle btn-sm"
            onClick={() => (settingsModel.value = true)}
          >
            <WrenchScrewdriverIcon class="h-4 w-4" />
          </button>
          <DialogWrapper
            v-model={settingsModel.value}
            title={t('proxySettings')}
          >
            <div class="flex flex-col gap-4 p-2 text-sm">
              <div class="flex items-center gap-2">
                {t('sortBy')}
                {sort}
              </div>
              {hasSmartGroup.value && (
                <div class="flex items-center gap-2">
                  {t('useSmartGroupSort')}
                  <input
                    class="toggle"
                    type="checkbox"
                    v-model={useSmartGroupSort.value}
                  />
                </div>
              )}
              <div class="flex items-center gap-2">
                {t('groupProxiesByProvider')}
                <input
                  type="checkbox"
                  class="toggle"
                  v-model={groupProxiesByProvider.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('unavailableProxy')}
                <input
                  type="checkbox"
                  class="toggle"
                  v-model={hideUnavailableProxies.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('manageHiddenGroup')}
                <input
                  class="toggle"
                  type="checkbox"
                  v-model={manageHiddenGroup.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('automaticDisconnection')}
                <input
                  class="toggle"
                  type="checkbox"
                  v-model={automaticDisconnection.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('displayFinalOutbound')}
                <input
                  class="toggle"
                  type="checkbox"
                  v-model={displayFinalOutbound.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('minProxyCardWidth')}
                <div class="join">
                  <input
                    class="input input-sm join-item w-20"
                    type="number"
                    v-model={minProxyCardWidth.value}
                  />
                  <button
                    class="btn join-item btn-sm"
                    onClick={handlerResetProxyCardWidth}
                  >
                    {t('reset')}
                  </button>
                </div>
              </div>
              <div class="divider m-0"></div>
              <button
                class="btn btn-block"
                onClick={() => {
                  settingsModel.value = false
                  router.push({
                    name: ROUTE_NAME.settings,
                    query: { scrollTo: SETTINGS_MENU_KEY.proxies },
                  })
                }}
              >
                {t('moreSettings')}
              </button>
            </div>
          </DialogWrapper>
        </>
      )

      const content = !isLargeCtrlsBar.value ? (
        <div class="app-card-padding flex flex-col gap-2">
          <div class="flex gap-2">
            {tabs}
            {!moveRefreshToSecondRow && upgradeAllIcon}
          </div>
          <div class="flex w-full gap-2">
            {modeSelect}
            {searchSection}
            <div class="ml-auto flex shrink-0 items-center gap-2">
              {moveRefreshToSecondRow && upgradeAllIcon}
              {settingsModal}
              {toggleCollapseAll}
              {latencyTestAll}
            </div>
          </div>
        </div>
      ) : (
        <div class="app-card-padding flex gap-2">
          {tabs}
          {modeSelect}
          {searchSection}
          {upgradeAllIcon}
          {settingsModal}
          {toggleCollapseAll}
          {latencyTestAll}
        </div>
      )

      return <div class="ctrls-bar">{content}</div>
    }
  },
})
