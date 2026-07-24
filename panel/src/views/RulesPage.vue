<template>
  <div class="relative flex size-full min-h-0 flex-col overflow-hidden">
    <RulesCtrl />
    <template v-if="!isVirtualScroller">
      <div
        class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        :style="padding"
      >
        <div class="flex flex-col gap-3 p-3">
          <template
            v-if="
              (rulesTabShow === RULE_TAB_TYPE.RULES || rulesTabShow === RULE_TAB_TYPE.PROVIDER) &&
              isRuleLookupQuery
            "
          >
            <div
              v-if="isRuleLookupLoading"
              class="card app-card-padding text-sm"
            >
              {{ t('ruleLookupLoading') }}
            </div>
            <div
              v-else-if="ruleLookupError"
              class="card app-card-padding text-sm"
            >
              {{ ruleLookupError }}
            </div>
            <template v-else>
              <div
                v-if="ruleLookupResults.length === 0 && ruleLookupDirectRules.length === 0"
                class="card app-card-padding text-sm"
              >
                <div>{{ t('ruleLookupEmpty') }}</div>
                <div
                  v-if="ruleLookupUnsupported.length > 0"
                  class="text-base-content/70 mt-1 text-xs"
                >
                  {{ t('ruleLookupUnsupportedHint', { count: ruleLookupUnsupported.length }) }}
                </div>
              </div>
              <div
                v-else
                class="card app-card-padding text-sm"
              >
                {{ t('ruleLookupTopMatches') }}
              </div>
              <RuleFallbackCard
                v-if="
                  ruleLookupResults.length === 0 &&
                  ruleLookupDirectRules.length === 0 &&
                  ruleLookupFallbackRule
                "
                :rule="ruleLookupFallbackRule"
              />
              <RuleCard
                v-for="rule in ruleLookupDirectRules"
                :key="`lookup-direct-${rule.index}-${rule.type}-${rule.payload}`"
                :rule="rule"
                :index="rule.index + 1"
              />
              <RuleLookupCard
                v-for="(result, index) in ruleLookupResults"
                :key="result.providerName"
                :result="result"
                :index="index + 1"
              />
              <div
                v-if="ruleLookupUnsupported.length > 0"
                class="card app-card-padding text-xs"
              >
                {{ t('ruleLookupUnsupportedProviders') }}
                {{ ruleLookupUnsupported.map((item) => item.name).join('、') }}
              </div>
            </template>
          </template>
          <template v-else-if="rulesTabShow === RULE_TAB_TYPE.PROVIDER">
            <RuleProvider
              v-for="(ruleProvider, index) in renderRulesProvider"
              :key="ruleProvider.name"
              :ruleProvider="ruleProvider"
              :index="index + 1"
            />
          </template>
          <template v-else>
            <RuleCard
              v-for="rule in renderRules"
              :key="`${rule.type}-${rule.payload}-${rule.proxy}`"
              :rule="rule"
              :index="rules.indexOf(rule) + 1"
            />
          </template>
        </div>
      </div>
    </template>
    <VirtualScroller
      v-else
      class="min-h-0 flex-1"
      :style="virtualScrollerStyle"
      :data="renderRules"
      :size="84"
    >
      <template #default="{ item: rule }: { item: Rule }">
        <RuleCard
          :key="`${rule.type}-${rule.payload}-${rule.proxy}`"
          :rule="rule"
          :index="rules.indexOf(rule) + 1"
        />
      </template>
    </VirtualScroller>
    <ProxyGroupRulePenetrationDialog />
  </div>
</template>

<script setup lang="ts">
import VirtualScroller from '@/components/common/VirtualScroller.vue'
import ProxyGroupRulePenetrationDialog from '@/components/proxies/ProxyGroupRulePenetrationDialog.vue'
import RuleCard from '@/components/rules/RuleCard.vue'
import RuleFallbackCard from '@/components/rules/RuleFallbackCard.vue'
import RuleLookupCard from '@/components/rules/RuleLookupCard.vue'
import RuleProvider from '@/components/rules/RuleProvider.vue'
import RulesCtrl from '@/components/sidebar/RulesCtrl.tsx'
import { usePaddingForViews } from '@/composables/paddingViews'
import { RULE_TAB_TYPE } from '@/constant'
import { showNotification } from '@/helper/notification'
import { fetchProxies } from '@/store/proxies'
import {
  applyRuleProviderCacheStats,
  fetchRuleProviderCacheStats,
  fetchRules,
  hasReferencedRuleProviders,
  isRuleCacheUpdating,
  isRuleLookupLoading,
  isRuleLookupQuery,
  isRuleRefreshRunning,
  renderRules,
  renderRulesProvider,
  ruleCacheRefreshCount,
  ruleCacheTotalRules,
  ruleLookupDirectRules,
  ruleLookupError,
  ruleLookupFallbackRule,
  ruleLookupResults,
  ruleLookupUnsupported,
  ruleProviderList,
  ruleRefreshState,
  rules,
  rulesFilter,
  rulesTabShow,
  searchRuleByQuery,
  updateRuleProviderCache,
} from '@/store/rules'
import type { Rule } from '@/types'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const autoRuleCacheBootstrapAttempted = ref(false)
const observedRefreshRunId = ref(0)
const isRulesTabHydrated = ref(false)
const { t } = useI18n()

