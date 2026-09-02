<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4">
      <div>
        <h2 class="text-base font-semibold">{{ $t('routingRegionTitle') }}</h2>
        <p class="text-base-content/60 text-xs">{{ $t('routingRegionDescription') }}</p>
      </div>

      <!-- 三选一,选中即写档案。原来是"十个地区下拉 + 预览 + 应用"三步,而那三步做的
           事其实只是往档案里塞一组 directRulesets——现在规则由地区在生成配置时决定,
           档案里只存"人在哪",所以不再需要预览与二次确认。 -->
      <div class="flex flex-col gap-2">
        <label
          v-for="opt in REGION_MODES"
          :key="opt.value"
          class="border-base-300/60 hover:bg-base-200/40 flex cursor-pointer items-start gap-3 rounded-lg border p-3"
          :class="current === opt.value && 'border-primary bg-primary/5'"
        >
          <input
            type="radio"
            class="radio radio-sm mt-0.5"
            :value="opt.value"
            :checked="current === opt.value"
            :disabled="saving"
            @change="choose(opt.value)"
          />
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ $t(opt.labelKey) }}</div>
            <div class="text-base-content/60 mt-0.5 text-xs">{{ $t(opt.hintKey) }}</div>
          </div>
        </label>
      </div>

      <p class="text-base-content/50 text-xs">{{ $t('routingRegionDirectNote') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxProfile, OpenboxRegionMode } from '@/api/openbox'
import { showNotification } from '@/helper/notification'
import { computed, ref } from 'vue'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

// 顺序即界面顺序;每一项都带一句"它到底生成什么规则",不然三个名字看不出区别。
const REGION_MODES: { value: OpenboxRegionMode; labelKey: string; hintKey: string }[] = [
  { value: 'CN', labelKey: 'routingRegionCn', hintKey: 'routingRegionCnHint' },
  { value: 'HKMO', labelKey: 'routingRegionHkmo', hintKey: 'routingRegionHkmoHint' },
  { value: 'OTHER', labelKey: 'routingRegionOther', hintKey: 'routingRegionOtherHint' },
]

const saving = ref(false)
const current = computed(() => props.profile.routing.regionMode || 'CN')

const choose = async (value: OpenboxRegionMode) => {
  if (saving.value || current.value === value) return
  saving.value = true
  try {
    await props.patchProfile({ region: value, routing: { regionMode: value } })
  } catch (error) {
    showNotification({
      content: 'routingSaveFailed',
      type: 'alert-error',
      params: { message: error instanceof Error ? error.message : String(error) },
    })
  } finally {
    saving.value = false
  }
}
</script>
