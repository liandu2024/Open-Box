<template>
  <form
    class="join w-96 max-sm:w-full"
    @submit.prevent="query"
  >
    <TextInput
      v-model="form.name"
      placeholder="Domain Name"
      :clearable="true"
    />
    <TextInput
      v-model="form.type"
      class="w-28"
      placeholder="Type"
      :menus="['A', 'AAAA', 'HTTPS']"
    />
    <button
      type="submit"
      class="btn join-item btn-sm"
    >
      {{ $t('DNSQuery') }}
    </button>
  </form>
  <div class="flex max-h-96 flex-col gap-1 overflow-y-auto">
    <div
      class="flex gap-1"
      v-for="item in resultList"
      :key="item.data"
    >
      <div>{{ item.name }}</div>
      :
      <div>{{ item.data }}</div>
    </div>
  </div>
  <div
    v-if="details"
    class="flex gap-1"
  >
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

<script lang="ts" setup>
import { queryDNSAPI } from '@/api'
import { getIPInfo, type IPInfo } from '@/api/geoip'
import type { DNSQuery } from '@/types'
import { MapPinIcon, ServerIcon } from '@heroicons/vue/24/outline'
import { reactive, ref } from 'vue'
import TextInput from '../common/TextInput.vue'

const form = reactive({
  name: 'www.google.com',
  type: 'A',
})
const details = ref<IPInfo | null>(null)
const resultList = ref<DNSQuery['Answer']>([])
const query = async () => {
  const { data } = await queryDNSAPI(form)

  resultList.value = data.Answer

  if (resultList.value?.length) {
    details.value = await getIPInfo(resultList.value[0].data)
  } else {
    details.value = null
  }
}
</script>
