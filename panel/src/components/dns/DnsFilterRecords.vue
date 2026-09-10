<template>
  <section class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-base font-semibold">{{ $t('dfRecords') }}</h2>
        <form
          class="flex flex-wrap gap-2"
          @submit.prevent="searchRecords"
        >
          <input
            v-model="search"
            type="search"
            class="input input-sm w-52"
            :placeholder="$t('dfSearch')"
            :aria-label="$t('dfSearch')"
          />
          <select
            v-model="result"
            class="select select-sm w-32"
            :aria-label="$t('dfResult')"
            @change="searchRecords"
          >
            <option value="">{{ $t('dfAllResults') }}</option>
            <option value="blocked">{{ $t('dfBlocked') }}</option>
            <option value="allowed">{{ $t('dfAllowed') }}</option>
            <option value="error">{{ $t('dfError') }}</option>
            <option value="unknown">{{ $t('dfUnknown') }}</option>
          </select>
          <button
            class="btn btn-sm"
            :disabled="loading"
            type="submit"
          >
            <ArrowPathIcon class="h-4 w-4" />{{ $t('dfQuery') }}
          </button>
        </form>
      </div>
      <p class="text-base-content/60 text-xs">{{ $t('dfRecordHint') }}</p>
      <p
        v-if="!enabled || !connected"
        class="text-base-content/60 text-xs"
      >
        {{ $t(!enabled ? 'dfCollectDisabled' : 'dfDisconnected') }}
      </p>
      <div class="app-plain-table overflow-x-auto">
        <table class="table-sm table">
          <thead>
            <tr>
              <th>{{ $t('dfTime') }}</th>
              <th>{{ $t('dfDomain') }}</th>
              <th>{{ $t('dfType') }}</th>
              <th>{{ $t('dfResult') }}</th>
              <th>{{ $t('dfSource') }}</th>
              <th>{{ $t('dfMatchedList') }}</th>
              <th>{{ $t('dfDuration') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.id"
            >
              <td class="text-xs whitespace-nowrap">{{ new Date(row.at).toLocaleString() }}</td>
              <td
                class="max-w-72 truncate font-mono text-xs"
                :title="row.domain"
              >
                {{ row.domain }}
              </td>
              <td>{{ row.qtype }}</td>
              <td>
                <span
                  class="badge badge-sm"
                  :class="
                    row.result === 'blocked'
                      ? 'badge-error badge-soft'
                      : row.result === 'allowed'
                        ? 'badge-success badge-soft'
                        : 'badge-ghost'
                  "
                  >{{ resultLabel(row.result) }}</span
                >
              </td>
              <td class="text-xs">
                {{
                  row.source === '127.0.0.1' || row.source === '::1'
                    ? $t('dfRouterSource')
                    : row.source || '—'
                }}
              </td>
              <td>{{ row.list || '—' }}</td>
              <td class="tabular-nums">
                {{ row.elapsed === null ? '—' : `${Math.round(row.elapsed)} ms` }}
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td
                colspan="7"
                class="text-base-content/50 py-10 text-center"
              >
                {{ $t(loading ? 'dfLoading' : 'dfNoRecords') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <AppPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
        :disabled="loading"
        @change="load"
      />
    </div>
  </section>
</template>
<script setup lang="ts">
import { fetchDnsFilterRecords, type DnsFilterRecord } from '@/api/openbox'
import AppPagination from '@/components/common/AppPagination.vue'
import { showNotification } from '@/helper/notification'
import { ArrowPathIcon } from '@heroicons/vue/24/outline'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
defineProps<{ connected: boolean; enabled: boolean }>()
const route = useRoute(),
  { t } = useI18n()
const search = ref(String(route.query.dnsDomain || '')),
  result = ref('blocked'),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0),
  loading = ref(false)
const rows = ref<DnsFilterRecord[]>([])
let serial = 0
const load = async () => {
  const id = ++serial
  loading.value = true
  try {
    const data = await fetchDnsFilterRecords(search.value, result.value, page.value, pageSize.value)
    if (id === serial) {
      rows.value = data.rows
      total.value = data.total
      page.value = data.page
      pageSize.value = data.pageSize
    }
  } catch (e) {
    if (id === serial)
      showNotification({
        content: 'routeTestRequestFailed',
        params: { message: e instanceof Error ? e.message : String(e) },
        key: 'dns-filter-records',
        type: 'alert-error',
      })
  } finally {
    if (id === serial) loading.value = false
  }
}
const resultLabel = (r: string) =>
  ({
    blocked: t('dfBlocked'),
    allowed: t('dfAllowed'),
    error: t('dfError'),
    unknown: t('dfUnknown'),
    policy: t('dfPolicy'),
  })[r] || r.toUpperCase()
const searchRecords = () => {
  page.value = 1
  load()
}
onMounted(load)
</script>
