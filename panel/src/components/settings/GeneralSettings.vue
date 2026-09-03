<template>
  <ChangePasswordDialog v-model="isChangePasswordDialogOpen" />
  <!-- 「通用」这一块只有一个网格:语言/圆角/背景/主题在 ZashboardSettings 里,
       下面这几行通过插槽排进同一个网格,行距才一致 -->
  <ZashboardSettings>
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
  </ZashboardSettings>
</template>

<script setup lang="ts">
import { useIsSettingVisible } from '@/composables/settings'
import { GENERAL_ITEM_KEYS } from '@/config/settingsItems'
import { IP_INFO_API } from '@/constant'
import { useTooltip } from '@/helper/tooltip'
import {
  disablePullToRefresh,
  IPInfoAPI,
  scrollAnimationEffect,
  swipeInPages,
  swipeInTabs,
} from '@/store/settings'
import { QuestionMarkCircleIcon } from '@heroicons/vue/24/outline'
import { ref } from 'vue'
import ChangePasswordDialog from './ChangePasswordDialog.vue'
import ZashboardSettings from './ZashboardSettings.vue'

const { showTip } = useTooltip()

const k = GENERAL_ITEM_KEYS
const isVisibleChangePassword = useIsSettingVisible(k.changePassword)
const isVisibleIPInfoAPI = useIsSettingVisible(k.IPInfoAPI)
const isVisibleScrollAnimationEffect = useIsSettingVisible(k.scrollAnimationEffect)
const isVisibleSwipeInPages = useIsSettingVisible(k.swipeInPages)
const isVisibleSwipeInTabs = useIsSettingVisible(k.swipeInTabs)
const isVisibleDisablePullToRefresh = useIsSettingVisible(k.disablePullToRefresh)
const isChangePasswordDialogOpen = ref(false)
</script>
