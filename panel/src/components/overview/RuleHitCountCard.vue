<template>
  <div
    class="card w-full"
    v-if="hasRulesWithExtra"
  >
    <div class="card-title px-4 pt-4">
      {{ $t('ruleHitCountCard') }}
    </div>
    <div class="card-body gap-4">
      <div class="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div class="flex flex-col gap-2">
          <div class="pb-2 text-sm font-bold">
            {{ $t('ruleHitChart') }}
          </div>
          <RuleHitCountChart type="hit" />
        </div>
        <div class="flex flex-col gap-2">
          <div class="pb-2 text-sm font-bold">
            {{ $t('ruleMissChart') }}
          </div>
          <RuleHitCountChart type="miss" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import RuleHitCountChart from '@/components/overview/RuleHitCountChart.vue'
import { rules } from '@/store/rules'
import { computed } from 'vue'

// 检查是否有规则含有 extra 字段
const hasRulesWithExtra = computed(() => {
  return rules.value.some((rule) => rule.extra)
})
</script>
