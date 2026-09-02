<template>
  <!-- backend -->
  <div
    v-if="hasVisibleItems"
    class="settings-section flex flex-col gap-2 p-4 text-sm"
  >
    <div class="settings-title">
      <div class="indicator">
        <span
          v-if="isCoreUpdateAvailable"
          class="indicator-item top-1 -right-1 flex"
        >
          <span class="bg-secondary absolute h-2 w-2 animate-ping rounded-full"></span>
          <span class="bg-secondary h-2 w-2 rounded-full"></span>
        </span>
        <a
          class="flex cursor-pointer items-center gap-2"
          :href="
            isSingBox
              ? 'https://github.com/sagernet/sing-box'
              : 'https://github.com/metacubex/mihomo'
          "
          target="_blank"
        >
          {{ $t('backend') }}
          <BackendVersion class="text-sm font-normal" />
        </a>
      </div>
    </div>
    <template v-if="!isSingBox && configs && isVisiblePorts">
      <div
        class="grid max-w-3xl gap-2 gap-x-6"
        :style="`grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));`"
      >
        <div
          class="setting-item"
          v-for="portConfig in portList"
          :key="portConfig.key"
        >
          <div class="setting-item-label">
            {{ $t(portConfig.label) }}
          </div>
          <input
            class="input input-sm w-20 sm:w-24"
            type="number"
            v-model="configs[portConfig.key as keyof Config]"
            @change="
              updateConfigs({ [portConfig.key]: Number(configs[portConfig.key as keyof Config]) })
            "
          />
        </div>
      </div>
      <div
        class="grid max-w-3xl gap-2 gap-x-6"
        :style="`grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));`"
      >
        <div
          v-if="configs?.tun && isVisibleTunMode"
          class="setting-item"
        >
          <div class="setting-item-label">
            {{ $t('tunMode') }}
          </div>
          <input
            class="toggle"
            type="checkbox"
            v-model="configs.tun.enable"
            @change="hanlderTunModeChange"
          />
        </div>
        <div
          v-if="isVisibleAllowLan"
          class="setting-item"
        >
          <div class="setting-item-label">
            {{ $t('allowLan') }}
          </div>
          <input
            class="toggle"
            type="checkbox"
            v-model="configs['allow-lan']"
            @change="handlerAllowLanChange"
          />
        </div>
        <div
          v-if="isVisibleCheckUpgrade"
          class="setting-item"
        >
          <div class="setting-item-label">
            {{ $t('checkUpgrade') }}
          </div>
          <input
            class="toggle"
            type="checkbox"
            v-model="checkUpgradeCore"
            @change="handlerCheckUpgradeCoreChange"
          />
        </div>
        <div
          v-if="checkUpgradeCore && isVisibleAutoUpgrade"
          class="setting-item"
        >
          <div class="setting-item-label">
            {{ $t('autoUpgrade') }}
          </div>
          <input
            class="toggle"
            type="checkbox"
            v-model="autoUpgradeCore"
          />
        </div>
      </div>
    </template>

    <div
      v-if="isVisibleActions"
      class="grid max-w-6xl gap-2 gap-y-3"
      :style="`grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));`"
    >
      <button
        class="btn btn-sm"
        @click="handleFlushDNSCache"
      >
        {{ $t('flushDNSCache') }}
      </button>
    </div>
    <DnsQuery v-if="isVisibleDnsQuery" />
  </div>
</template>

<script setup lang="ts">
import { flushDNSCacheAPI, isCoreUpdateAvailable, isSingBox } from '@/api'
import BackendVersion from '@/components/common/BackendVersion.vue'
import DnsQuery from '@/components/settings/DnsQuery.vue'
import { useIsSettingVisible } from '@/composables/settings'
import { BACKEND_ITEM_KEYS } from '@/config/settingsItems'
import { showNotification } from '@/helper/notification'
import { configs, updateConfigs } from '@/store/config'
import { autoUpgradeCore, checkUpgradeCore } from '@/store/settings'
import type { Config } from '@/types'
import { computed } from 'vue'

const k = BACKEND_ITEM_KEYS
const isVisiblePorts = useIsSettingVisible(k.ports)
const isVisibleTunMode = useIsSettingVisible(k.tunMode)
const isVisibleAllowLan = useIsSettingVisible(k.allowLan)
const isVisibleCheckUpgrade = useIsSettingVisible(k.checkUpgrade)
const isVisibleAutoUpgrade = useIsSettingVisible(k.autoUpgrade)
const isVisibleActions = useIsSettingVisible(k.actions)
const isVisibleDnsQuery = useIsSettingVisible(k.DNSQuery)

const hasVisibleItems = computed(() => {
  return (
    (!isSingBox.value && configs.value && isVisiblePorts.value) ||
    (!isSingBox.value && configs.value?.tun && isVisibleTunMode.value) ||
    (!isSingBox.value && configs.value && isVisibleAllowLan.value) ||
    (!isSingBox.value && configs.value && isVisibleCheckUpgrade.value) ||
    (!isSingBox.value && configs.value && checkUpgradeCore.value && isVisibleAutoUpgrade.value) ||
    isVisibleActions.value ||
    isVisibleDnsQuery.value
  )
})

const portList = [
  {
    label: 'mixedPort',
    key: 'mixed-port',
  },
  {
    label: 'httpPort',
    key: 'port',
  },
  {
    label: 'socksPort',
    key: 'socks-port',
  },
  {
    label: 'redirPort',
    key: 'redir-port',
  },
  {
    label: 'tproxyPort',
    key: 'tproxy-port',
  },
]

const handlerCheckUpgradeCoreChange = () => {
  if (!checkUpgradeCore.value) {
    autoUpgradeCore.value = false
    isCoreUpdateAvailable.value = false
  }
}

const hanlderTunModeChange = async () => {
  await updateConfigs({ tun: { enable: configs.value?.tun.enable } })
}
const handlerAllowLanChange = async () => {
  await updateConfigs({ ['allow-lan']: configs.value?.['allow-lan'] })
}

const handleFlushDNSCache = async () => {
  await flushDNSCacheAPI()
  showNotification({
    content: 'flushDNSCacheSuccess',
    type: 'alert-success',
  })
}

</script>
