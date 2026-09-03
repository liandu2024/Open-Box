<template>
  <div
    ref="menuRef"
    class="settings-menu scrollbar-hidden ctrls-bar app-card-padding"
    @touchstart.passive.stop
    @touchmove.passive.stop
    @touchend.passive.stop
  >
    <!-- 页签靠左、各自按内容取宽,不两端拉伸;右侧 #settings-header-actions 是各页签
         把自己的操作按钮(添加订阅、自动分组…)Teleport 过来的位置,位置固定在右上角 -->
    <div class="flex w-full items-center gap-2">
      <ul
        class="menu menu-horizontal settings-menu-list scrollbar-hidden flex min-w-0 flex-1 flex-nowrap gap-2 overflow-x-auto bg-transparent p-0"
      >
        <li
          v-for="item in menuItems"
          :key="item.key"
          class="settings-menu-slot min-w-fit"
        >
          <button
            :ref="(el) => setMenuItemRef(el as HTMLButtonElement | null, item.key)"
            type="button"
            :data-key="item.key"
            :id="`menu-item-${item.key}`"
            class="settings-menu-btn w-full"
            :class="[activeMenuKey === item.key ? 'menu-active' : '']"
            @click="handleMenuClick(item.key)"
          >
            <component
              :is="item.icon"
              class="h-5 w-5 shrink-0"
            />
            <span class="hidden truncate text-sm md:block">
              {{ $t(item.label) }}
            </span>
          </button>
        </li>
      </ul>
      <div
        id="settings-header-actions"
        class="ml-auto flex shrink-0 items-center gap-2"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useCtrlsBar } from '@/composables/useCtrlsBar'
import type { Component } from 'vue'
import { ref, watch } from 'vue'

// key 故意放宽成 string:这个条形菜单原本只服务于面板设置内部的分组
// (SETTINGS_MENU_KEY),现在改为驱动设置页的一级页签(SETTINGS_TAB)。两者是不同
// 的枚举,组件本身并不关心具体是哪一个,只负责"渲染一排、点哪个发哪个 key"。
type MenuItem = {
  key: string
  label: string
  icon: Component
}

const props = defineProps<{
  menuItems: MenuItem[]
  activeMenuKey: string
}>()

const emit = defineEmits<{
  (e: 'menu-click', key: string): void
}>()

const menuRef = ref<HTMLDivElement>()
const menuItemRefs = ref(new Map<string, HTMLButtonElement>())

useCtrlsBar()

const setMenuItemRef = (el: HTMLButtonElement | null, key: string) => {
  if (!el) {
    menuItemRefs.value.delete(key)
    return
  }

  menuItemRefs.value.set(key, el)
}

// 页签一多(手机上七个图标 + 右上角按钮)一屏放不下,靠 ul 的 overflow-x-auto 横向滑动。
// 原来这里用 useSwipe 做"手指划过哪个页签就切到哪个",它的 passive:false 会把 touchmove
// preventDefault 掉,原生横向滚动就被吞了,后面的页签永远划不出来——两者只能留一个,
// 留滚动。外层的 @touchstart/@touchmove .stop 仍然保留:别让页面级的左右滑动切页抢走手势。
const handleMenuClick = (key: string) => {
  emit('menu-click', key)
}

// 当前页签滚进可视区(手机上从别处跳过来时,页签可能在屏幕外)
watch(
  () => props.activeMenuKey,
  (key) => {
    const el = menuItemRefs.value.get(key)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  },
  { flush: 'post' },
)

const getMenuHeight = () => {
  return menuRef.value?.offsetHeight || 0
}

defineExpose({
  getMenuHeight,
})
</script>
