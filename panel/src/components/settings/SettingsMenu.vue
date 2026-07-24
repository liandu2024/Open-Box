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
import { SETTINGS_MENU_KEY } from '@/constant'
import { Cog6ToothIcon } from '@heroicons/vue/24/outline'
import { useSwipe } from '@vueuse/core'
import type { Component } from 'vue'
import { ref } from 'vue'
import SettingsVisibilityDialog from './SettingsVisibilityDialog.vue'

type MenuItem = {
  key: SETTINGS_MENU_KEY
  label: string
  icon: Component
  component: Component
}

const props = defineProps<{
  menuItems: MenuItem[]
  activeMenuKey: SETTINGS_MENU_KEY
}>()

const emit = defineEmits<{
  (e: 'menu-click', key: SETTINGS_MENU_KEY): void
}>()

const showVisibilityDialog = ref(false)

const menuRef = ref<HTMLDivElement>()
const menuItemRefs = ref(new Map<SETTINGS_MENU_KEY, HTMLButtonElement>())

useCtrlsBar()

const setMenuItemRef = (el: HTMLButtonElement | null, key: SETTINGS_MENU_KEY) => {
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

const handleMenuClick = (key: SETTINGS_MENU_KEY) => {
  if (isSwiping.value) return
  emit('menu-click', key)
}

const getMenuItemAtPosition = (x: number): SETTINGS_MENU_KEY | null => {
  if (!menuRef.value) return null

  const menuRect = menuRef.value.getBoundingClientRect()
  const relativeX = x - menuRect.left

  // 找到触摸位置对应的菜单项
  for (const itemEl of menuItemRefs.value.values()) {
    const itemRect = itemEl.getBoundingClientRect()
    const itemRelativeX = itemRect.left - menuRect.left
    const itemWidth = itemRect.width

    if (relativeX >= itemRelativeX && relativeX <= itemRelativeX + itemWidth) {
      return itemEl.dataset.key as SETTINGS_MENU_KEY
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
