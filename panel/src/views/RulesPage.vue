<template>
  <div class="relative flex size-full min-h-0 flex-col overflow-hidden">
    <RulesCtrl />
    <template v-if="!isVirtualScroller">
      <div
        class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        :style="padding"
      >
        <div class="flex flex-col gap-2 px-2 md:py-2">
          <RouteComparison
            v-if="lookupHost"
            :target="lookupHost"
            :port="lookupPort"
            @matched="matchedIndex = $event"
          />
          <div
            v-for="rule in displayRules"
            :key="`${rule.type}-${rule.payload}-${rule.proxy}`"
            :class="isHighlighted(rule) && 'ring-success rounded-[var(--app-radius-panel,1.25rem)] ring-2'"
          >
            <RuleCard
              :rule="rule"
              :index="rules.indexOf(rule) + 1"
            />
          </div>
        </div>
      </div>
    </template>
    <VirtualScroller
      v-else
      class="min-h-0 flex-1"
      :style="virtualScrollerStyle"
      :data="displayRules"
      :size="84"
    >
      <template #before>
        <div
          v-if="lookupTarget"
          class="app-card-padding"
        >
          <RouteComparison
            :target="lookupHost"
            :port="lookupPort"
            @matched="matchedIndex = $event"
          />
        </div>
      </template>
      <template #default="{ item: rule }: { item: Rule }">
        <div :class="isHighlighted(rule) && 'ring-success rounded-[var(--app-radius-panel,1.25rem)] ring-2'">
          <RuleCard
            :key="`${rule.type}-${rule.payload}-${rule.proxy}`"
            :rule="rule"
            :index="rules.indexOf(rule) + 1"
          />
        </div>
      </template>
    </VirtualScroller>
  </div>
</template>

<script setup lang="ts">
import VirtualScroller from '@/components/common/VirtualScroller.vue'
import RuleCard from '@/components/rules/RuleCard.vue'
import RulesCtrl from '@/components/sidebar/RulesCtrl.tsx'
import { usePaddingForViews } from '@/composables/paddingViews'
import { fetchProxies } from '@/store/proxies'
import RouteComparison from '@/components/rules/RouteComparison.vue'
import { fetchRules, lookupHost, lookupPort, lookupTarget, renderRules, rules } from '@/store/rules'
import type { Rule } from '@/types'
import { computed, ref, watch } from 'vue'

void Promise.allSettled([fetchRules(), fetchProxies()])

const { padding, paddingTop } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 8,
})
const virtualScrollerStyle = computed(() => ({
  paddingTop: `${paddingTop.value}px`,
}))

// 穿透查询时,搜索词是域名/IP,按文本过滤规则列表只会得到一片空白;这时列出全部规则,
// 把命中的那条框出来。普通关键字仍按文本过滤。
const matchedIndex = ref<number | null>(null)
watch(lookupTarget, () => { matchedIndex.value = null })
// 查询时只显示结果卡片(它已经带了命中的规则、站点集和出口),规则列表整个收起
const displayRules = computed(() => (lookupTarget.value ? [] : renderRules.value))
const isHighlighted = (rule: Rule) =>
  Boolean(lookupTarget.value) && matchedIndex.value !== null && rules.value.indexOf(rule) === matchedIndex.value

const isVirtualScroller = computed(() => {
  return displayRules.value.length > 200
})
</script>
