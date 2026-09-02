<template>
  <!-- dashboard -->
  <div
    v-if="hasVisibleItems"
    class="settings-section relative flex flex-col gap-2 p-4 text-sm"
  >
    <!-- 标题就是「通用」:这块(语言/圆角/背景/主题)和下面 GeneralSettings 的几行合成一组 -->
    <div class="settings-title">
      {{ $t('general') }}
      <button
        class="btn btn-sm absolute top-4 right-4"
        @click="refreshPages"
        v-if="isPWA"
      >
        {{ $t('refresh') }}
        <ArrowPathIcon class="h-4 w-4" />
      </button>
    </div>
    <div class="settings-grid">
      <LanguageSelect v-if="isVisibleLanguage" />
      <div
        v-if="isVisibleCustomBackgroundURL"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('customBackgroundURL') }}
        </div>
        <div
          class="join"
          :class="isBackgroundDragOver ? 'ring-primary rounded-field ring-1' : ''"
          @dragenter.prevent="isBackgroundDragOver = true"
          @dragover.prevent="isBackgroundDragOver = true"
          @dragleave.prevent="handleBackgroundDragLeave"
          @drop.prevent="handleBackgroundDrop"
        >
          <TextInput
            class="join-item w-38"
            v-model="customBackgroundURL"
            :clearable="true"
            @update:modelValue="handlerBackgroundURLChange"
          />
          <button
            class="btn join-item btn-sm"
            @click="handlerClickUpload"
          >
            <ArrowUpTrayIcon class="h-4 w-4" />
          </button>
        </div>
        <button
          class="btn btn-circle join-item btn-sm"
          v-if="customBackgroundURL"
          @click="displayBgProperty = !displayBgProperty"
        >
          <AdjustmentsHorizontalIcon class="h-4 w-4" />
        </button>
        <input
          ref="inputFileRef"
          type="file"
          accept="image/*"
          class="hidden"
          @change="handlerFileChange"
        />
      </div>
      <template v-if="customBackgroundURL && displayBgProperty && isVisibleTransparent">
        <div class="setting-item">
          <div class="setting-item-label">
            {{ $t('transparent') }}
          </div>
          <input
            type="range"
            min="0"
            max="100"
            v-model="dashboardTransparent"
            class="range max-w-64"
            @touchstart.passive.stop
            @touchmove.passive.stop
            @touchend.passive.stop
          />
        </div>
      </template>
      <template v-if="customBackgroundURL && displayBgProperty && isVisibleBlurIntensity">
        <div class="setting-item">
          <div class="setting-item-label">
            {{ $t('blurIntensity') }}
          </div>
          <input
            type="range"
            min="0"
            max="40"
            v-model="blurIntensity"
            class="range max-w-64"
            @touchstart.stop
            @touchmove.stop
            @touchend.stop
          />
        </div>
      </template>
      <div
        v-if="isVisibleGlobalRadius"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('globalRadius') }}
        </div>
        <div class="join radius-stepper max-w-64">
          <button
            class="btn btn-sm join-item min-w-12 px-0 text-xl"
            @click="adjustGlobalRadius(-1)"
            :disabled="globalRadius <= 0"
          >
            -
          </button>
          <div
            class="input input-sm join-item pointer-events-none min-w-24 flex-1 justify-center text-center text-base font-medium"
          >
            {{ globalRadius }}px
          </div>
          <button
            class="btn btn-sm join-item min-w-12 px-0 text-xl"
            @click="adjustGlobalRadius(1)"
            :disabled="globalRadius >= 24"
          >
            +
          </button>
        </div>
      </div>
      <div
        v-if="isVisibleTheme"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('theme') }}
        </div>
        <select
          class="select select-sm w-48"
          v-model="themeMode"
        >
          <option
            v-for="mode in THEME_MODES"
            :key="mode"
            :value="mode"
          >
            {{ $t(`themeMode_${mode}`) }}
          </option>
        </select>
      </div>
      <!-- GeneralSettings 把它的几行(空闲 UDP / 修改密码 / IP 信息 API)放进来,和上面同一个网格 -->
      <slot />
    </div>
    <!-- 「更新面板 / 自动更新」已去掉:面板由 Open-Box 自己发布,sing-box 也没有 /upgrade/ui 接口 -->
  </div>
