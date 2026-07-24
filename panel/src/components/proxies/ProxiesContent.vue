<script setup lang="ts">
import { PROXY_TAB_TYPE } from '@/constant'
import {
  buildProxyCategoryGroups,
  getProxyCategoryCollapseKey,
  getProxyCategoryOrderKey,
  isProxyCategoryEnabled,
  sortProxyCategoryGroups,
} from '@/helper/proxyCategory'
import { useCalculateMaxProxies } from '@/composables/proxiesScroll'
import {
  handlerProxySelect,
  proxiesTabShow,
  proxyNodesLatencyTest,
} from '@/store/proxies'
import {
  providerProxyCategoryCollapseMap,
  providerProxyCategoryOrderMap,
} from '@/store/settings'
import { Bars3Icon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Draggable from 'vuedraggable'
import LatencyTag from './LatencyTag.vue'
import ProxyCategorySection from './ProxyCategorySection.vue'
import ProxyNodeCard from './ProxyNodeCard.vue'
import ProxyNodeGrid from './ProxyNodeGrid.vue'
import ProxyPreview from './ProxyPreview.vue'

const emit = defineEmits<{
  select: [nodeName: string]
}>()

const props = defineProps<{
  name: string
  now?: string
  renderProxies: string[]
  allProxies?: string[]
  renderAll?: boolean
  providerCategoryEnabled?: boolean
  providerCategoryWildcard?: string
}>()

const { maxProxies } = useCalculateMaxProxies(
  props.renderProxies.length,
  props.renderProxies.indexOf(props.now ?? ''),
)
const { t } = useI18n()
const proxies = computed(() => {
  if (props.renderAll) {
    return props.renderProxies
  }

  return props.renderProxies.slice(0, maxProxies.value)
})

const shouldShowProviderCategories = computed(() => {
  return (
    proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER &&
    isProxyCategoryEnabled(
      props.allProxies ?? props.renderProxies,
      props.providerCategoryWildcard ?? '',
      Boolean(props.providerCategoryEnabled),
    )
  )
})

const proxyCategories = computed(() => {
  return buildProxyCategoryGroups(
    proxies.value,
    props.providerCategoryWildcard ?? '',
    t('other'),
    props.allProxies ?? props.renderProxies,
  )
})

const proxyCategoryOrderKey = computed(() => {
  return getProxyCategoryOrderKey(props.name, props.providerCategoryWildcard ?? '')
})

const orderedProxyCategories = computed({
  get: () => {
    return sortProxyCategoryGroups(
      proxyCategories.value,
      providerProxyCategoryOrderMap.value[proxyCategoryOrderKey.value] ?? [],
    )
  },
  set: (newOrder) => {
    providerProxyCategoryOrderMap.value[proxyCategoryOrderKey.value] = newOrder.map(
      ({ name }) => name,
    )
  },
})

const isCategoryCollapsed = (categoryName: string) => {
  const key = getProxyCategoryCollapseKey(props.name, categoryName)
  return providerProxyCategoryCollapseMap.value[key] ?? false
}

const toggleCategoryCollapsed = (categoryName: string) => {
  const key = getProxyCategoryCollapseKey(props.name, categoryName)
  providerProxyCategoryCollapseMap.value[key] = !isCategoryCollapsed(categoryName)
}

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

const selectProxy = (nodeName: string) => {
  emit('select', nodeName)
  handlerProxySelect(props.name, nodeName)
}
</script>

<template>
  <div
    v-if="shouldShowProviderCategories"
    class="flex flex-col gap-3"
  >
    <Draggable
      v-model="orderedProxyCategories"
      :animation="150"
      ghost-class="provider-category-ghost"
      handle=".provider-category-drag-handle"
      item-key="name"
    >
      <template #item="{ element, index }">
        <ProxyCategorySection
          :title="element.name"
          :title-meta="`(${element.availableCount}/${element.totalCount})`"
          :show-divider="index > 0"
          :collapsed="isCategoryCollapsed(element.name)"
          @toggle="toggleCategoryCollapsed(element.name)"
        >
          <template #handle>
            <button
              type="button"
              class="provider-category-drag-handle text-base-content/35 hover:text-base-content/55 hover:bg-base-200/70 flex h-7 w-7 cursor-grab items-center justify-center rounded-lg transition active:cursor-grabbing"
              @click.stop
            >
              <Bars3Icon class="h-4 w-4" />
            </button>
          </template>
          <template #action>
            <div @click.stop>
              <LatencyTag
                :class="'bg-base-200/50 hover:bg-base-200 z-10 cursor-pointer'"
                :loading="isCategoryLatencyTesting(element.name)"
                @click.stop="handlerCategoryLatencyTest(element.name, element.proxies)"
              />
            </div>
          </template>
          <template #collapsed>
            <ProxyPreview
              :nodes="element.proxies"
              :now="now"
              :group-name="name"
              :force-dots="true"
              @nodeclick="selectProxy"
            />
          </template>
          <ProxyNodeGrid>
            <ProxyNodeCard
              v-for="node in element.proxies"
              :key="node"
              :name="node"
              :group-name="name"
              :active="node === now"
              @click.stop="selectProxy(node)"
            />
          </ProxyNodeGrid>
        </ProxyCategorySection>
      </template>
    </Draggable>
  </div>
  <ProxyNodeGrid v-else>
    <ProxyNodeCard
      v-for="node in proxies"
      :key="node"
      :name="node"
      :group-name="name"
      :active="node === now"
      @click.stop="selectProxy(node)"
    />
  </ProxyNodeGrid>
</template>

<style scoped>
.provider-category-ghost {
  opacity: 0.55;
}
</style>
