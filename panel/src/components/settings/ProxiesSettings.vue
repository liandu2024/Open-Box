<template>
  <div class="settings-section flex flex-col gap-2 p-4 text-sm">
    <template v-if="hasVisibleLatencyItems">
      <div class="settings-title">
        {{ $t('latency') }}
      </div>
      <div class="settings-grid">
        <div
          v-if="isVisibleSpeedtestTimeout"
          class="setting-item"
        >
          <div class="setting-item-label">
            {{ $t('speedtestTimeout') }}
          </div>
          <input
            type="number"
            class="input input-sm w-20"
            v-model="speedtestTimeout"
          />
          ms
        </div>
        <div
          v-if="isVisibleLowLatency"
          class="setting-item"
        >
          <div class="setting-item-label">
            {{ $t('lowLatencyDesc') }}
          </div>
          <input
            type="number"
            class="input input-sm w-20"
            v-model="lowLatency"
          />
          ms
        </div>
        <div
          v-if="isVisibleMediumLatency"
          class="setting-item"
        >
          <div class="setting-item-label">
            {{ $t('mediumLatencyDesc') }}
          </div>
          <input
            type="number"
            class="input input-sm w-20"
            v-model="mediumLatency"
          />
          ms
        </div>
        <div
          v-if="isVisibleIpv6Test"
          class="setting-item"
        >
          <div class="setting-item-label">
            {{ $t('ipv6Test') }}
          </div>
          <input
            class="toggle"
            type="checkbox"
            v-model="IPv6test"
          />
        </div>
      </div>
    </template>
    <!-- 布局:代理组分几列(GitHub #10) -->
    <template v-if="isVisibleProxyGroupColumns">
      <div class="settings-title">
        {{ $t('proxyGroupLayout') }}
      </div>
      <div class="settings-grid">
        <div class="setting-item">
          <div class="setting-item-label">
            {{ $t('proxyGroupColumns') }}
          </div>
          <select
            class="select select-sm w-28"
            v-model.number="proxyGroupColumns"
          >
            <option
              v-for="n in [1, 2, 3]"
              :key="n"
              :value="n"
            >
              {{ $t(`proxyGroupColumns${n}`) }}
            </option>
          </select>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useIsSettingVisible } from '@/composables/settings'
import { PROXIES_ITEM_KEYS } from '@/config/settingsItems'
import {
  IPv6test,
  lowLatency,
  mediumLatency,
  proxyGroupColumns,
  speedtestTimeout,
} from '@/store/settings'
import { computed } from 'vue'

const k = PROXIES_ITEM_KEYS
const isVisibleSpeedtestTimeout = useIsSettingVisible(k.speedtestTimeout)
const isVisibleLowLatency = useIsSettingVisible(k.lowLatencyDesc)
const isVisibleMediumLatency = useIsSettingVisible(k.mediumLatencyDesc)
const isVisibleIpv6Test = useIsSettingVisible(k.ipv6Test)
const isVisibleProxyGroupColumns = useIsSettingVisible(k.proxyGroupColumns)

const hasVisibleLatencyItems = computed(() => {
  return (
    isVisibleSpeedtestTimeout.value ||
    isVisibleLowLatency.value ||
    isVisibleMediumLatency.value ||
    isVisibleIpv6Test.value
  )
})

</script>
