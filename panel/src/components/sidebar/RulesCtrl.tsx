import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { RULE_TAB_TYPE } from '@/constant'
import { showNotification } from '@/helper/notification'
import {
  applyRuleProviderCacheStats,
  cancelBackgroundRuleRefresh,
  fetchRuleProviderCacheStats,
  hasReferencedRuleProviders,
  isRuleCacheUpdating,
  isRuleRefreshRunning,
  ruleCacheRefreshCount,
  ruleProviderLocalCountMap,
  ruleRefreshState,
  rules,
  rulesFilter,
  rulesTabShow,
  startBackgroundRuleRefresh,
  visibleRuleProviderList,
} from '@/store/rules'
import {
  disconnectOnRuleDisable,
  displayLatencyInRule,
  displayNowNodeInRule,
} from '@/store/settings'
import { ArrowPathIcon, WrenchScrewdriverIcon } from '@heroicons/vue/24/outline'
import { computed, defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DialogWrapper from '../common/DialogWrapper.vue'
import TextInput from '../common/TextInput.vue'

export default defineComponent({
  name: 'RulesCtrl',
  setup() {
    const { t } = useI18n()
    const settingsModel = ref(false)
    const isRefreshingRules = ref(false)
    const { isLargeCtrlsBar } = useCtrlsBar()
    const showRuleTabs = computed(() => {
      return hasReferencedRuleProviders.value
    })
    const referencedProviderRefreshNames = computed(() => {
      return visibleRuleProviderList.value.map((provider) => provider.name)
    })
    const referencedRuleTotal = computed(() => {
      return visibleRuleProviderList.value.reduce((total, provider) => {
        const localCount = ruleProviderLocalCountMap.value[provider.name]

        return total + (typeof localCount === 'number' ? localCount : provider.ruleCount || 0)
      }, 0)
    })
    const providerCountDisplayText = computed(() => {
      if (isRuleRefreshRunning.value && ruleRefreshState.value.phase === 'provider') {
        return `${ruleRefreshState.value.updatedProviders}`
      }

      if (isRuleRefreshRunning.value && ruleRefreshState.value.totalProviders > 0) {
        return `${ruleRefreshState.value.totalProviders}`
      }

      return `${referencedProviderRefreshNames.value.length}`
    })
    const ruleCountDisplayText = computed(() => {
      if (isRuleRefreshRunning.value && ruleRefreshState.value.phase === 'cache') {
        return `${ruleCacheRefreshCount.value || 0}`
      }

      if (isRuleCacheUpdating.value) {
        return `${ruleCacheRefreshCount.value || 0}`
      }

      return `${referencedRuleTotal.value}`
    })
    const refreshSummaryText = computed(() => {
      return t('ruleRefreshSummary', {
        rules: ruleCountDisplayText.value,
        sources: providerCountDisplayText.value,
      })
    })

    const handlerClickUpgradeAllProviders = async () => {
      if (isRefreshingRules.value) return

      isRefreshingRules.value = true

      try {
        if (isRuleRefreshRunning.value || isRuleCacheUpdating.value) {
          const result = await cancelBackgroundRuleRefresh()
          applyRuleProviderCacheStats(result)
          showNotification({
            key: 'ruleRefreshCompletedTip',
            content: 'ruleRefreshStopped',
            type: 'alert-warning',
            timeout: 2000,
          })
          return
        }

        if (referencedProviderRefreshNames.value.length === 0) {
          showNotification({
            key: 'ruleRefreshNoReferencedProviders',
            content: 'noReferencedRuleProviders',
            type: 'alert-warning',
            timeout: 2000,
          })
          return
        }

        ruleCacheRefreshCount.value = 0
        const result = await startBackgroundRuleRefresh(
          '',
          referencedProviderRefreshNames.value,
          true,
        )
        applyRuleProviderCacheStats(result)
        const latestStats = await fetchRuleProviderCacheStats()
        applyRuleProviderCacheStats(latestStats)
      } catch (error) {
        showNotification({
          key: 'ruleRefreshCompletedTip',
          content: error instanceof Error ? error.message : String(error),
          type: 'alert-error',
          timeout: 3000,
        })
      } finally {
        isRefreshingRules.value = false
      }
    }

    const tabsWithNumbers = computed(() => {
      return Object.values(RULE_TAB_TYPE).map((type) => ({
        type,
        count:
          type === RULE_TAB_TYPE.RULES ? rules.value.length : visibleRuleProviderList.value.length,
      }))
    })

    return () => {
      const tabs = (
        <div
          role="tablist"
          class="tabs-box tabs tabs-xs"
        >
          {tabsWithNumbers.value.map(({ type, count }) => (
            <a
              role="tab"
              key={type}
              class={['tab', rulesTabShow.value === type && 'tab-active']}
              onClick={() => (rulesTabShow.value = type)}
            >
              {t(type)} ({count})
            </a>
          ))}
        </div>
      )

      const upgradeAllIcon = rulesTabShow.value === RULE_TAB_TYPE.PROVIDER && (
        <div class="flex shrink-0 items-center gap-2">
          <div class="text-base-content/70 flex items-center justify-end text-sm whitespace-nowrap tabular-nums">
            {refreshSummaryText.value}
          </div>
          <button
            class="btn btn-circle btn-sm"
            onClick={handlerClickUpgradeAllProviders}
          >
            <ArrowPathIcon
              class={[
                'h-4 w-4',
                (isRefreshingRules.value ||
                  isRuleRefreshRunning.value ||
                  isRuleCacheUpdating.value) &&
                  'animate-spin',
              ]}
            />
          </button>
        </div>
      )

      const searchInput = (
        <TextInput
          class={isLargeCtrlsBar.value ? 'w-80' : 'min-w-0 flex-1'}
          v-model={rulesFilter.value}
          placeholder={t('ruleSearchPlaceholder')}
          clearable={true}
        />
      )

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
            title={t('ruleSettings')}
          >
            <div class="flex flex-col gap-4 p-2 text-sm">
              <div class="flex items-center gap-2">
                {t('displaySelectedNode')}
                <input
                  class="toggle"
                  type="checkbox"
                  v-model={displayNowNodeInRule.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('displayLatencyNumber')}
                <input
                  class="toggle"
                  type="checkbox"
                  v-model={displayLatencyInRule.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('disconnectOnRuleDisable')}
                <input
                  class="toggle"
                  type="checkbox"
                  v-model={disconnectOnRuleDisable.value}
                />
              </div>
            </div>
          </DialogWrapper>
        </>
      )

      const content = !isLargeCtrlsBar.value ? (
        <div class="app-card-padding flex flex-col gap-2">
          {showRuleTabs.value && (
            <div class="flex min-w-0 items-center gap-2">
              {tabs}
              <div class="ml-auto flex shrink-0 items-center gap-2">
                {rulesTabShow.value === RULE_TAB_TYPE.PROVIDER && (
                  <button
                    class="btn btn-circle btn-sm"
                    onClick={handlerClickUpgradeAllProviders}
                  >
                    <ArrowPathIcon
                      class={[
                        'h-4 w-4',
                        (isRefreshingRules.value ||
                          isRuleRefreshRunning.value ||
                          isRuleCacheUpdating.value) &&
                          'animate-spin',
                      ]}
                    />
                  </button>
                )}
                {settingsModal}
              </div>
            </div>
          )}
          <div class="flex w-full min-w-0 items-center gap-2">
            {searchInput}
            <div class="ml-auto shrink-0">
              {rulesTabShow.value === RULE_TAB_TYPE.PROVIDER && (
                <div class="text-base-content/70 flex items-center justify-end text-sm whitespace-nowrap tabular-nums">
                  {refreshSummaryText.value}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div class="app-card-padding flex flex-wrap gap-2">
          {showRuleTabs.value && tabs}
          {searchInput}
          <div class="flex-1"></div>
          {upgradeAllIcon}
          {settingsModal}
        </div>
      )

      return <div class="ctrls-bar">{content}</div>
    }
  },
})
