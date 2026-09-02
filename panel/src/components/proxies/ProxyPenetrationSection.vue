<template>
  <div class="mt-2.5">
    <div class="flex flex-wrap items-center gap-3">
      <button
        class="proxy-penetration-toggle btn btn-sm min-w-24 gap-1.5"
        :class="isExpanded ? 'btn-neutral' : 'btn-outline'"
        :disabled="!canPenetrate"
        @click="togglePenetration"
      >
        <span>{{ buttonLabel }}</span>
        <ChevronDownIcon
          class="h-4 w-4 transition-transform duration-200"
          :class="isExpanded && 'rotate-180'"
        />
      </button>
    </div>

    <div
      v-if="isExpanded && renderedGroups.length"
      class="border-base-300/60 mt-2 border-t"
    >
      <div
        v-for="(groupName, index) in renderedGroups"
        :key="groupName"
        class="border-base-300/60 border-b pt-2.5 pb-4 last:border-b-0 last:pb-0 max-md:pb-3 max-md:last:pb-0"
      >
        <ProxyEmbeddedGroup
          :name="groupName"
          :level="index + 1"
          :root-group-name="groupNameRoot"
          @selection-change="handleSelectionChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getDescendantProxyGroups, getProxyGroupChains, proxyMap } from '@/store/proxies'
import { collapseGroupMap } from '@/store/settings'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ProxyEmbeddedGroup from './ProxyEmbeddedGroup.vue'

// 穿透:一打开代理页就把整条链(站点集 → 组 → … → 节点)全部展开摆出来,每一层的
// 节点列表也是展开的,不用点「展开穿透」,也没有「逐层 / 到底」的模式可选——
// 原来那套逐层展开只是多点几次鼠标。「收起穿透」按钮留着,想清爽时可以收起来。
const props = defineProps<{
  groupName: string
}>()

const { t } = useI18n()
const isExpanded = ref(true)
const groupNameRoot = props.groupName
const selectedPenetrationGroupMap = ref<Record<string, string>>({})

const getActualNextGroupName = (groupName: string) => {
  return getProxyGroupChains(groupName)[1] ?? ''
}

const getSelectedNextGroupName = (groupName: string) => {
  const selectedName = selectedPenetrationGroupMap.value[groupName]

  if (
    selectedName &&
    (proxyMap.value[groupName]?.all ?? []).includes(selectedName) &&
    proxyMap.value[selectedName]?.all?.length
  ) {
    return selectedName
  }

  return ''
}

const buildPenetratedGroupNames = () => {
  if (!props.groupName) {
    return []
  }

  const groupNames: string[] = []
  const visited = new Set<string>([groupNameRoot])
  let currentGroupName = groupNameRoot

  while (true) {
    const nextGroupName =
      getSelectedNextGroupName(currentGroupName) || getActualNextGroupName(currentGroupName)

    if (!nextGroupName || visited.has(nextGroupName)) {
      break
    }

    groupNames.push(nextGroupName)
    visited.add(nextGroupName)
    currentGroupName = nextGroupName
  }

  return groupNames
}

const penetratedGroupNames = computed(() => buildPenetratedGroupNames())
const canPenetrate = computed(() => penetratedGroupNames.value.length > 0)
const renderedGroups = computed(() => (canPenetrate.value ? penetratedGroupNames.value : []))

const buttonLabel = computed(() =>
  isExpanded.value ? t('collapsePenetration') : t('strategyPenetration'),
)

const handleSelectionChange = (groupName: string, nodeName: string) => {
  const nextSelectedPenetrationGroupMap = { ...selectedPenetrationGroupMap.value }

  getDescendantProxyGroups(groupName).forEach((descendantGroupName) => {
    delete nextSelectedPenetrationGroupMap[descendantGroupName]
  })

  if (
    (proxyMap.value[groupName]?.all ?? []).includes(nodeName) &&
    proxyMap.value[nodeName]?.all?.length
  ) {
    nextSelectedPenetrationGroupMap[groupName] = nodeName
  } else {
    delete nextSelectedPenetrationGroupMap[groupName]
  }

  selectedPenetrationGroupMap.value = nextSelectedPenetrationGroupMap
}

// 每一层的节点列表都展开(ProxyEmbeddedGroup 按这个 key 决定显示圆点预览还是节点卡片)
const openRenderedGroups = (groupNames: string[]) => {
  groupNames.forEach((_groupName, index) => {
    collapseGroupMap.value[`penetration:${groupNameRoot}:level-${index + 1}`] = true
  })
}

watch(canPenetrate, (value) => {
  isExpanded.value = value
  if (!value) {
    selectedPenetrationGroupMap.value = {}
  }
})

// 链条变了(比如在某一层换选了别的组)就把新出现的层也展开
watch(
  renderedGroups,
  (groupNames) => {
    if (isExpanded.value) {
      openRenderedGroups(groupNames)
    }
  },
  { immediate: true },
)

const togglePenetration = () => {
  if (!canPenetrate.value) {
    return
  }

  const nextExpanded = !isExpanded.value

  if (nextExpanded) {
    openRenderedGroups(renderedGroups.value)
  }

  isExpanded.value = nextExpanded
}
</script>
