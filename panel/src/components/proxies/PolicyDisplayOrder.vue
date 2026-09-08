<template>
  <!-- 左边是代理页「策略」页签的显示顺序,拖着排;右边是「目标分流」里的命中顺序,只看不改
       (改它去后台目标分流页)。两列并排放着,是为了让人一眼看出这两个顺序是两回事。 -->
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <div class="flex flex-col gap-2">
      <div class="text-xs font-medium">{{ $t('policyDisplayOrder') }}</div>
      <Draggable
        v-model="rows"
        :animation="150"
        :force-fallback="true"
        :fallback-on-body="true"
        handle=".drag-handle"
        ghost-class="opacity-40"
        item-key="name"
        class="flex flex-col gap-1"
        @end="persist"
      >
        <template #item="{ element }">
          <div class="bg-base-200/60 flex items-center gap-2 rounded-lg px-2 py-1.5">
            <Bars3Icon class="drag-handle text-base-content/40 h-4 w-4 shrink-0 cursor-move" />
            <ProxyIcon
              v-if="element.icon"
              :icon="element.icon"
              :size="16"
              :scale="scaleOf(element.name)"
              :margin="0"
            />
            <span class="truncate text-sm">{{ element.name }}</span>
          </div>
        </template>
      </Draggable>
      <p class="text-base-content/50 text-xs">{{ $t('policyDisplayOrderHint') }}</p>
    </div>

    <div class="flex flex-col gap-2">
      <div class="text-xs font-medium">{{ $t('policyMatchOrder') }}</div>
      <div class="flex flex-col gap-1">
        <!-- 前置自定义分流固定排在所有站点集之前(见 server/engine/routing.mjs),所以钉在这一列
             最上面。它不是站点集、不占编号,用「前置」标记表示"在下面这些之前";没规则或停用时
             它不进内核配置,标成未生效并压暗。 -->
        <div
          v-if="customPolicySummary"
          class="bg-base-200/60 flex items-center gap-2 rounded-lg px-2 py-1.5"
          :class="!customPolicySummary.active && 'opacity-50'"
        >
          <span class="w-4 shrink-0" />
          <ProxyIcon
            v-if="customIcon"
            :icon="customIcon"
            :size="16"
            :scale="customPolicySummary.iconScale"
            :margin="0"
          />
          <span class="truncate text-sm">{{ customPolicySummary.name }}</span>
          <span class="badge badge-ghost badge-xs shrink-0">{{ $t('routingCustomBadge') }}</span>
          <span
            v-if="!customPolicySummary.active"
            class="text-base-content/50 shrink-0 text-xs"
          >{{ $t('routingCustomInactiveBadge') }}</span>
        </div>
        <div
          v-for="(name, index) in matchOrder"
          :key="name"
          class="bg-base-200/60 flex items-center gap-2 rounded-lg px-2 py-1.5"
        >
          <span class="text-base-content/40 w-4 shrink-0 text-center text-xs">{{ index + 1 }}</span>
          <ProxyIcon
            v-if="iconOf(name)"
            :icon="iconOf(name)"
            :size="16"
            :scale="scaleOf(name)"
            :margin="0"
          />
          <span class="truncate text-sm">{{ name }}</span>
        </div>
      </div>
      <p class="text-base-content/50 text-xs">{{ $t('policyMatchOrderHint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import ProxyIcon from '@/components/proxies/ProxyIcon.vue'
import { iconUrlFor } from '@/helper/iconUrl'
import { showNotification } from '@/helper/notification'
import { customPolicySummary, effectiveSiteSetOrder, saveSiteSetDisplayOrder, siteSetIconScales, siteSetIcons, siteSetOrder } from '@/store/openboxSiteSets'
import { Bars3Icon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import Draggable from 'vuedraggable'

// 档案里存的是图标代码(国家码 / globe:xxx),要先换成能画的地址;解析不出来的退回彩色地球,
// 和策略卡片标题上那个大图标同一套换法(store/proxies.ts)
const iconOf = (name: string) => {
  const code = siteSetIcons.value.get(name)
  return (code && iconUrlFor(code)) || iconUrlFor('globe:earth-meridians') || ''
}
const scaleOf = (name: string) => siteSetIconScales.value.get(name) || 0
type Row = { name: string; icon: string }
const toRows = (names: string[]): Row[] => names.map((name) => ({ name, icon: iconOf(name) }))

// 拖拽要求 v-model 绑一个 ref(vuedraggable 会整个替换数组),所以在本地存一份;
// 档案重新拉过来(比如别处新建了站点集)时跟着刷新,顺序没变就不动它
const rows = ref<Row[]>(toRows(effectiveSiteSetOrder.value))
watch(effectiveSiteSetOrder, (order) => {
  if (order.join('\n') !== rows.value.map((r) => r.name).join('\n')) rows.value = toRows(order)
})

const matchOrder = computed(() => siteSetOrder.value)
// 前置自定义分流的图标不在 siteSetIcons 里(它不是站点集),自己换一次
const customIcon = computed(() => {
  const code = customPolicySummary.value?.icon
  return (code && iconUrlFor(code)) || ''
})

const persist = async () => {
  try {
    await saveSiteSetDisplayOrder(rows.value.map((r) => r.name))
  } catch (error) {
    showNotification({
      content: 'policyDisplayOrderSaveFailed',
      type: 'alert-error',
      params: { message: error instanceof Error ? error.message : String(error) },
    })
  }
}
</script>
