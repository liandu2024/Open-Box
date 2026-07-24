<template>
  <CollapseCard
    :name="proxyProvider.name"
    :content-scrollable="false"
    :disable-collapse="shouldShowProviderCategories"
  >
    <template v-slot:title>
      <div class="flex items-start justify-between gap-2">
        <div
          class="min-w-0 flex-1"
          :class="shouldShowProviderCategories && 'cursor-pointer select-none'"
          @click="shouldShowProviderCategories && toggleAllCategoriesCollapsed()"
        >
          <div class="text-xl font-medium">
            {{ proxyProvider.name }}
            <span class="text-base-content/60 text-sm font-normal"> ({{ proxiesCount }}) </span>
          </div>
          <div
            v-if="subscriptionInfo"
            class="text-base-content/60 mt-0.5 text-left text-sm"
          >
            <div>
              {{ subscriptionInfo.expireStr }}
            </div>
            <div>
              {{ subscriptionInfo.usageStr }}
            </div>
            <div>{{ $t('updated') }} {{ fromNow(proxyProvider.updatedAt) }}</div>
          </div>
        </div>
        <div
          class="flex shrink-0 flex-col items-end gap-2"
          :class="subscriptionInfo && 'self-stretch justify-between'"
        >
          <div class="flex gap-2">
            <button
              v-if="shouldShowProviderCategories"
              :class="twMerge('btn btn-circle btn-sm z-30')"
              @click.stop="toggleAllCategoriesCollapsed"
            >
              <ChevronUpIcon
                v-if="hasExpandedCategories"
                class="h-4 w-4"
              />
              <ChevronDownIcon
                v-else
                class="h-4 w-4"
              />
            </button>
            <button
              :class="twMerge('btn btn-circle btn-sm z-30')"
              @click.stop="healthCheckClickHandler"
            >
              <span
                v-if="isHealthChecking"
                class="loading loading-spinner loading-xs"
              ></span>
              <BoltIcon
                v-else
                class="h-4 w-4"
              />
            </button>
            <button
              v-if="proxyProvider.vehicleType !== 'Inline'"
              :class="twMerge('btn btn-circle btn-sm z-30')"
              @click.stop="updateProviderClickHandler"
            >
              <ArrowPathIcon :class="twMerge('h-4 w-4', isUpdating ? 'animate-spin' : '')" />
            </button>
          </div>
          <div
            v-if="subscriptionInfo && shouldShowProviderCategoryControls"
            class="flex justify-end gap-2"
          >
            <button
              class="btn btn-sm btn-square"
              @click.stop="toggleProviderCategoryControlsCollapsed"
            >
              <ChevronRightIcon
                v-if="!providerCategoryControlsCollapsed"
                class="h-4 w-4"
              />
              <ChevronLeftIcon
                v-else
                class="h-4 w-4"
              />
            </button>
            <template v-if="!providerCategoryControlsCollapsed">
              <div
                @mousedown.stop
                @click.stop
                @mouseenter="(e) => showTip(e, t('proxyCategoryTooltip'))"
                @mouseleave="hideTip()"
              >
                <TextInput
                  class="w-10"
                  v-model="providerCategoryWildcardModel"
                  :maxlength="1"
                />
              </div>
              <button
                class="btn btn-sm min-w-16"
                :class="providerCategoryEnabled ? 'btn-neutral' : 'btn-ghost'"
                :disabled="!providerCategoryEnabled && !canEnableProviderCategory"
                @click.stop="toggleProviderCategory"
              >
                {{ providerCategoryEnabled ? $t('cancel') : $t('proxyCategory') }}
              </button>
            </template>
          </div>
        </div>
      </div>
      <div
        v-if="!subscriptionInfo"
        class="mt-0.5 flex items-start justify-between gap-2"
      >
        <div
          class="text-base-content/60 min-w-0 flex-1 text-left text-sm"
          :class="shouldShowProviderCategories && 'cursor-pointer select-none'"
          @click="shouldShowProviderCategories && toggleAllCategoriesCollapsed()"
        >
          {{ $t('updated') }} {{ fromNow(proxyProvider.updatedAt) }}
        </div>
        <div
          v-if="shouldShowProviderCategoryControls"
          class="flex shrink-0 justify-end gap-2"
        >
          <button
            class="btn btn-sm btn-square"
            @click.stop="toggleProviderCategoryControlsCollapsed"
          >
            <ChevronRightIcon
              v-if="!providerCategoryControlsCollapsed"
              class="h-4 w-4"
            />
            <ChevronLeftIcon
              v-else
              class="h-4 w-4"
            />
          </button>
          <template v-if="!providerCategoryControlsCollapsed">
            <div
              @mousedown.stop
              @click.stop
              @mouseenter="(e) => showTip(e, t('proxyCategoryTooltip'))"
              @mouseleave="hideTip()"
            >
              <TextInput
                class="w-10"
                v-model="providerCategoryWildcardModel"
                :maxlength="1"
              />
            </div>
            <button
              class="btn btn-sm min-w-16"
              :class="providerCategoryEnabled ? 'btn-neutral' : 'btn-ghost'"
              :disabled="!providerCategoryEnabled && !canEnableProviderCategory"
              @click.stop="toggleProviderCategory"
            >
              {{ providerCategoryEnabled ? $t('cancel') : $t('proxyCategory') }}
            </button>
          </template>
        </div>
      </div>
    </template>
    <template v-slot:preview>
      <div
        v-if="isWindowResizing"
        class="bg-base-content/10 mt-4 h-4 rounded-full"
      />
      <div
        v-else-if="shouldShowProviderCategories"
        class="mt-4 flex flex-col gap-3"
      >
        <ProxyCategorySection
          v-for="(
            { name: categoryName, proxies: categoryProxies, availableCount, totalCount }, index
          ) in proxyCategories"
          :key="`${categoryName}-${index}`"
          :title="categoryName"
          :title-meta="`(${availableCount}/${totalCount})`"
          :show-divider="index > 0"
          :collapsed="isCategoryCollapsed(categoryName)"
          @toggle="toggleCategoryCollapsed(categoryName)"
        >
          <template #action>
            <div @click.stop>
              <LatencyTag
                :class="'bg-base-200/50 hover:bg-base-200 z-10 cursor-pointer'"
                :loading="isCategoryLatencyTesting(categoryName)"
                @click.stop="handlerCategoryLatencyTest(categoryName, categoryProxies)"
              />
            </div>
          </template>
          <template #collapsed>
            <ProxyPreview
              :nodes="categoryProxies"
              :force-dots="true"
            />
          </template>
          <ProxyPreview :nodes="categoryProxies" />
        </ProxyCategorySection>
      </div>
      <ProxyPreview
        v-else
        :nodes="renderProxies"
        :relaxed-dots-spacing="true"
      />
    </template>
    <template v-slot:content>
      <ProxiesContent
        :name="name"
        :render-proxies="renderProxies"
        :all-proxies="allProxies"
        :render-all="true"
        :provider-category-enabled="providerProxyCategoryFeatureEnabled && providerCategoryEnabled"
        :provider-category-wildcard="providerCategoryWildcardModel"
      />
    </template>
  </CollapseCard>
