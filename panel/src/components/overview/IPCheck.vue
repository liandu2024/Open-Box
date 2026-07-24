<template>
  <div class="bg-base-200/50 relative flex h-28 flex-col gap-1 rounded-lg p-2">
    <div class="grid grid-cols-[auto_auto_1fr] gap-x-2 gap-y-1">
      <div class="text-left text-sm">ipip.net</div>
      <div class="text-right text-sm">:</div>
      <div class="text-sm">
        {{ showPrivacy ? ipForChina.ipWithPrivacy[0] : ipForChina.ip[0] }}
        <span
          class="text-xs"
          v-if="ipForChina.ip[1]"
        >
          ({{ showPrivacy ? ipForChina.ipWithPrivacy[1] : ipForChina.ip[1] }})
        </span>
      </div>
      <div class="text-left text-sm">{{ IPInfoAPI }}</div>
      <div class="text-right text-sm">:</div>
      <div class="text-sm">
        {{ showPrivacy ? ipForGlobal.ipWithPrivacy[0] : ipForGlobal.ip[0] }}
        <span
          class="text-xs"
          v-if="ipForGlobal.ip[1]"
        >
          ({{ showPrivacy ? ipForGlobal.ipWithPrivacy[1] : ipForGlobal.ip[1] }})
        </span>
      </div>
    </div>

    <div class="absolute right-2 bottom-2 flex items-center gap-2">
      <button
        class="btn btn-circle btn-sm flex items-center justify-center"
        @click="showPrivacy = !showPrivacy"
        @mouseenter="handlerShowPrivacyTip"
      >
        <EyeIcon
          v-if="showPrivacy"
          class="h-4 w-4"
        />
        <EyeSlashIcon
          v-else
          class="h-4 w-4"
        />
      </button>
      <button
        class="btn btn-circle btn-sm"
        @click="getIPs"
      >
        <BoltIcon class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getIPFromIpipnetAPI, getIPInfo } from '@/api/geoip'
import { ipForChina, ipForGlobal } from '@/composables/overview'
import { useTooltip } from '@/helper/tooltip'
import { autoIPCheck, IPInfoAPI } from '@/store/settings'
import { BoltIcon, EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline'
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const showPrivacy = ref(false)
const { showTip } = useTooltip()
const handlerShowPrivacyTip = (e: Event) => {
  showTip(e, t('ipScreenshotTip'))
}

const QUERYING_IP_INFO = {
  ip: [t('getting'), ''],
  ipWithPrivacy: [t('getting'), ''],
}

const FAILED_IP_INFO = {
  ip: [t('testFailed'), ''],
  ipWithPrivacy: [t('testFailed'), ''],
}

const getIPs = () => {
  ipForChina.value = {
    ...QUERYING_IP_INFO,
  }
  ipForGlobal.value = {
    ...QUERYING_IP_INFO,
  }
  getIPInfo()
    .then((res) => {
      ipForGlobal.value = {
        ipWithPrivacy: [`${res.country} ${res.organization}`, res.ip],
        ip: [`${res.country} ${res.organization}`, '***.***.***.***'],
      }
    })
    .catch(() => {
      ipForGlobal.value = {
        ...FAILED_IP_INFO,
      }
    })
  getIPFromIpipnetAPI()
    .then((res) => {
      ipForChina.value = {
        ipWithPrivacy: [res.data.location.join(' '), res.data.ip],
        ip: [`${res.data.location[0]} ** ** **`, '***.***.***.***'],
      }
    })
    .catch(() => {
      ipForChina.value = {
        ...FAILED_IP_INFO,
      }
    })
}

watch(IPInfoAPI, () => {
  if ([ipForChina, ipForGlobal].some((item) => item.value.ip.length !== 0)) {
    getIPs()
  }
})

onMounted(() => {
  if (autoIPCheck.value && [ipForChina, ipForGlobal].some((item) => item.value.ip.length === 0)) {
    getIPs()
  }
})
</script>
