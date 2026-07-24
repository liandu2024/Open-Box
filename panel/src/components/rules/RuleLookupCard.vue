<template>
  <div class="card">
    <div class="app-card-padding flex flex-col gap-3 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <span>{{ index }}.</span>
        <span class="text-main font-medium">
          {{ result.providerName }}
          <span class="text-base-content/55">({{ result.totalRules }})</span>
        </span>
        <span
          v-if="result.behavior"
          class="badge badge-sm"
        >
          {{ result.behavior }}
        </span>
        <span
          v-if="result.format"
          class="badge badge-sm"
        >
          {{ result.format }}
        </span>
      </div>

      <div class="text-base-content/80 flex flex-col gap-1 text-xs">
        <template v-if="result.linkedRules.length > 0">
          <div
            v-for="rule in result.linkedRules"
            :key="`${result.providerName}-${rule.proxy}`"
            class="flex min-h-6 flex-wrap items-center gap-1 md:gap-2"
          >
            <div class="min-w-0 flex-1 overflow-hidden text-sm">
              <ProxyGroupNow
                v-if="showProxyRoute(rule.proxy)"
                v-bind="{ name: rule.proxy, includeSelf: true, forceFullRoute: true }"
              />
              <ProxyName
                v-else
                :name="rule.proxy"
                class="text-base-content/80 text-xs md:text-sm"
              />
            </div>
            <span
              v-if="getLatency(rule.proxy) !== NOT_CONNECTED && displayLatencyInRule"
              :class="getLatencyClass(rule.proxy)"
              class="ml-1 text-xs"
            >
              {{ getLatency(rule.proxy) }}
            </span>
          </div>
        </template>
        <span
          v-else
          class="text-sm"
        >
          {{ t('ruleLookupMissingRuleSet') }}
        </span>
      </div>

      <div class="flex flex-col gap-1 text-sm font-normal">
        <div
          v-for="match in result.matches.slice(0, 10)"
          :key="`${result.providerName}-${match.line}-${match.value}`"
          class="text-base-content/80"
        >
          <span class="font-medium">L{{ match.line }}</span>
          <span class="ml-2">{{ match.mode }}</span>
          <span class="ml-2">{{ match.value }}</span>
        </div>
      </div>

      <div
        v-if="result.url"
        class="text-base-content/70 flex items-center gap-2 text-sm font-normal"
      >
        <a
          :href="result.url"
          target="_blank"
          rel="noreferrer"
          class="link link-hover truncate leading-6"
        >
          {{ result.url }}
        </a>
        <button
          class="btn btn-ghost btn-xs"
          type="button"
          :title="t('copyLink')"
          @click="copyUrl(result.url)"
        >
          <DocumentDuplicateIcon class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NOT_CONNECTED } from '@/constant'
import { getColorForLatency } from '@/helper'
import { showNotification } from '@/helper/notification'
import { getLatencyByName, proxyMap } from '@/store/proxies'
import { displayLatencyInRule, displayNowNodeInRule } from '@/store/settings'
import type { Rule } from '@/types'
import { DocumentDuplicateIcon } from '@heroicons/vue/24/outline'
import { useI18n } from 'vue-i18n'
import ProxyGroupNow from '../proxies/ProxyGroupNow.vue'
import ProxyName from '../proxies/ProxyName.vue'

const { t } = useI18n()

defineProps<{
  index: number
  result: {
    providerName: string
    behavior: string
    format: string
    url: string
    totalRules: number
    matches: {
      line: number
      value: string
      mode: string
      raw: string
    }[]
    linkedRules: Rule[]
  }
}>()

const showProxyRoute = (proxyName: string) => {
  return displayNowNodeInRule.value && Boolean(proxyMap.value[proxyName]?.now)
}

const getLatency = (proxyName: string) => {
  return getLatencyByName(proxyName, proxyName)
}

const getLatencyClass = (proxyName: string) => {
  return getColorForLatency(Number(getLatency(proxyName)))
}

const copyUrl = async (url: string) => {
  try {
    await navigator.clipboard.writeText(url)
    showNotification({
      content: 'copySuccess',
      type: 'alert-success',
      timeout: 1500,
    })
  } catch (error) {
    console.warn('Failed to copy rule source url with navigator.clipboard, falling back', error)

    const textArea = document.createElement('textarea')
    textArea.value = url
    textArea.setAttribute('readonly', 'readonly')
    textArea.style.position = 'fixed'
    textArea.style.opacity = '0'
    document.body.appendChild(textArea)
    textArea.select()

    try {
      document.execCommand('copy')
      showNotification({
        content: 'copySuccess',
        type: 'alert-success',
        timeout: 1500,
      })
    } catch (fallbackError) {
      console.warn('Failed to copy rule source url with fallback', fallbackError)
    } finally {
      document.body.removeChild(textArea)
    }
  }
}
</script>
