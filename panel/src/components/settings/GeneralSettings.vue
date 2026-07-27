<template>
  <ZashboardSettings />
  <ChangePasswordDialog v-model="isChangePasswordDialogOpen" />
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
        v-if="isVisibleChangePassword"
        class="setting-item"
      >
        <div class="setting-item-label">
          {{ $t('changePassword') }}
        </div>
        <button
          type="button"
          class="btn btn-sm"
          @click="isChangePasswordDialogOpen = true"
        >
          {{ $t('changePassword') }}
        </button>
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
  autoDisconnectIdleUDP,
  autoDisconnectIdleUDPTime,
  disablePullToRefresh,
  displayAllFeatures,
  IPInfoAPI,
  scrollAnimationEffect,
  swipeInPages,
  swipeInTabs,
} from '@/store/settings'
import { QuestionMarkCircleIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import ChangePasswordDialog from './ChangePasswordDialog.vue'
import ZashboardSettings from './ZashboardSettings.vue'

const { showTip } = useTooltip()

const k = GENERAL_ITEM_KEYS
const isVisibleAutoDisconnectIdleUDP = useIsSettingVisible(k.autoDisconnectIdleUDP)
const isVisibleChangePassword = useIsSettingVisible(k.changePassword)
const isVisibleAutoDisconnectIdleUDPTime = useIsSettingVisible(k.autoDisconnectIdleUDPTime)
const isVisibleIPInfoAPI = useIsSettingVisible(k.IPInfoAPI)
const isVisibleScrollAnimationEffect = useIsSettingVisible(k.scrollAnimationEffect)
const isVisibleSwipeInPages = useIsSettingVisible(k.swipeInPages)
const isVisibleSwipeInTabs = useIsSettingVisible(k.swipeInTabs)
const isVisibleDisablePullToRefresh = useIsSettingVisible(k.disablePullToRefresh)
const isVisibleDisplayAllFeatures = useIsSettingVisible(k.displayAllFeatures)
const isChangePasswordDialogOpen = ref(false)

const hasVisibleGeneralItems = computed(() => {
  return (
    isVisibleAutoDisconnectIdleUDP.value ||
    isVisibleChangePassword.value ||
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
