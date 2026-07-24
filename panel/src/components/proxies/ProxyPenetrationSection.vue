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
      <div class="flex-1" />
      <div
        class="proxy-penetration-mode bg-base-200/80 inline-flex items-center gap-1 rounded-md p-1"
        :class="!canPenetrate || !canSwitchMode ? 'opacity-60' : ''"
      >
        <button
          class="proxy-penetration-mode-btn rounded-md px-3 py-1.5 text-sm leading-5 font-medium transition-colors"
          :class="
            !canPenetrate || !canSwitchMode
              ? 'text-base-content/35 cursor-not-allowed'
              : penetrationMode === 'stepwise'
                ? 'bg-base-100 text-base-content shadow-sm'
                : 'text-base-content/45 hover:text-base-content/70 cursor-pointer'
          "
          :disabled="!canPenetrate || !canSwitchMode"
          @click="penetrationMode = 'stepwise'"
        >
          {{ $t('stepwisePenetration') }}
        </button>
        <button
          class="proxy-penetration-mode-btn rounded-md px-3 py-1.5 text-sm leading-5 font-medium transition-colors"
          :class="
            !canPenetrate || !canSwitchMode
              ? 'text-base-content/35 cursor-not-allowed'
              : penetrationMode === 'full'
                ? 'bg-base-100 text-base-content shadow-sm'
                : 'text-base-content/45 hover:text-base-content/70 cursor-pointer'
          "
          :disabled="!canPenetrate || !canSwitchMode"
          @click="penetrationMode = 'full'"
        >
          {{ $t('fullExpansion') }}
        </button>
      </div>
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
import { useStorage } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ProxyEmbeddedGroup from './ProxyEmbeddedGroup.vue'

const props = defineProps<{
  groupName: string
}>()

type PenetrationMode = 'stepwise' | 'full'

const { t } = useI18n()
const isExpanded = ref(false)
const penetrationModeMap = useStorage<Record<string, PenetrationMode>>(
  'cache/proxy-penetration-mode-map',
  {},
)
const groupNameRoot = props.groupName
const penetrationMode = computed<PenetrationMode>({
  get: () => penetrationModeMap.value[groupNameRoot] ?? 'stepwise',
  set: (value) => {
    penetrationModeMap.value[groupNameRoot] = value
  },
})
const lastSelectedGroupName = ref('')
const selectedPenetrationGroupMap = ref<Record<string, string>>({})
const stepwiseVisibleCount = ref(1)

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
const canSwitchMode = computed(() => penetratedGroupNames.value.length > 1)

const renderedGroups = computed(() => {
  if (!canPenetrate.value) {
    return []
  }

  if (penetrationMode.value === 'stepwise') {
    return penetratedGroupNames.value.slice(0, stepwiseVisibleCount.value)
  }

  return penetratedGroupNames.value
})

const buttonLabel = computed(() =>
  isExpanded.value ? t('collapsePenetration') : t('strategyPenetration'),
)

const syncStepwiseVisibleCount = (groupNames: string[]) => {
  const selectedIndex = lastSelectedGroupName.value
    ? groupNames.indexOf(lastSelectedGroupName.value)
    : -1

  stepwiseVisibleCount.value =
    selectedIndex === -1 ? 1 : Math.min(groupNames.length, selectedIndex + 2)
}

const handleSelectionChange = (groupName: string, nodeName: string) => {
  lastSelectedGroupName.value = groupName

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

  if (penetrationMode.value === 'stepwise') {
    syncStepwiseVisibleCount(buildPenetratedGroupNames())
  }
}

const resetStepwiseVisibleCount = () => {
  stepwiseVisibleCount.value = 1
}

const resetRenderedGroupCollapseState = (groupNames: string[]) => {
  groupNames.forEach((_groupName, index) => {
    collapseGroupMap.value[`penetration:${groupNameRoot}:level-${index + 1}`] = false
  })
}

watch(canPenetrate, (value) => {
  if (!value) {
    isExpanded.value = false
    lastSelectedGroupName.value = ''
    selectedPenetrationGroupMap.value = {}
    resetStepwiseVisibleCount()
  }
})

watch(canSwitchMode, (value) => {
  if (!value) {
    penetrationMode.value = 'stepwise'
  }
})

watch(
  penetratedGroupNames,
  (groupNames) => {
    if (penetrationMode.value === 'stepwise') {
      syncStepwiseVisibleCount(groupNames)
    }

    if (!isExpanded.value) {
      return
    }
  },
  { deep: true },
)

watch(penetrationMode, (mode) => {
  lastSelectedGroupName.value = ''

  if (mode === 'stepwise') {
    resetStepwiseVisibleCount()
  }
})

const togglePenetration = () => {
  if (!canPenetrate.value) {
    return
  }

  const nextExpanded = !isExpanded.value

  if (nextExpanded) {
    if (penetrationMode.value === 'stepwise') {
      resetStepwiseVisibleCount()
    }

    resetRenderedGroupCollapseState(renderedGroups.value)
  } else {
    lastSelectedGroupName.value = ''
  }

  isExpanded.value = nextExpanded
}
</script>
