<template>
  <ZashboardSettings />
  <!-- dashboard -->
  <div
    v-if="hasVisibleGeneralItems"
    class="settings-section p-4 text-sm"
  >
    <div class="settings-title">
      {{ $t('general') }}
    </div>
    <div class="settings-grid">
      <div
        v-if="isVisibleAutoDisconnectIdleUDP"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('autoDisconnectIdleUDP') }}
          <QuestionMarkCircleIcon
            class="h-4 w-4 cursor-pointer"
            @mouseenter="showTip($event, $t('autoDisconnectIdleUDPTip'))"
          />
        </div>
        <input
          type="checkbox"
          v-model="autoDisconnectIdleUDP"
          class="toggle"
        />
      </div>
      <div
        v-if="isVisiblePasswordAccess || (accessPasswordEnabled && isVisibleAccessPassword)"
        class="setting-item"
      >
        <div class="setting-item-label">
          <span>{{ $t('passwordAccess') }}</span>
          <QuestionMarkCircleIcon
            v-if="isVisiblePasswordAccess"
            class="h-4 w-4 cursor-pointer"
            @mouseenter="showTip($event, $t('passwordAccessTip'))"
          />
          <input
            v-if="isVisiblePasswordAccess"
            type="checkbox"
            v-model="accessPasswordEnabled"
            class="toggle ml-2"
          />
        </div>
        <label
          v-if="accessPasswordEnabled && isVisibleAccessPassword"
          class="input input-sm flex w-40 items-center gap-2"
        >
          <input
            :type="showAccessPassword ? 'text' : 'password'"
            class="grow"
            v-model="accessPasswordDraft"
            :placeholder="$t('accessPassword')"
            @blur="commitAccessPassword"
            @keydown.enter="commitAccessPassword"
          />
          <button
            type="button"
            class="text-base-content/60 hover:text-base-content flex items-center"
            @click="showAccessPassword = !showAccessPassword"
          >
            <EyeIcon
              v-if="showAccessPassword"
              class="h-4 w-4"
            />
            <EyeSlashIcon
              v-else
              class="h-4 w-4"
            />
          </button>
        </label>
      </div>
      <div
        v-if="autoDisconnectIdleUDP && isVisibleAutoDisconnectIdleUDPTime"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('autoDisconnectIdleUDPTime') }}
        </div>
        <input
          type="number"
          class="input input-sm w-20"
          v-model="autoDisconnectIdleUDPTime"
        />
        mins
      </div>
      <div
        v-if="isVisibleIPInfoAPI"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('IPInfoAPI') }}
          <QuestionMarkCircleIcon
            class="h-4 w-4 cursor-pointer"
            @mouseenter="showTip($event, $t('IPInfoAPITip'))"
          />
        </div>
        <select
          class="select select-sm min-w-24"
          v-model="IPInfoAPI"
        >
          <option
            v-for="opt in Object.values(IP_INFO_API)"
            :key="opt"
            :value="opt"
          >
            {{ opt }}
          </option>
        </select>
      </div>

      <div
        v-if="isVisibleScrollAnimationEffect"
        class="setting-item md:hidden!"
      >
        <div class="setting-item-label">
          {{ $t('scrollAnimationEffect') }}
        </div>
        <input
          type="checkbox"
          v-model="scrollAnimationEffect"
          class="toggle"
        />
      </div>
      <div
        v-if="isVisibleSwipeInPages"
        class="setting-item md:hidden!"
      >
        <div class="setting-item-label">
          {{ $t('swipeInPages') }}
        </div>
        <input
          type="checkbox"
          v-model="swipeInPages"
          class="toggle"
        />
      </div>
      <div
        v-if="swipeInPages && isVisibleSwipeInTabs"
        class="setting-item md:hidden!"
      >
        <div class="setting-item-label">
          {{ $t('swipeInTabs') }}
        </div>
        <input
          type="checkbox"
          v-model="swipeInTabs"
          class="toggle"
        />
      </div>
      <div
        v-if="isVisibleDisablePullToRefresh"
        class="setting-item md:hidden!"
      >
        <div class="setting-item-label">
          {{ $t('disablePullToRefresh') }}
          <QuestionMarkCircleIcon
            class="h-4 w-4 cursor-pointer"
            @mouseenter="showTip($event, $t('disablePullToRefreshTip'))"
          />
        </div>
        <input
          type="checkbox"
          v-model="disablePullToRefresh"
          class="toggle"
        />
      </div>
      <div
        v-if="isSingBox && isVisibleDisplayAllFeatures"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('displayAllFeatures') }}
          <QuestionMarkCircleIcon
            class="h-4 w-4 cursor-pointer"
            @mouseenter="showTip($event, $t('displayAllFeaturesTip'))"
          />
        </div>
        <input
          type="checkbox"
          v-model="displayAllFeatures"
          class="toggle"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { isSingBox } from '@/api'
