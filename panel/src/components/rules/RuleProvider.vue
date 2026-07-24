<template>
  <div
    class="card hover:bg-base-200 app-card-padding w-full cursor-pointer gap-3 text-sm"
    @click="openRuleProviderDetails"
  >
    <div class="flex h-6 items-center gap-2 leading-6">
      <span>{{ index }}.</span>
      <span class="text-main">{{ ruleProvider.name }}</span>
      <span class="text-base-content/80 text-xs">
        ({{ displayLocalRuleCount }}/{{ ruleProvider.ruleCount }})
      </span>
      <button
        v-if="ruleProvider.vehicleType !== 'Inline'"
        :class="twMerge('btn btn-circle btn-xs btn-ghost')"
        @click.stop="updateRuleProviderClickHandler"
      >
        <ArrowPathIcon
          :class="
            twMerge(
              'h-4 w-4',
              isButtonRefreshing && 'animate-spin',
            )
          "
        />
      </button>
    </div>
    <div class="text-base-content/80 flex flex-wrap items-center gap-2 text-xs">
      <span
        v-if="ruleProvider.behavior"
        class="badge badge-sm min-w-16"
      >
        {{ ruleProvider.behavior }}
      </span>
      <span
        v-if="ruleProvider.vehicleType"
        class="badge badge-sm min-w-12"
      >
        {{ ruleProvider.vehicleType }}
      </span>
      <span>{{ $t('updated') }} {{ fromNow(ruleProvider.updatedAt) }}</span>
    </div>
    <div
      v-if="providerUrl"
      class="text-base-content/70 flex items-center gap-2 text-sm font-normal"
    >
      <a
        :href="providerUrl"
        target="_blank"
        rel="noreferrer"
        class="link link-hover truncate leading-6"
        @click.stop
      >
        {{ providerUrl }}
      </a>
      <button
        class="btn btn-ghost btn-xs"
        type="button"
        :title="t('copyLink')"
        @click.stop="copyUrl(providerUrl)"
      >
        <DocumentDuplicateIcon class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useBounceOnVisible } from '@/composables/bouncein'
import { showNotification } from '@/helper/notification'
import { fromNow } from '@/helper/utils'
import { openRuleProviderPenetrationDialog } from '@/store/proxyGroupRulePenetration'
import {
  applyRuleProviderCacheStats,
  cancelBackgroundRuleRefresh,
  fetchRuleProviderCacheStats,
  isRuleCacheUpdating,
  isRuleRefreshRunning,
  ruleCacheRefreshCount,
  ruleProviderLocalCountMap,
  ruleRefreshState,
  ruleProviderSourceUrlMap,
  startBackgroundRuleRefresh,
} from '@/store/rules'
import type { RuleProvider } from '@/types'
import { ArrowPathIcon, DocumentDuplicateIcon } from '@heroicons/vue/24/outline'
import { twMerge } from 'tailwind-merge'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const isUpdating = ref(false)
const { t } = useI18n()
const props = defineProps<{
  ruleProvider: RuleProvider
  index: number
}>()

const localRuleCount = computed(() => {
  return ruleProviderLocalCountMap.value[props.ruleProvider.name] ?? 0
})

const isCurrentProviderRefreshing = computed(() => {
  return (
    ruleRefreshState.value.isRefreshing &&
    ruleRefreshState.value.providerName === props.ruleProvider.name
  )
})

const displayLocalRuleCount = computed(() => {
  if (isCurrentProviderRefreshing.value && ruleRefreshState.value.phase === 'cache') {
    return ruleCacheRefreshCount.value || 0
  }

  return localRuleCount.value
})

const isButtonRefreshing = computed(() => {
  if (isUpdating.value || isCurrentProviderRefreshing.value) {
    return true
  }

  return (
    ruleRefreshState.value.scope === 'all' &&
    (isRuleRefreshRunning.value || isRuleCacheUpdating.value)
  )
})

const providerUrl = computed(() => {
  return props.ruleProvider.url || ruleProviderSourceUrlMap.value[props.ruleProvider.name] || ''
})

const openRuleProviderDetails = () => {
  void openRuleProviderPenetrationDialog(props.ruleProvider.name)
}

const updateRuleProviderClickHandler = async () => {
  if (isUpdating.value) return

  isUpdating.value = true

  try {
    if (isRuleRefreshRunning.value || isRuleCacheUpdating.value) {
      const result = await cancelBackgroundRuleRefresh()
      applyRuleProviderCacheStats(result)

      if (
        isCurrentProviderRefreshing.value ||
        ruleRefreshState.value.scope === 'all' ||
        !ruleRefreshState.value.providerName
      ) {
        showNotification({
          key: 'ruleRefreshCompletedTip',
          content: 'ruleRefreshStopped',
          type: 'alert-warning',
          timeout: 2000,
        })
      }

      return
    }

    ruleCacheRefreshCount.value = 0
    const result = await startBackgroundRuleRefresh(props.ruleProvider.name)
    applyRuleProviderCacheStats(result)
    const latestStats = await fetchRuleProviderCacheStats()
    applyRuleProviderCacheStats(latestStats)
  } catch (error) {
    showNotification({
      key: `rule-provider-refresh-${props.ruleProvider.name}`,
      content: error instanceof Error ? error.message : String(error),
      type: 'alert-error',
      timeout: 3000,
    })
  } finally {
    isUpdating.value = false
  }
}

const copyUrl = async (url: string) => {
  try {
    await navigator.clipboard.writeText(url)
    showNotification({
      content: 'copySuccess',
      type: 'alert-success',
      timeout: 1500,
    })
  } catch (error) {
    console.warn('Failed to copy rule source url with navigator.clipboard, falling back', error)

    const textArea = document.createElement('textarea')
    textArea.value = url
    textArea.setAttribute('readonly', 'readonly')
    textArea.style.position = 'fixed'
    textArea.style.opacity = '0'
    document.body.appendChild(textArea)
    textArea.select()

    try {
      document.execCommand('copy')
      showNotification({
        content: 'copySuccess',
        type: 'alert-success',
        timeout: 1500,
      })
    } catch (fallbackError) {
      console.warn('Failed to copy rule source url with fallback', fallbackError)
    } finally {
      document.body.removeChild(textArea)
    }
  }
}

useBounceOnVisible()
</script>
