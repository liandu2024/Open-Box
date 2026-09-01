<template>
  <div
    ref="menuRef"
    class="settings-menu scrollbar-hidden ctrls-bar app-card-padding"
    @touchstart.passive.stop
    @touchmove.passive.stop
    @touchend.passive.stop
  >
    <div class="flex w-full max-w-7xl items-center gap-2">
      <ul
        class="menu menu-horizontal settings-menu-list scrollbar-hidden flex min-w-0 flex-1 flex-nowrap gap-2 overflow-x-auto bg-transparent p-0"
      >
        <li
          v-for="item in menuItems"
          :key="item.key"
          class="settings-menu-slot min-w-fit flex-1"
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
      <button
        type="button"
        class="settings-menu-action btn btn-square btn-sm my-auto shrink-0"
        @click="showVisibilityDialog = true"
      >
        <Cog6ToothIcon class="h-5 w-5" />
      </button>
    </div>
    <SettingsVisibilityDialog v-model="showVisibilityDialog" />
  </div>
</template>

<script setup lang="ts">
import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { Cog6ToothIcon } from '@heroicons/vue/24/outline'
import { useSwipe } from '@vueuse/core'
import type { Component } from 'vue'
import { ref } from 'vue'
import SettingsVisibilityDialog from './SettingsVisibilityDialog.vue'

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

const showVisibilityDialog = ref(false)

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

const { isSwiping } = useSwipe(menuRef, {
  passive: false,
  onSwipe(e: TouchEvent) {
    if (!menuRef.value) return
    const targetKey = getMenuItemAtPosition(e.touches[0].clientX)
    if (targetKey && targetKey !== props.activeMenuKey) {
      emit('menu-click', targetKey)
    }
  },
})

const handleMenuClick = (key: string) => {
  if (isSwiping.value) return
  emit('menu-click', key)
}

const getMenuItemAtPosition = (x: number): string | null => {
  if (!menuRef.value) return null

  const menuRect = menuRef.value.getBoundingClientRect()
  const relativeX = x - menuRect.left

  // 找到触摸位置对应的菜单项
  for (const itemEl of menuItemRefs.value.values()) {
    const itemRect = itemEl.getBoundingClientRect()
    const itemRelativeX = itemRect.left - menuRect.left
    const itemWidth = itemRect.width

    if (relativeX >= itemRelativeX && relativeX <= itemRelativeX + itemWidth) {
      return itemEl.dataset.key as string
    }
  }

  return null
}

const getMenuHeight = () => {
  return menuRef.value?.offsetHeight || 0
}

defineExpose({
  getMenuHeight,
})
</script>