import { useIsSettingVisible } from '@/composables/settings'
import { GENERAL_ITEM_KEYS } from '@/config/settingsItems'
import { IP_INFO_API } from '@/constant'
import { useTooltip } from '@/helper/tooltip'
import {
  accessPassword,
  accessPasswordEnabled,
  autoDisconnectIdleUDP,
  autoDisconnectIdleUDPTime,
  disablePullToRefresh,
  displayAllFeatures,
  IPInfoAPI,
  scrollAnimationEffect,
  setAccessAuthenticated,
  swipeInPages,
  swipeInTabs,
} from '@/store/settings'
import { EyeIcon, EyeSlashIcon, QuestionMarkCircleIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import ZashboardSettings from './ZashboardSettings.vue'

const { showTip } = useTooltip()

const k = GENERAL_ITEM_KEYS
const isVisibleAutoDisconnectIdleUDP = useIsSettingVisible(k.autoDisconnectIdleUDP)
const isVisiblePasswordAccess = useIsSettingVisible(k.passwordAccess)
const isVisibleAccessPassword = useIsSettingVisible(k.accessPassword)
const isVisibleAutoDisconnectIdleUDPTime = useIsSettingVisible(k.autoDisconnectIdleUDPTime)
const isVisibleIPInfoAPI = useIsSettingVisible(k.IPInfoAPI)
const isVisibleScrollAnimationEffect = useIsSettingVisible(k.scrollAnimationEffect)
const isVisibleSwipeInPages = useIsSettingVisible(k.swipeInPages)
const isVisibleSwipeInTabs = useIsSettingVisible(k.swipeInTabs)
const isVisibleDisablePullToRefresh = useIsSettingVisible(k.disablePullToRefresh)
const isVisibleDisplayAllFeatures = useIsSettingVisible(k.displayAllFeatures)
const showAccessPassword = ref(false)
const accessPasswordDraft = ref(accessPassword.value)

watch(accessPasswordEnabled, (enabled) => {
  if (!enabled) {
    setAccessAuthenticated(false)
    return
  }

  setAccessAuthenticated(false)
})

watch(accessPassword, (value) => {
  accessPasswordDraft.value = value

  if (!accessPasswordEnabled.value) {
    return
  }

  setAccessAuthenticated(false)
})

const commitAccessPassword = () => {
  if (accessPasswordDraft.value === accessPassword.value) {
    return
  }

  accessPassword.value = accessPasswordDraft.value
}

const hasVisibleGeneralItems = computed(() => {
  return (
    isVisibleAutoDisconnectIdleUDP.value ||
    isVisiblePasswordAccess.value ||
    (accessPasswordEnabled.value && isVisibleAccessPassword.value) ||
    (autoDisconnectIdleUDP.value && isVisibleAutoDisconnectIdleUDPTime.value) ||
    isVisibleIPInfoAPI.value ||
    isVisibleScrollAnimationEffect.value ||
    isVisibleSwipeInPages.value ||
    (swipeInPages.value && isVisibleSwipeInTabs.value) ||
    isVisibleDisablePullToRefresh.value ||
    (isSingBox.value && isVisibleDisplayAllFeatures.value)
  )
})
</script>
