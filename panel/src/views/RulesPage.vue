<template>
  <div class="relative flex size-full min-h-0 flex-col overflow-hidden">
    <RulesCtrl />
    <template v-if="!isVirtualScroller">
      <div
        class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        :style="padding"
      >
        <div class="flex flex-col gap-3 p-3">
          <RuleCard
            v-for="rule in renderRules"
            :key="`${rule.type}-${rule.payload}-${rule.proxy}`"
            :rule="rule"
            :index="rules.indexOf(rule) + 1"
          />
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
  </div>
</template>

<script setup lang="ts">
import VirtualScroller from '@/components/common/VirtualScroller.vue'
import RuleCard from '@/components/rules/RuleCard.vue'
import RulesCtrl from '@/components/sidebar/RulesCtrl.tsx'
import { usePaddingForViews } from '@/composables/paddingViews'
import { fetchProxies } from '@/store/proxies'
import { fetchRules, renderRules, rules } from '@/store/rules'
import type { Rule } from '@/types'
import { computed } from 'vue'

void Promise.allSettled([fetchRules(), fetchProxies()])

const { padding, paddingTop } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 8,
})
const virtualScrollerStyle = computed(() => ({
  paddingTop: `${paddingTop.value}px`,
}))

const isVirtualScroller = computed(() => {
  return renderRules.value.length > 200
})
</script>
