<template>
  <!-- dashboard -->
  <div
    v-if="hasVisibleItems"
    class="settings-section relative flex flex-col gap-2 p-4 text-sm"
  >
    <div class="settings-title">
      <div class="indicator">
        <span
          v-if="isUIUpdateAvailable"
          class="indicator-item top-1 -right-1 flex"
        >
          <span class="bg-secondary absolute h-2 w-2 animate-ping rounded-full"></span>
          <span class="bg-secondary h-2 w-2 rounded-full"></span>
        </span>
        <a
          href="https://github.com/liandu2024/AnGe-ClashBoard"
          target="_blank"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap"
        >
          <span>AnGe-ClashBoard</span>
          <span class="text-sm font-normal">{{ displayVersion }}</span>
          <span class="text-base-content/70 text-xs">{{ $t('basedOnZashboard') }}</span>
        </a>
      </div>
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
        v-if="isVisibleFonts"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('fonts') }}
        </div>
        <select
          class="select select-sm w-48"
          v-model="font"
        >
          <option
            v-for="opt in fontOptions"
            :key="opt"
            :value="opt"
          >
            {{ opt }}
          </option>
        </select>
      </div>
      <div
        v-if="isVisibleEmoji"
        class="setting-item"
      >
        <div class="setting-item-label">Emoji</div>
        <select
          class="select select-sm w-48"
          v-model="emoji"
        >
          <option
            v-for="opt in Object.values(EMOJIS)"
            :key="opt"
            :value="opt"
          >
            {{ opt }}
          </option>
        </select>
      </div>
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
        v-if="isVisibleDefaultTheme"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('defaultTheme') }}
        </div>
        <div class="join">
          <ThemeSelector
            class="w-38!"
            v-model:value="defaultTheme"
          />
          <button
            class="btn btn-sm join-item"
            @click="customThemeModal = !customThemeModal"
          >
            <PlusIcon class="h-4 w-4" />
          </button>
        </div>
        <CustomTheme v-model:value="customThemeModal" />
      </div>
      <div
        v-if="autoTheme && isVisibleDarkTheme"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('darkTheme') }}
        </div>
        <ThemeSelector v-model:value="darkTheme" />
      </div>
      <div
        v-if="isVisibleAutoSwitchTheme"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('autoSwitchTheme') }}
        </div>
        <input
          type="checkbox"
          v-model="autoTheme"
          class="toggle"
        />
      </div>
      <div
        v-if="isVisibleAutoUpgrade"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('autoUpgrade') }}
        </div>
        <input
          class="toggle"
          type="checkbox"
          v-model="autoUpgrade"
        />
      </div>
    </div>
    <div
      v-if="isVisibleUpgradeUI || isVisibleExportSettings || isVisibleImportSettings"
      class="mt-4 grid max-w-3xl grid-cols-2 gap-2 gap-y-3 md:grid-cols-4"
    >
      <button
        v-if="isVisibleUpgradeUI"
        :class="twMerge('btn btn-primary btn-sm', isUIUpgrading ? 'animate-pulse' : '')"
        @click="handlerClickUpgradeUI"
      >
        {{ $t('upgradeUI') }}
      </button>
      <div
        v-if="isVisibleUpgradeUI"
        class="sm:hidden"
      ></div>

      <button
        v-if="isVisibleExportSettings"
        class="btn btn-sm"
        @click="openExportDialog"
      >
        {{ $t('exportSettings') }}
      </button>
      <ImportSettings v-if="isVisibleImportSettings" />
    </div>
    <DialogWrapper
      v-model="exportDialogShow"
      :title="$t('exportSettings')"
      box-class="max-w-md"
    >
      <div class="flex flex-col gap-4">
        <label class="flex cursor-pointer items-start gap-3">
          <input
            v-model="desensitizedExport"
            type="checkbox"
            class="checkbox checkbox-sm mt-0.5"
          />
          <div class="space-y-1">
            <div class="font-medium">{{ $t('desensitizedExport') }}</div>
            <p class="text-base-content/70 text-sm">
              {{ $t('desensitizedExportTip') }}
            </p>
          </div>
        </label>
        <div class="flex justify-end gap-2">
          <button
            class="btn btn-ghost btn-sm"
            @click="exportDialogShow = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            class="btn btn-sm"
            @click="handleExportSettings"
          >
            {{ $t('exportSettings') }}
          </button>
        </div>
      </div>
    </DialogWrapper>
  </div>
</template>

