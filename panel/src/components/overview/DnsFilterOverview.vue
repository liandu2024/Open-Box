<template>
  <section
    v-if="data?.enabled"
    class="card bg-base-100 border-base-300/60 border p-4"
  >
    <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 class="text-base font-semibold">{{ $t('dfOverview') }}</h2>
        <p class="text-base-content/60 text-xs">
          {{ $t('dfScope') }}
          <span
            v-if="!data.connected"
            class="text-warning"
          >{{ $t('dfDisconnected') }}</span>
        </p>
      </div>
    </div>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="bg-base-100 border-base-300/60 flex flex-col rounded-xl border p-4">
        <div class="text-base-content/60 text-xs">{{ $t('dfQueries') }}</div>
        <div class="my-2 text-3xl tabular-nums">{{ data.queries.toLocaleString() }}</div>
        <DnsSparkline
          :values="data.hourly.map((h) => h.queries)"
          class="mt-auto text-sky-500"
        />
      </div>
      <div class="bg-base-100 border-base-300/60 flex flex-col rounded-xl border p-4">
        <div class="text-base-content/60 flex justify-between text-xs">
          <span>{{ $t('dfBlocked') }}</span
          ><span class="text-orange-500"
            >{{ data.queries ? ((data.blocked / data.queries) * 100).toFixed(1) : '0' }}%</span
          >
        </div>
        <div class="my-2 text-3xl text-orange-500 tabular-nums">
          {{ data.blocked.toLocaleString() }}
        </div>
        <DnsSparkline
          :values="data.hourly.map((h) => h.blocked)"
          class="mt-auto text-orange-500"
        />
      </div>
      <div class="bg-base-100 border-base-300/60 rounded-xl border p-4">
        <div class="text-base-content/60 mb-3 text-xs">{{ $t('dfTop') }}</div>
        <div
          v-if="!data.topDomains.length"
          class="text-base-content/40 py-6 text-center text-xs"
        >
          {{ $t('dfNoBlocks') }}
        </div>
        <RouterLink
          v-for="domain in data.topDomains"
          :key="domain.domain"
          :to="{ path: '/settings', query: { tab: 'dns', dnsDomain: domain.domain } }"
          class="mb-2 block text-xs"
          ><div class="flex justify-between gap-2">
            <span
              class="truncate"
              :title="domain.domain"
              >{{ domain.domain }}</span
            ><span class="tabular-nums">{{ domain.count.toLocaleString() }}</span>
          </div>
          <div class="bg-base-200 mt-1 h-1 rounded-full">
            <div
              class="h-1 rounded-full bg-orange-400/70"
              :style="{ width: `${(domain.count / Math.max(1, data.topDomains[0].count)) * 100}%` }"
            /></div
        ></RouterLink>
      </div>
      <div class="bg-base-100 border-base-300/60 flex flex-col rounded-xl border p-4">
        <div class="text-base-content/60 text-xs">{{ $t('dfAverage') }}</div>
        <div class="my-2 text-3xl tabular-nums">
          {{ data.averageMs === null ? '—' : Math.round(data.averageMs)
          }}<span
            v-if="data.averageMs !== null"
            class="text-base-content/50 ml-1 text-sm"
            >ms</span
          >
        </div>
        <DnsSparkline
          :values="data.hourly.map((h) => (h.timed ? h.elapsed / h.timed : 0))"
          class="mt-auto text-emerald-500"
        />
        <div class="text-base-content/40 mt-1 text-[10px]">{{ $t('dfTimingHint') }}</div>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { fetchDnsFilterSummary, type DnsFilterSummary } from '@/api/openbox'
import DnsSparkline from '@/components/dns/DnsSparkline.vue'
import { showNotification } from '@/helper/notification'
import { onMounted, onUnmounted, ref } from 'vue'
const data = ref<DnsFilterSummary | null>(null)
let lastError = ''
let timer: ReturnType<typeof setInterval>,
  loading = false
const load = async () => {
  if (loading) return
  loading = true
  try {
    data.value = await fetchDnsFilterSummary()
    lastError = ''
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message !== lastError)
      showNotification({
        content: 'routeTestRequestFailed',
        params: { message },
        key: 'dns-filter-overview',
        type: 'alert-error',
      })
    lastError = message
  } finally {
    loading = false
  }
}
onMounted(() => {
  load()
  timer = setInterval(() => {
    if (!document.hidden) load()
  }, 10000)
})
onUnmounted(() => clearInterval(timer))
</script>