const syncRuleCacheStats = async () => {
  try {
    const stats = await fetchRuleProviderCacheStats()
    applyRuleProviderCacheStats(stats)
  } catch {
    isRuleCacheUpdating.value = false
  }
}

const ensureRuleCacheBootstrap = async () => {
  if (autoRuleCacheBootstrapAttempted.value) {
    return
  }

  if (
    ruleProviderList.value.length === 0 ||
    ruleCacheTotalRules.value > 0 ||
    isRuleCacheUpdating.value
  ) {
    return
  }

  autoRuleCacheBootstrapAttempted.value = true
  isRuleCacheUpdating.value = true
  ruleCacheRefreshCount.value = 0

  try {
    const result = await updateRuleProviderCache()

    if (result.cancelled) {
      autoRuleCacheBootstrapAttempted.value = false
      return
    }

    ruleCacheRefreshCount.value = result.progressRules
    applyRuleProviderCacheStats(result)
  } catch (error) {
    autoRuleCacheBootstrapAttempted.value = false
    showNotification({
      key: 'ruleCacheAutoInitFailed',
      content: error instanceof Error ? error.message : String(error),
      type: 'alert-error',
      timeout: 3000,
    })
  } finally {
    await syncRuleCacheStats()
  }
}

const initializeRulesPage = async () => {
  await Promise.allSettled([fetchRules(), fetchProxies()])
  isRulesTabHydrated.value = true
  await syncRuleCacheStats()
  await ensureRuleCacheBootstrap()
}

void initializeRulesPage()

const statsPollingTimer = setInterval(() => {
  if (
    rulesTabShow.value === RULE_TAB_TYPE.PROVIDER ||
    isRuleCacheUpdating.value ||
    isRuleRefreshRunning.value
  ) {
    syncRuleCacheStats()
  }
}, 500)

onBeforeUnmount(() => {
  clearInterval(statsPollingTimer)
})

watch(
  rulesFilter,
  () => {
    searchRuleByQuery()
  },
  { immediate: true },
)

watch(rulesTabShow, () => {
  fetchProxies()
})

watch(
  () => ({
    hasReferencedProviders: hasReferencedRuleProviders.value,
    isHydrated: isRulesTabHydrated.value,
    currentTab: rulesTabShow.value,
  }),
  ({ hasReferencedProviders, isHydrated, currentTab }) => {
    if (!isHydrated) {
      return
    }

    if (!hasReferencedProviders && currentTab === RULE_TAB_TYPE.PROVIDER) {
      rulesTabShow.value = RULE_TAB_TYPE.RULES
    }
  },
  {
    immediate: true,
  },
)

watch(
  () => ruleRefreshState.value.isRefreshing,
  async (isRefreshing, wasRefreshing) => {
    if (isRefreshing) {
      observedRefreshRunId.value = ruleRefreshState.value.runId
      return
    }

    if (!wasRefreshing || observedRefreshRunId.value !== ruleRefreshState.value.runId) {
      return
    }

    if (ruleRefreshState.value.cancelled) {
      return
    }

    await fetchRules()

    const hasError = ruleRefreshState.value.errors > 0
    const errorMessage = ruleRefreshState.value.lastError.trim()

    showNotification({
      key: 'ruleRefreshCompletedTip',
      content: hasError && errorMessage ? errorMessage : 'ruleRefreshCompletedTip',
      params: hasError
        ? {}
        : {
            number: `${ruleRefreshState.value.totalRules}`,
          },
      type: hasError ? 'alert-warning' : 'alert-success',
      timeout: hasError ? 5000 : 2500,
    })
  },
)

const { padding, paddingTop } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 8,
})
const virtualScrollerStyle = computed(() => ({
  paddingTop: `${paddingTop.value}px`,
}))

const isVirtualScroller = computed(() => {
  return (
    rulesTabShow.value === RULE_TAB_TYPE.RULES &&
    !isRuleLookupQuery.value &&
    renderRules.value.length > 200
  )
})
</script>
