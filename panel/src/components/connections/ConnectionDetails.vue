<template>
  <DialogWrapper
    v-model="connectionDetailModalShow"
    :title="$t('connectionDetails')"
    :box-class="proxyChainStart ? `max-w-256` : `max-w-128`"
  >
    <div class="flex flex-col md:flex-row">
      <div class="md:w-128">
        <VueJsonPretty
          :data="infoConn"
          class="overflow-y-auto"
        >
          <template #renderNodeValue="{ node, defaultValue }">
            <template v-if="node.path.startsWith('root.chains') && proxyMap[node.content]?.icon">
              <span
                >"<ProxyIcon
                  :icon="proxyMap[node.content].icon"
                  class="inline-block"
                  :margin="0"
                />
                {{ node.content }}"
              </span>
            </template>
            <template v-else>
              {{ defaultValue }}
            </template>
          </template>
        </VueJsonPretty>
        <div
          class="min-h-12 shrink-0 pt-2 text-sm"
          v-if="destinationIP && !isPrivateIP"
        >
          <template v-if="details">
            <div class="flex flex-wrap items-center gap-1">
              <ArrowRightCircleIcon class="h-4 w-4 shrink-0" />
              <div>
                {{ details?.ip }}
              </div>
              <div>( AS{{ details?.asn }} )</div>
            </div>
            <div class="flex flex-wrap">
              <div
                class="mr-3 flex items-center gap-1"
                v-if="details?.country"
              >
                <MapPinIcon class="h-4 w-4 shrink-0" />
                <template v-if="details?.city && details?.city !== details?.country">
                  {{ details?.city }},
                </template>
                <template v-else-if="details?.region && details?.region !== details?.country">
                  {{ details?.region }},
                </template>
                {{ details?.country }}
              </div>
              <div class="flex items-center gap-1">
                <ServerIcon class="h-4 w-4 shrink-0" />
                {{ details?.organization }}
              </div>
            </div>
          </template>
        </div>
      </div>
      <template v-if="proxyChainStart">
        <div class="divider md:divider-horizontal m-0"></div>
        <div class="md:w-128">
          <ProxyGroup
            :name="proxyChainStart"
            class="transparent-collapse"
          />
        </div>
      </template>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import { getIPInfo, type IPInfo } from '@/api/geoip'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { useConnections } from '@/composables/connections'
import { proxyMap } from '@/store/proxies'
import { ArrowRightCircleIcon, MapPinIcon, ServerIcon } from '@heroicons/vue/24/outline'
import * as ipaddr from 'ipaddr.js'
import { last } from 'lodash'
import { computed, ref, watch } from 'vue'
import VueJsonPretty from 'vue-json-pretty'
import 'vue-json-pretty/lib/styles.css'
import ProxyGroup from '../proxies/ProxyGroup.vue'
import ProxyIcon from '../proxies/ProxyIcon.vue'

const { infoConn, connectionDetailModalShow } = useConnections()
const details = ref<IPInfo | null>(null)

const destinationIP = computed(() => infoConn.value?.metadata.destinationIP)
const isPrivateIP = computed(() => {
  if (!destinationIP.value || !ipaddr.isValid(destinationIP.value)) {
    return false
  }

  const addr = ipaddr.parse(destinationIP.value)
  const range = addr.range()

  return ['private', 'uniqueLocal', 'loopback', 'linkLocal'].includes(range)
})

const proxyChainStart = computed(() => {
  if (!infoConn.value?.chains || !infoConn.value.chains.length) {
    return null
  }

  return last(infoConn.value.chains)
})

watch(
  () => destinationIP.value,
  (newIP) => {
    if (!newIP) {
      return
    }

    if (isPrivateIP.value) {
      details.value = null
      return
    }

    if (details.value?.ip === newIP) {
      return
    }

    details.value = null
    getIPInfo(infoConn.value?.metadata.destinationIP).then((res) => {
      details.value = res
    })
  },
)
</script>
