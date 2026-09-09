<template>
  <!-- 成员里没有组可以往下穿(比如「节点」页签里的组,成员全是节点)就整个不显示,
       不留一个灰掉的按钮 -->
  <div
    v-if="canPenetrate"
    class="mt-2.5"
  >
    <div class="flex flex-wrap items-center gap-3">
      <button
        class="proxy-penetration-toggle btn btn-sm min-w-24 gap-1.5"
        :class="isExpanded ? 'btn-neutral' : 'btn-outline'"
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
        v-for="(level, index) in renderedLevels"
        :key="level.key"
        class="border-base-300/60 border-b pt-2.5 pb-4 last:border-b-0 last:pb-0 max-md:pb-3 max-md:last:pb-0"
      >
        <!-- 故障转移组后面跟一层「当前选中页签的明细节点」;页签本身在上一层(父组那一栏)里选 -->
        <FailoverLaneDetail
          v-if="level.kind === 'lane'"
          :group-name="level.groupName"
          :lane-id="level.laneId"
        />
        <ProxyEmbeddedGroup
          v-else
          :name="level.groupName"
          :level="index + 1"
          :root-group-name="groupNameRoot"
          :selected-lane-id="selectedLaneFor(level.groupName)"
          @selection-change="handleSelectionChange"
          @lane-change="handleLaneChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { failoverCurrentLaneId, failoverLanesOf, isFailoverGroup, isFailoverInternalTag } from '@/store/openboxFailover'
import { getDescendantProxyGroups, getProxyGroupChains, proxyMap } from '@/store/proxies'
import { collapseGroupMap } from '@/store/settings'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FailoverLaneDetail from './FailoverLaneDetail.vue'
import ProxyEmbeddedGroup from './ProxyEmbeddedGroup.vue'

// 穿透:展开站点集卡片只看到它的成员(节点 / 节点组),穿透默认收着;点「策略穿透」
// 才把整条链(站点集 → 组 → … → 节点)一次全部摆出来,每一层的节点列表也是展开的。
// 没有「逐层 / 到底」的模式可选——原来那套逐层展开只是多点几次鼠标。
const props = defineProps<{
  groupName: string
}>()

const { t } = useI18n()
const isExpanded = ref(false)
const groupNameRoot = props.groupName
const selectedPenetrationGroupMap = ref<Record<string, string>>({})

// 故障转移的内部子组(__fo:…)不单独成一层:父组那一层已经直接列到节点了
const getActualNextGroupName = (groupName: string) => {
  const next = getProxyGroupChains(groupName)[1] ?? ''
  return isFailoverInternalTag(next) ? '' : next
}

const getSelectedNextGroupName = (groupName: string) => {
  const selectedName = selectedPenetrationGroupMap.value[groupName]

  if (
    selectedName &&
    !isFailoverInternalTag(selectedName) &&
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

// 故障转移组:上面一栏选页签(不动内核),下面一栏看它的节点。没点过就看内核此刻在的那个页签
const selectedLaneMap = ref<Record<string, string>>({})
const selectedLaneFor = (groupName: string) => {
  if (!isFailoverGroup(groupName)) return null
  const lanes = failoverLanesOf(groupName, proxyMap.value) ?? []
  const picked = selectedLaneMap.value[groupName]
  if (picked && lanes.some((l) => l.id === picked)) return picked
  return failoverCurrentLaneId(groupName, lanes, proxyMap.value[groupName]?.now) ?? lanes[0]?.id ?? null
}
const handleLaneChange = (groupName: string, laneId: string) => {
  selectedLaneMap.value = { ...selectedLaneMap.value, [groupName]: laneId }
}
type Level = { key: string; kind: 'group'; groupName: string } | { key: string; kind: 'lane'; groupName: string; laneId: string }
const renderedLevels = computed<Level[]>(() => {
  const out: Level[] = []
  for (const groupName of renderedGroups.value) {
    out.push({ key: groupName, kind: 'group', groupName })
    if (isFailoverGroup(groupName)) {
      const laneId = selectedLaneFor(groupName)
      if (laneId) out.push({ key: `lane:${groupName}:${laneId}`, kind: 'lane', groupName, laneId })
    }
  }
  return out
})

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
  if (!value) {
    isExpanded.value = false
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
