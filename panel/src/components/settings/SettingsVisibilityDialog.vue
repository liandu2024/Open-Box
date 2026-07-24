<template>
  <DialogWrapper
    v-model="isOpen"
    :title="$t('settingsVisibility')"
  >
    <div class="flex flex-col text-sm">
      <div class="mb-4 flex gap-2">
        <button
          class="btn btn-sm"
          @click="applyShowAllPreset"
        >
          {{ $t('showAllPreset') }}
        </button>
        <button
          class="btn btn-sm"
          @click="applyMinimalPreset"
        >
          {{ $t('minimalPreset') }}
        </button>
      </div>
      <Draggable
        v-model="orderedCategories"
        :animation="150"
        ghost-class="ghost"
        handle=".drag-handle"
        :item-key="(item: SettingsCategory) => item.key"
      >
        <template #item="{ element: category }">
          <div
            class="collapse-arrow bg-base-200/50 collapse mb-4"
            :class="expandedCategories[category.key] ? 'collapse-open' : 'collapse-close'"
          >
            <div
              class="collapse-title cursor-pointer font-medium"
              @click="expandedCategories[category.key] = !expandedCategories[category.key]"
            >
              <div class="setting-item">
                <Bars3Icon class="drag-handle text-base-content/50 h-5 w-5 cursor-move" />
                <div class="setting-item-label">
                  {{ $t(category.label) }}
                </div>
                <input
                  type="checkbox"
                  class="toggle"
                  :checked="!hiddenSettingsItems[category.key]"
                  @click.stop
                  @change="
                    hiddenSettingsItems[category.key] = !($event.target as HTMLInputElement).checked
                  "
                />
              </div>
            </div>
            <div class="collapse-content p-0">
              <div class="max-h-96 overflow-y-auto">
                <div class="flex flex-col gap-2">
                  <div
                    v-for="item in category.items"
                    :key="item.key"
                    class="setting-item px-4"
                  >
                    <div class="setting-item-label">
                      {{ $t(item.label) }}
                    </div>
                    <input
                      type="checkbox"
                      class="toggle"
                      :checked="!hiddenSettingsItems[item.key]"
                      @change="
                        hiddenSettingsItems[item.key] = !($event.target as HTMLInputElement).checked
                      "
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </Draggable>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import {
  getAllSettingKeys,
  SETTINGS_CATEGORIES,
  type SettingsCategory,
} from '@/config/settingsItems'
import { SETTINGS_MENU_KEY } from '@/constant'
import { hiddenSettingsItems, settingsMenuOrder } from '@/store/settings'
import { Bars3Icon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import Draggable from 'vuedraggable'

const isOpen = defineModel<boolean>({ required: true })

const expandedCategories = ref<Record<string, boolean>>({})

const orderedCategories = computed({
  get: () => {
    const orderMap = new Map(settingsMenuOrder.value.map((key, index) => [key, index]))
    return [...SETTINGS_CATEGORIES].sort((a, b) => {
      const orderA = orderMap.get(a.key) ?? Infinity
      const orderB = orderMap.get(b.key) ?? Infinity
      return orderA - orderB
    })
  },
  set: (newOrder: SettingsCategory[]) => {
    settingsMenuOrder.value = newOrder.map((category) => category.key)
  },
})

// 应用"全部显示"预设
const applyShowAllPreset = () => {
  hiddenSettingsItems.value = {}
}

// 应用"精简显示"预设
const applyMinimalPreset = () => {
  const allKeys = getAllSettingKeys()
  const minimalHiddenKeys: string[] = [SETTINGS_MENU_KEY.proxies, SETTINGS_MENU_KEY.connections]

  // 隐藏不常用/高级设置项
  for (const key of allKeys) {
    if (key.includes('emoji') || key.includes('language')) {
      minimalHiddenKeys.push(key)
    }
    // UDP 相关设置
    else if (key.includes('autoDisconnectIdleUDP') || key.includes('autoDisconnectIdleUDPTime')) {
      minimalHiddenKeys.push(key)
    }
    // 滚动动画效果、滑动切换相关
    else if (
      key.includes('scrollAnimationEffect') ||
      key.includes('swipeInPages') ||
      key.includes('swipeInTabs') ||
      key.includes('disablePullToRefresh')
    ) {
      minimalHiddenKeys.push(key)
    }
    // 其他不常用选项
    else if (
      key.includes('displayAllFeatures') ||
      key.includes('IPInfoAPI') ||
      key.includes('numberOfChartsInSidebar') ||
      key.includes('proxyGroupIconSize') ||
      key.includes('proxyGroupIconMargin') ||
      key.includes('proxyPreviewType') ||
      key.includes('proxyCardSize') ||
      key.includes('twoColumnProxyGroup')
    ) {
      minimalHiddenKeys.push(key)
    }
  }

  // 设置隐藏项
  const newHiddenItems: Record<string, boolean> = {}
  for (const key of minimalHiddenKeys) {
    newHiddenItems[key] = true
  }
  hiddenSettingsItems.value = newHiddenItems
}
</script>

<style scoped>
.ghost {
  opacity: 0.5;
}
</style>