</template>

<script setup lang="ts">
import { proxyProviderHealthCheckAPI, updateProxyProviderAPI } from '@/api'
import { useBounceOnVisible } from '@/composables/bouncein'
import { useRenderProxies } from '@/composables/renderProxies'
import { PROXY_TAB_TYPE } from '@/constant'
import {
  buildProxyCategoryGroups,
  getProxyCategoryCollapseKey,
  getProxyCategoryOrderKey,
  hasProxyCategoryMatch,
  isProxyCategoryEnabled,
  sortProxyCategoryGroups,
} from '@/helper/proxyCategory'
import { useTooltip } from '@/helper/tooltip'
import { fromNow, prettyBytesHelper } from '@/helper/utils'
import { isWindowResizing } from '@/helper/windowResizeState'
import {
  fetchProxies,
  proxiesTabShow,
  proxyNodesLatencyTest,
  proxyProviederList,
} from '@/store/proxies'
import {
  providerProxyCategoryCollapseMap,
  providerProxyCategoryControlsCollapsedMap,
  providerProxyCategoryEnabledMap,
  providerProxyCategoryFeatureEnabled,
  providerProxyCategoryOrderMap,
  providerProxyCategoryWildcardMap,
} from '@/store/settings'
import {
  ArrowPathIcon,
  BoltIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
} from '@heroicons/vue/24/outline'
import dayjs from 'dayjs'
import { toFinite } from 'lodash'
import { twMerge } from 'tailwind-merge'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CollapseCard from '../common/CollapseCard.vue'
import LatencyTag from './LatencyTag.vue'
import TextInput from '../common/TextInput.vue'
import ProxiesContent from './ProxiesContent.vue'
import ProxyCategorySection from './ProxyCategorySection.vue'
import ProxyPreview from './ProxyPreview.vue'

const props = defineProps<{
  name: string
}>()

const proxyProvider = computed(
  () => proxyProviederList.value.find((group) => group.name === props.name)!,
)
const allProxies = computed(() => proxyProvider.value.proxies.map((node) => node.name) ?? [])
const { renderProxies, proxiesCount } = useRenderProxies(allProxies)
const { t } = useI18n()
const { showTip, hideTip } = useTooltip()

const providerCategoryWildcardModel = computed({
  get: () => providerProxyCategoryWildcardMap.value[props.name] ?? '',
  set: (value: string) => {
    const normalizedValue = Array.from(value).slice(0, 1).join('')

    providerProxyCategoryWildcardMap.value[props.name] = normalizedValue

    if (!hasProxyCategoryMatch(allProxies.value, normalizedValue)) {
      providerProxyCategoryEnabledMap.value[props.name] = false
    }
  },
})

const providerCategoryEnabled = computed({
  get: () => providerProxyCategoryEnabledMap.value[props.name] ?? false,
  set: (value: boolean) => {
    providerProxyCategoryEnabledMap.value[props.name] = value
  },
})

