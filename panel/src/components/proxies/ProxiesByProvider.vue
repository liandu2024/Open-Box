<script setup lang="ts">
import {
  buildProxyCategoryGroups,
  getProxyCategoryCollapseKey,
  getProxyCategoryOrderKey,
  isProxyCategoryEnabled,
  sortProxyCategoryGroups,
} from '@/helper/proxyCategory'
import {
  getProxyProviderName,
  handlerProxySelect,
  proxyNodesLatencyTest,
  proxyProviederList,
} from '@/store/proxies'
import {
  providerProxyCategoryEnabledMap,
  providerProxyCategoryFeatureEnabled,
  providerProxyCategoryOrderMap,
  providerProxyCategoryWildcardMap,
} from '@/store/settings'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
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
  now: string
  renderProxies: string[]
  renderAll?: boolean
  previewOnly?: boolean
}>()

type ProviderSection =
  | {
      kind: 'provider'
      key: string
      title: string
      proxies: string[]
    }
  | {
      kind: 'category'
      key: string
      providerName: string
      categoryName: string
      title: string
      proxies: string[]
    }

const { t } = useI18n()

const groupedProxies = computed(() => {
  const grouped: Record<string, string[]> = {}
  const providerKeys: string[] = []

  for (const proxy of props.renderProxies) {
    const providerName = getProxyProviderName(proxy)

    if (grouped[providerName]) {
      grouped[providerName].push(proxy)
      continue
    }

    if (providerName === '') {
      providerKeys.unshift('')
    } else {
      providerKeys.push(providerName)
    }

    grouped[providerName] = [proxy]
  }

  return providerKeys.map((providerName) => ({
    providerName,
    proxies: grouped[providerName],
  }))
})

const flattenedSections = computed<ProviderSection[]>(() => {
  const sections: ProviderSection[] = []

  for (const { providerName, proxies } of groupedProxies.value) {
    if (!providerName) {
      sections.push({
        kind: 'provider',
        key: 'provider:root',
        title: '',
        proxies,
      })
      continue
    }

    const wildcard = providerProxyCategoryWildcardMap.value[providerName] ?? ''
    const providerAllProxies =
      proxyProviederList.value.find((provider) => provider.name === providerName)?.proxies.map(
        (node) => node.name,
      ) ?? proxies
    const categoryEnabled =
      providerProxyCategoryFeatureEnabled.value &&
      isProxyCategoryEnabled(
        providerAllProxies,
        wildcard,
        providerProxyCategoryEnabledMap.value[providerName] ?? false,
      )

    if (!categoryEnabled) {
      sections.push({
        kind: 'provider',
        key: `provider:${providerName}`,
        title: providerName,
        proxies,
      })
      continue
    }

    const categories = sortProxyCategoryGroups(
      buildProxyCategoryGroups(proxies, wildcard, t('other'), providerAllProxies),
      providerProxyCategoryOrderMap.value[getProxyCategoryOrderKey(providerName, wildcard)] ?? [],
    )

    categories.forEach((category) => {
      sections.push({
        kind: 'category',
        key: `${providerName}::${category.name}`,
        providerName,
        categoryName: category.name,
        title: `${providerName} - ${category.name}`,
        proxies: category.proxies,
      })
    })
  }

  return sections
})

const renderedSections = computed(() => {
  if (props.renderAll) {
    return flattenedSections.value
  }

  let displayCount = 0
  const sections: ProviderSection[] = []

  for (const section of flattenedSections.value) {
    if (displayCount + section.proxies.length > props.renderProxies.length) {
      sections.push({
        ...section,
        proxies: section.proxies.slice(0, props.renderProxies.length - displayCount),
      })
      break
    }

    sections.push(section)
    displayCount += section.proxies.length
  }

  return sections
})

const sectionCollapseMap = ref<Record<string, boolean>>({})

const getSectionCollapseKey = (section: ProviderSection) => {
  if (section.kind === 'category') {
    return getProxyCategoryCollapseKey(`${props.name}::${section.providerName}`, section.categoryName)
  }

  return `${props.name}::${section.key}`
}

const isSectionCollapsed = (section: ProviderSection) => {
  if (section.title === '') {
    return false
  }

  return sectionCollapseMap.value[getSectionCollapseKey(section)] ?? false
}

const toggleSectionCollapsed = (section: ProviderSection) => {
  if (section.title === '') {
    return
  }

  const key = getSectionCollapseKey(section)
  sectionCollapseMap.value[key] = !isSectionCollapsed(section)
}

const sectionLatencyTestingMap = ref<Record<string, boolean>>({})

const isSectionLatencyTesting = (section: ProviderSection) => {
  return sectionLatencyTestingMap.value[section.key] ?? false
}

