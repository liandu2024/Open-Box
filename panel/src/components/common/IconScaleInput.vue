<template>
  <!-- 图标缩放:- 0 + 重置。所有挑图标的地方都用这一个控件,长相和行为一致。
       默认 0 不缩放,+1 加大 1px,-1 缩小 1px;限在 ±20(按代理页 46px 的大图标算,
       -20 还剩一半多,+20 是 1.4 倍,再大就不是调图标了)。和后端 ICON_SCALE_LIMIT 一个数。 -->
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
    <!-- 重置回 0:和「节点卡片最小宽度」那个重置是同一种写法 -->
    <button
      type="button"
      class="btn btn-sm join-item"
      :disabled="value === 0"
      @click="set(0)"
    >
      {{ $t('reset') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { MinusIcon, PlusIcon } from '@heroicons/vue/24/outline'
import { computed } from 'vue'

const LIMIT = 20
// 老记录没这个字段,当 0
const model = defineModel<number | undefined>({ default: 0 })
const value = computed(() => (Number.isFinite(model.value) ? Math.round(model.value as number) : 0))
const set = (next: number) => {
  model.value = Math.max(-LIMIT, Math.min(LIMIT, next))
}
</script>
