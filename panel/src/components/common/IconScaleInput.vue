<template>
  <!-- 图标缩放:- 0 +。所有挑图标的地方都用这一个控件,长相和行为一致。
       默认 0 不缩放,+1 加大 1px,-1 缩小 1px;限在 ±8,再大就不叫微调了。 -->
  <div
    class="join"
    v-tip="$t('iconScaleHint')"
  >
    <button
      type="button"
      class="btn btn-sm join-item px-2"
      :disabled="value <= -LIMIT"
      :aria-label="$t('iconScaleDown')"
      @click="set(value - 1)"
    >
      <MinusIcon class="h-3.5 w-3.5" />
    </button>
    <input
      class="input input-sm join-item w-12 text-center font-mono"
      type="text"
      readonly
      :value="value > 0 ? `+${value}` : String(value)"
    />
    <button
      type="button"
      class="btn btn-sm join-item px-2"
      :disabled="value >= LIMIT"
      :aria-label="$t('iconScaleUp')"
      @click="set(value + 1)"
    >
      <PlusIcon class="h-3.5 w-3.5" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { MinusIcon, PlusIcon } from '@heroicons/vue/24/outline'
import { computed } from 'vue'

const LIMIT = 8
// 老记录没这个字段,当 0
const model = defineModel<number | undefined>({ default: 0 })
const value = computed(() => (Number.isFinite(model.value) ? Math.round(model.value as number) : 0))
const set = (next: number) => {
  model.value = Math.max(-LIMIT, Math.min(LIMIT, next))
}
</script>