const handleSectionLatencyTest = async (section: ProviderSection) => {
  if (section.kind !== 'category' || isSectionLatencyTesting(section)) return

  sectionLatencyTestingMap.value[section.key] = true
  try {
    await proxyNodesLatencyTest(props.name, section.proxies, {
      displayName: section.title,
      keyName: `${props.name}::${section.key}`,
    })
  } finally {
    sectionLatencyTestingMap.value[section.key] = false
  }
}

const selectProxy = (nodeName: string) => {
  emit('select', nodeName)
  handlerProxySelect(props.name, nodeName)
}
</script>

<template>
  <div class="flex flex-col">
    <template
      v-for="(section, index) in renderedSections"
      :key="section.key"
    >
      <section
        v-if="previewOnly && section.title === ''"
        class="flex flex-col gap-3"
        :class="index === renderedSections.length - 1 ? 'pb-0' : 'pb-3'"
      >
        <div
          v-if="index > 0"
          class="border-base-300/55 mb-1 border-t"
        />
        <p
          v-if="section.title !== ''"
          class="text-base-content min-w-0 flex-1 text-left text-base font-medium"
        >
          {{ section.title }}
        </p>
        <ProxyPreview
          :nodes="section.proxies"
          :now="now"
          :group-name="name"
          :force-dots="true"
          @nodeclick="selectProxy"
        />
      </section>
      <ProxyCategorySection
        v-else-if="previewOnly"
        :title="section.title"
        :show-divider="index > 0"
        :toggleable="false"
        :flush-bottom="index === renderedSections.length - 1"
      >
        <template #action>
          <div @click.stop>
            <LatencyTag
              :class="'bg-base-200/50 hover:bg-base-200 z-10 cursor-pointer'"
              :loading="isSectionLatencyTesting(section)"
              @click.stop="handleSectionLatencyTest(section)"
            />
          </div>
        </template>
        <ProxyPreview
          :nodes="section.proxies"
          :now="now"
          :group-name="name"
          :force-dots="true"
          @nodeclick="selectProxy"
        />
      </ProxyCategorySection>
      <ProxyCategorySection
        v-else-if="section.kind === 'category'"
        :title="section.title"
        :show-divider="index > 0"
        :collapsed="isSectionCollapsed(section)"
        :flush-bottom="index === renderedSections.length - 1"
        @toggle="toggleSectionCollapsed(section)"
      >
        <template #action>
          <div @click.stop>
            <LatencyTag
              :class="'bg-base-200/50 hover:bg-base-200 z-10 cursor-pointer'"
              :loading="isSectionLatencyTesting(section)"
              @click.stop="handleSectionLatencyTest(section)"
            />
          </div>
        </template>
        <template #collapsed>
          <ProxyPreview
            :nodes="section.proxies"
            :now="now"
            :group-name="name"
            :force-dots="true"
            @nodeclick="selectProxy"
          />
        </template>
        <ProxyNodeGrid>
          <ProxyNodeCard
            v-for="node in section.proxies"
            :key="node"
            :name="node"
            :group-name="name"
            :active="node === now"
            @click.stop="selectProxy(node)"
          />
        </ProxyNodeGrid>
      </ProxyCategorySection>
      <section
        v-else-if="section.title === ''"
        class="flex flex-col gap-3"
        :class="index === renderedSections.length - 1 ? 'pb-0' : 'pb-3'"
      >
        <div
          v-if="index > 0"
          class="border-base-300/55 mb-1 border-t"
        />
        <p
          v-if="section.title !== ''"
          class="text-base-content min-w-0 flex-1 text-left text-base font-medium"
        >
          {{ section.title }}
        </p>
        <ProxyNodeGrid>
          <ProxyNodeCard
            v-for="node in section.proxies"
            :key="node"
            :name="node"
            :group-name="name"
            :active="node === now"
            @click.stop="selectProxy(node)"
          />
        </ProxyNodeGrid>
      </section>
      <ProxyCategorySection
        v-else
        :title="section.title"
        :show-divider="index > 0"
        :collapsed="isSectionCollapsed(section)"
        :flush-bottom="index === renderedSections.length - 1"
        @toggle="toggleSectionCollapsed(section)"
      >
        <template #collapsed>
          <ProxyPreview
            :nodes="section.proxies"
            :now="now"
            :group-name="name"
            :force-dots="true"
            @nodeclick="selectProxy"
          />
        </template>
        <ProxyNodeGrid>
          <ProxyNodeCard
            v-for="node in section.proxies"
            :key="node"
            :name="node"
            :group-name="name"
            :active="node === now"
            @click.stop="selectProxy(node)"
          />
        </ProxyNodeGrid>
      </ProxyCategorySection>
    </template>
  </div>
</template>