<script setup lang="ts">
import { getDisplayAppVersion, upgradeUIAPI, zashboardVersion } from '@/api'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import LanguageSelect from '@/components/settings/LanguageSelect.vue'
import { useIsSettingVisible, useSettings } from '@/composables/settings'
import { GENERAL_ITEM_KEYS } from '@/config/settingsItems'
import { EMOJIS, FONTS } from '@/constant'
import { handlerUpgradeSuccess } from '@/helper'
import { deleteBase64FromIndexedDB, LOCAL_IMAGE, saveBase64ToIndexedDB } from '@/helper/indexeddb'
import { exportSettings, isPWA } from '@/helper/utils'
import {
  autoTheme,
  autoUpgrade,
  blurIntensity,
  customBackgroundURL,
  darkTheme,
  dashboardTransparent,
  defaultTheme,
  emoji,
  font,
  globalRadius,
} from '@/store/settings'
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  PlusIcon,
} from '@heroicons/vue/24/outline'
import { twMerge } from 'tailwind-merge'
import { computed, ref, watch } from 'vue'
import ImportSettings from '../common/ImportSettings.vue'
import TextInput from '../common/TextInput.vue'
import CustomTheme from './CustomTheme.vue'
import ThemeSelector from './ThemeSelector.vue'

const customThemeModal = ref(false)
const k = GENERAL_ITEM_KEYS
const isVisibleLanguage = useIsSettingVisible(k.language)
const isVisibleFonts = useIsSettingVisible(k.fonts)
const isVisibleEmoji = useIsSettingVisible(k.emoji)
const isVisibleCustomBackgroundURL = useIsSettingVisible(k.customBackgroundURL)
const isVisibleTransparent = useIsSettingVisible(k.transparent)
const isVisibleBlurIntensity = useIsSettingVisible(k.blurIntensity)
const isVisibleGlobalRadius = useIsSettingVisible(k.globalRadius)
const isVisibleDefaultTheme = useIsSettingVisible(k.defaultTheme)
const isVisibleDarkTheme = useIsSettingVisible(k.darkTheme)
const isVisibleAutoSwitchTheme = useIsSettingVisible(k.autoSwitchTheme)
const isVisibleAutoUpgrade = useIsSettingVisible(k.autoUpgrade)
const isVisibleUpgradeUI = useIsSettingVisible(k.upgradeUI)
const isVisibleExportSettings = useIsSettingVisible(k.exportSettings)
const isVisibleImportSettings = useIsSettingVisible(k.importSettings)

const displayBgProperty = ref(false)
const isBackgroundDragOver = ref(false)
const exportDialogShow = ref(false)
const desensitizedExport = ref(true)

const hasVisibleItems = computed(() => {
  return (
    isVisibleLanguage.value ||
    isVisibleFonts.value ||
    isVisibleEmoji.value ||
    isVisibleCustomBackgroundURL.value ||
    (customBackgroundURL.value && displayBgProperty.value && isVisibleTransparent.value) ||
    (customBackgroundURL.value && displayBgProperty.value && isVisibleBlurIntensity.value) ||
    isVisibleGlobalRadius.value ||
    isVisibleDefaultTheme.value ||
    (autoTheme.value && isVisibleDarkTheme.value) ||
    isVisibleAutoSwitchTheme.value ||
    isVisibleAutoUpgrade.value ||
    isVisibleUpgradeUI.value ||
    isVisibleExportSettings.value ||
    isVisibleImportSettings.value
  )
})
const displayVersion = computed(() => {
  return getDisplayAppVersion(zashboardVersion.value)
})

const adjustGlobalRadius = (step: number) => {
  const currentValue = Number(globalRadius.value || 0)
  globalRadius.value = Math.min(24, Math.max(0, currentValue + step))
}

const openExportDialog = () => {
  desensitizedExport.value = true
  exportDialogShow.value = true
}

const handleExportSettings = () => {
  exportSettings({
    desensitized: desensitizedExport.value,
  })
  exportDialogShow.value = false
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

const fontOptions = computed(() => {
  const mode = import.meta.env.MODE

  if (Object.values(FONTS).includes(mode as FONTS)) {
    return [mode]
  }

  return Object.values(FONTS)
})

const { isUIUpdateAvailable } = useSettings()

const isUIUpgrading = ref(false)
const handlerClickUpgradeUI = async () => {
  if (isUIUpgrading.value) return
  isUIUpgrading.value = true
  try {
    await upgradeUIAPI()
    isUIUpgrading.value = false
    handlerUpgradeSuccess()
    setTimeout(() => {
      window.location.reload()
    }, 1000)
  } catch {
    isUIUpgrading.value = false
  }
}

const refreshPages = async () => {
  const registrations = await navigator.serviceWorker.getRegistrations()

  for (const registration of registrations) {
    registration.unregister()
  }
  window.location.reload()
}
</script>