const providerCategoryControlsCollapsed = computed({
  get: () => providerProxyCategoryControlsCollapsedMap.value[props.name] ?? false,
  set: (value: boolean) => {
    providerProxyCategoryControlsCollapsedMap.value[props.name] = value
  },
})

const canEnableProviderCategory = computed(() => {
  return hasProxyCategoryMatch(allProxies.value, providerCategoryWildcardModel.value)
})

const shouldShowProviderCategoryControls = computed(() => {
  return (
    proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER &&
    providerProxyCategoryFeatureEnabled.value
  )
})

const shouldShowProviderCategories = computed(() => {
  return (
    proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER &&
    providerProxyCategoryFeatureEnabled.value &&
    isProxyCategoryEnabled(
      allProxies.value,
      providerCategoryWildcardModel.value,
      providerCategoryEnabled.value,
    )
  )
})

const proxyCategories = computed(() => {
  return sortProxyCategoryGroups(
    buildProxyCategoryGroups(
      renderProxies.value,
      providerCategoryWildcardModel.value,
      t('other'),
      allProxies.value,
    ),
    providerProxyCategoryOrderMap.value[
      getProxyCategoryOrderKey(props.name, providerCategoryWildcardModel.value)
    ] ?? [],
  )
})

const isCategoryCollapsed = (categoryName: string) => {
  const key = getProxyCategoryCollapseKey(props.name, categoryName)
  return providerProxyCategoryCollapseMap.value[key] ?? false
}

const toggleCategoryCollapsed = (categoryName: string) => {
  const key = getProxyCategoryCollapseKey(props.name, categoryName)
  providerProxyCategoryCollapseMap.value[key] = !isCategoryCollapsed(categoryName)
}

const hasExpandedCategories = computed(() => {
  return proxyCategories.value.some(({ name }) => !isCategoryCollapsed(name))
})

const categoryLatencyTestingMap = ref<Record<string, boolean>>({})

const isCategoryLatencyTesting = (categoryName: string) => {
  return categoryLatencyTestingMap.value[categoryName] ?? false
}

const handlerCategoryLatencyTest = async (categoryName: string, categoryProxies: string[]) => {
  if (isCategoryLatencyTesting(categoryName)) return

  categoryLatencyTestingMap.value[categoryName] = true
  try {
    await proxyNodesLatencyTest(props.name, categoryProxies, {
      displayName: `${props.name} / ${categoryName}`,
      keyName: `${props.name}::${categoryName}`,
    })
  } finally {
    categoryLatencyTestingMap.value[categoryName] = false
  }
}

const toggleAllCategoriesCollapsed = () => {
  const nextCollapsed = hasExpandedCategories.value

  proxyCategories.value.forEach(({ name }) => {
    const key = getProxyCategoryCollapseKey(props.name, name)
    providerProxyCategoryCollapseMap.value[key] = nextCollapsed
  })
}

const toggleProviderCategory = () => {
  if (providerCategoryEnabled.value) {
    providerProxyCategoryEnabledMap.value[props.name] = false
    providerProxyCategoryWildcardMap.value[props.name] = ''
    return
  }

  if (!canEnableProviderCategory.value) return

  providerCategoryEnabled.value = true
}

const toggleProviderCategoryControlsCollapsed = () => {
  providerCategoryControlsCollapsed.value = !providerCategoryControlsCollapsed.value
}

const subscriptionInfo = computed(() => {
  const info = proxyProvider.value.subscriptionInfo

  if (info) {
    const { Download = 0, Upload = 0, Total = 0, Expire = 0 } = info

    if (Download === 0 && Upload === 0 && Total === 0 && Expire === 0) {
      return null
    }

    const total = prettyBytesHelper(Total, { binary: true })
    const used = prettyBytesHelper(Download + Upload, { binary: true })
    const percentage = toFinite((((Download + Upload) / Total) * 100).toFixed(2))
    const expireStr =
      Expire === 0
        ? `${t('expire')}: ${t('noExpire')}`
        : `${t('expire')}: ${dayjs(Expire * 1000).format('YYYY-MM-DD')}`

    const usedStr = `${used} / ${total}`
    const usageStr = Total === 0 ? usedStr : `${usedStr} ( ${percentage}% )`

    return {
      expireStr,
      usageStr,
    }
  }

  return null
})

const isUpdating = ref(false)
const isHealthChecking = ref(false)

const healthCheckClickHandler = async () => {
  if (isHealthChecking.value) return

  isHealthChecking.value = true
  try {
    await proxyProviderHealthCheckAPI(props.name)
    await fetchProxies()
    isHealthChecking.value = false
  } catch {
    isHealthChecking.value = false
  }
}

const updateProviderClickHandler = async () => {
  if (isUpdating.value) return

  isUpdating.value = true
  try {
    await updateProxyProviderAPI(props.name)
    await fetchProxies()
    isUpdating.value = false
  } catch {
    isUpdating.value = false
  }
}

useBounceOnVisible()
</script>
