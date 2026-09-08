import { nodeGroups, policyGroups, renderGroups } from '@/composables/proxies'
import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { PROXY_SORT_TYPE, PROXY_TAB_TYPE } from '@/constant'
import { getMinCardWidth } from '@/helper/utils'
import {
  openboxSubscriptions,
  refreshAllOpenboxSubscriptions,
} from '@/store/openboxSubscriptions'
import {
  proxyMap,
  allProxiesLatencyTest,
  fetchProxies,
  hasSmartGroup,
  proxiesFilter,
  proxiesTabShow,
} from '@/store/proxies'
import {
  collapseGroupMap,
  groupProxiesByProvider,
  minProxyCardWidth,
  providerProxyCategoryCollapseMap,
  proxyCardSize,
  proxyGroupColumns,
  proxySortType,
  useSmartGroupSort,
} from '@/store/settings'
import {
  ArrowPathIcon,
  BoltIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/vue/24/outline'
import { isEmpty } from 'lodash'
import { computed, defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DialogWrapper from '../common/DialogWrapper.vue'
import TextInput from '../common/TextInput.vue'
import PolicyDisplayOrder from '../proxies/PolicyDisplayOrder.vue'

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
        await fetchProxies()
      } finally {
        isUpgrading.value = false
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

    // 全局折叠/展开的目标 = 这一页签正在渲染的那些卡片,折叠键就是卡片名(CollapseCard 的 name)。
    // 「节点」页签渲染的是 nodeGroups(每个节点组一张卡片);fork 基线里这一支指向
    // penetration:<组名>:level-1——那是策略卡片里嵌套组的键,这一页没人读它,按钮点了没反应。
    const globalCollapseTargets = computed<GlobalCollapseTarget[]>(() => {
      const names =
        proxiesTabShow.value === PROXY_TAB_TYPE.NODE ? nodeGroups.value : renderGroups.value
      return names.map((name) => ({ type: 'group', key: name }))
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
          // 内核没数据时策略/节点都是 0:全局模式下 getCurrentProxyGroups 会凭空给一个
          // GLOBAL,内核根本没跑也会数出"策略 (1)",让人以为有东西只是没显示出来
          count:
            type === PROXY_TAB_TYPE.PROVIDER
              ? openboxSubscriptions.value.length
              : isEmpty(proxyMap.value)
                ? 0
                : type === PROXY_TAB_TYPE.POLICY
                  ? policyGroups.value.length
                  : nodeGroups.value.length,
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
            proxyGroupColumns.value > 1 &&
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
            boxClass="w-full max-w-2xl"
          >
            <div class="flex flex-col gap-4 p-2 text-sm">
              <div class="flex items-center gap-2">
                {t('proxyNodeSortBy')}
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
              {/* 策略的显示顺序(可拖)与命中顺序(只看)并排;弹窗开着时才渲染,免得每次
                  刷代理页都跟着重算 */}
              {settingsModel.value && (
                <>
                  <div class="divider my-0" />
                  <PolicyDisplayOrder />
                </>
              )}
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