</template>

<script setup lang="ts">
import LanguageSelect from '@/components/settings/LanguageSelect.vue'
import { useIsSettingVisible } from '@/composables/settings'
import { GENERAL_ITEM_KEYS } from '@/config/settingsItems'
import { deleteBase64FromIndexedDB, LOCAL_IMAGE, saveBase64ToIndexedDB } from '@/helper/indexeddb'
import { isPWA } from '@/helper/utils'
import {
  themeMode,
  THEME_MODES,
  blurIntensity,
  customBackgroundURL,
  dashboardTransparent,
  globalRadius,
} from '@/store/settings'
import { AdjustmentsHorizontalIcon, ArrowPathIcon, ArrowUpTrayIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import TextInput from '../common/TextInput.vue'

const k = GENERAL_ITEM_KEYS
const isVisibleLanguage = useIsSettingVisible(k.language)
const isVisibleCustomBackgroundURL = useIsSettingVisible(k.customBackgroundURL)
const isVisibleTransparent = useIsSettingVisible(k.transparent)
const isVisibleBlurIntensity = useIsSettingVisible(k.blurIntensity)
const isVisibleGlobalRadius = useIsSettingVisible(k.globalRadius)
const isVisibleTheme = useIsSettingVisible(k.defaultTheme)

const displayBgProperty = ref(false)
const isBackgroundDragOver = ref(false)

const hasVisibleItems = computed(() => {
  return (
    isVisibleLanguage.value ||
    isVisibleCustomBackgroundURL.value ||
    (customBackgroundURL.value && displayBgProperty.value && isVisibleTransparent.value) ||
    (customBackgroundURL.value && displayBgProperty.value && isVisibleBlurIntensity.value) ||
    isVisibleGlobalRadius.value ||
    isVisibleTheme.value
  )
})

const adjustGlobalRadius = (step: number) => {
  const currentValue = Number(globalRadius.value || 0)
  globalRadius.value = Math.min(24, Math.max(0, currentValue + step))
}

watch(customBackgroundURL, (value) => {
  if (value) {
    displayBgProperty.value = true
  }
})

const inputFileRef = ref()
const handlerClickUpload = () => {
  inputFileRef.value?.click()
}

const handlerBackgroundURLChange = async () => {
  if (!customBackgroundURL.value.includes(LOCAL_IMAGE)) {
    await deleteBase64FromIndexedDB()
  }
}

const applyBackgroundFile = async (file?: File | null) => {
  if (!file) return

  if (!file.type.startsWith('image/')) {
    return
  }

  const reader = new FileReader()
  reader.onload = async () => {
    await saveBase64ToIndexedDB(reader.result as string)
    customBackgroundURL.value = LOCAL_IMAGE + '-' + Date.now()
  }
  reader.readAsDataURL(file)
}

const handlerFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  await applyBackgroundFile(file)
  ;(e.target as HTMLInputElement).value = ''
}

const handleBackgroundDragLeave = (event: DragEvent) => {
  const currentTarget = event.currentTarget as HTMLElement | null
  const relatedTarget = event.relatedTarget as Node | null

  if (!currentTarget || (relatedTarget && currentTarget.contains(relatedTarget))) {
    return
  }

  isBackgroundDragOver.value = false
}

const handleBackgroundDrop = async (event: DragEvent) => {
  isBackgroundDragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  await applyBackgroundFile(file)
}


const refreshPages = async () => {
  const registrations = await navigator.serviceWorker.getRegistrations()

  for (const registration of registrations) {
    registration.unregister()
  }
  window.location.reload()
}
</script>
