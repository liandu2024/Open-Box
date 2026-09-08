<template>
  <!-- 访问路径的一站(RouteComparison 里左右两列各五站,同一站左右在同一行)。
       站号圆圈在左、和第一行大字垂直居中,主线贯穿整格把相邻两站连成一根;待定用虚线 + 琥珀色,跳过用灰色虚线。
       整格是网格的一个单元:左右两列同一站共享一行,展开详情后另一列的同一站会跟着一起变高。 -->
  <div
    class="route-cell relative min-w-0 border-x pl-12 pr-3 pt-2 pb-3"
    :class="[
      side === 'left' ? 'route-cell-left' : 'route-cell-right',
      state === 'pending' ? 'route-pending' : state === 'skip' ? 'route-skip' : '',
      first ? 'route-cell-first' : '',
      last ? 'route-cell-last' : '',
    ]"
    :style="{ '--m-order': mobileOrder }"
  >
    <span
      class="route-line"
      aria-hidden="true"
    />
    <span
      v-if="!last"
      class="route-rise"
      aria-hidden="true"
    >↑</span>
    <span class="route-marker">{{ index }}</span>
    <!-- 小标题行:站名后面紧跟一个小号状态徽章(不靠右) -->
    <div class="text-base-content/60 mb-1 flex min-h-[1.125rem] flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      <strong class="font-medium">{{ label }}</strong>
      <span
        v-if="badge"
        class="badge badge-xs whitespace-nowrap"
        :class="badgeClass"
      >{{ badge }}</span>
    </div>
    <!-- 内容区:大字和紧跟的小字排在同一行(基线对齐),放不下自然换行;要独占一行的元素由调用方加 basis-full。
         详情开关默认独占一行("标题 ∨"),detailsInline 时排在内容行末尾(",标题 ∨");展开后的正文另起一整行,箭头翻成 ∧ -->
    <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 [&>*]:min-w-0">
      <slot />
      <button
        v-if="$slots.details"
        type="button"
        class="text-base-content/60 hover:text-base-content inline-flex cursor-pointer items-center gap-0.5 text-xs select-none"
        :class="detailsInline ? '' : 'basis-full'"
        :aria-expanded="open"
        @click="open = !open"
      >
        <span
          v-if="detailsInline"
          class="text-base-content/40"
        >,</span>
        {{ detailsTitle || $t('routeStageDetails') }}
        <ChevronDownIcon
          class="h-3 w-3 transition-transform"
          :class="open ? 'rotate-180' : ''"
        />
      </button>
      <div
        v-if="$slots.details && open"
        class="text-base-content/60 flex basis-full flex-col gap-1.5 text-xs break-all"
      >
        <slot name="details" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'

export type RouteStageState = 'ok' | 'pending' | 'skip'
export type RouteStageTone = 'good' | 'proxy' | 'pending' | 'muted' | 'error'

const props = defineProps<{
  index: number
  label: string
  side: 'left' | 'right'
  // 窄屏(单列)时的排列顺序:左列 1–5、右列 11–15,桌面端由网格行决定,忽略它
  mobileOrder: number
  state?: RouteStageState
  badge?: string
  badgeTone?: RouteStageTone
  detailsTitle?: string
  // 详情开关排在内容行末尾(",标题 ∨")而不是独占一行
  detailsInline?: boolean
  // first:最底下那站(发起访问),画底边圆角;last:最顶上那站(最终出口),不画往上的主线
  first?: boolean
  last?: boolean
}>()

// 详情展开状态:每站自己记
const open = ref(false)
const badgeClass = computed(() => {
  switch (props.badgeTone) {
    case 'good': return 'badge-success badge-soft'
    case 'proxy': return 'badge-info badge-soft'
    case 'pending': return 'badge-warning'
    case 'error': return 'badge-error badge-soft'
    default: return 'badge-ghost'
  }
})
</script>

<style scoped>
.route-cell {
  order: var(--m-order);
  border-color: color-mix(in srgb, var(--color-base-300) 60%, transparent);
  background-color: var(--color-base-100);
}
@media (min-width: 768px) {
  .route-cell {
    order: 0;
  }
}
.route-cell-first {
  border-bottom-width: 1px;
  border-bottom-left-radius: var(--app-radius-box, 1rem);
  border-bottom-right-radius: var(--app-radius-box, 1rem);
}
/* 几何:圆圈中心和主线都在 --route-x 这条竖线上;圆圈垂直居中对齐第一行大字(格子上内边距 0.5rem +
   小标题行 1.125rem + 标题下边距 0.25rem + 大字行高 1.25rem 的一半 − 圆圈半径 0.875rem = 1.625rem) */
.route-cell {
  --route-x: calc(0.9rem + 0.875rem);
  --route-marker-top: calc(1.625rem + 2px);
}
/* 站号:紧凑的小圆圈,实底(主线从它背后穿过) */
.route-marker {
  position: absolute;
  left: 0.9rem;
  top: var(--route-marker-top);
  z-index: 1;
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 9999px;
  border: 1px solid color-mix(in srgb, var(--color-success) 55%, transparent);
  background-color: var(--color-base-100);
  color: var(--color-success);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
}
/* 主线:贯穿整格(圆圈实底盖在它上面),相邻两格的线首尾相接就是一根连续的线;
   最底下那站只画到圆圈中心为止,最顶上那站从圆圈中心往下画 */
.route-line {
  position: absolute;
  left: calc(var(--route-x) - 0.5px);
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: color-mix(in srgb, var(--color-success) 45%, transparent);
}
.route-cell-first .route-line {
  bottom: auto;
  height: calc(var(--route-marker-top) + 0.875rem);
}
.route-cell-last .route-line {
  top: calc(var(--route-marker-top) + 0.875rem);
}
.route-cell-first.route-cell-last .route-line {
  display: none;
}
 /* 向上的箭头:固定宽度的小盒子,中心正好压在主线上,放在本站圆圈正上方 */
.route-rise {
  position: absolute;
  left: var(--route-x);
  top: calc(var(--route-marker-top) - 1rem);
  z-index: 1;
  width: 1rem;
  transform: translateX(-50%);
  text-align: center;
  font-size: 0.8rem;
  line-height: 1;
  color: color-mix(in srgb, var(--color-success) 70%, transparent);
  background-color: var(--color-base-100);
}
.route-pending .route-marker {
  border-color: var(--color-warning);
  color: var(--color-warning);
  background-color: color-mix(in srgb, var(--color-warning) 12%, var(--color-base-100));
}
.route-pending .route-line {
  background: none;
  border-left: 1px dashed var(--color-warning);
}
.route-pending .route-rise {
  color: var(--color-warning);
}
.route-skip .route-marker {
  border-color: color-mix(in srgb, var(--color-base-content) 25%, transparent);
  color: color-mix(in srgb, var(--color-base-content) 50%, transparent);
  background-color: var(--color-base-200);
}
.route-skip .route-line {
  background: none;
  border-left: 1px dashed color-mix(in srgb, var(--color-base-content) 25%, transparent);
}
.route-skip .route-rise {
  color: color-mix(in srgb, var(--color-base-content) 35%, transparent);
}
</style>
