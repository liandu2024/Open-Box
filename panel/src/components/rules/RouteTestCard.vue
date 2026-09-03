<template>
  <!-- 真实路由:不是按规则推,是真的解析一次、访问一次,读内核实际走的路 -->
  <div class="card">
    <div class="app-card-inset flex flex-col gap-2 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <BoltIcon class="text-base-content/60 h-4 w-4 shrink-0" />
        <span class="font-medium">{{ $t('routeTestTitle') }}</span>
        <span
          v-if="loading"
          class="loading loading-spinner loading-xs"
        />
        <button
          v-else
          type="button"
          class="btn btn-ghost btn-xs"
          @click="run"
        >
          <ArrowPathIcon class="h-3.5 w-3.5" />
          {{ $t('routeTestRerun') }}
        </button>
        <span
          v-if="error"
          class="text-error text-xs"
        >{{ error }}</span>
      </div>

      <template v-if="result && !loading">
        <!-- DNS -->
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-base-content/60 w-14 text-xs">DNS</span>
          <template v-if="'skipped' in result.dns">
            <span class="text-base-content/50 text-xs">{{ $t('routeTestDnsSkipped') }}</span>
          </template>
          <template v-else-if="'error' in result.dns">
            <span class="text-warning text-xs">{{ result.dns.error }}</span>
          </template>
          <template v-else-if="result.dns.rejected">
            <span class="badge badge-sm badge-error badge-soft">{{ $t('penetrationBlockedTitle') }}</span>
          </template>
          <template v-else>
            <StatusBadge
              :on="!result.dns.viaProxy"
              :on-text="$t('routeTestDnsDirect')"
              :off-text="$t('routeTestDnsProxy')"
            />
            <span class="font-mono text-xs">{{ dnsServerText }}</span>
            <template v-if="result.dns.server?.detour">
              <span class="text-base-content/60 text-xs">{{ $t('penetrationChainHop') }}</span>
              <ProxyName
                :name="result.dns.server.detour"
                class="text-xs"
              />
            </template>
          </template>
        </div>

        <!-- 解析结果 -->
        <div
          v-if="result.resolve"
          class="flex flex-wrap items-center gap-x-2 gap-y-1"
        >
          <span class="text-base-content/60 w-14 text-xs">{{ $t('routeTestResolve') }}</span>
          <template v-if="result.resolve.answers.length">
            <span
              v-for="ip in result.resolve.answers"
              :key="ip"
              class="badge badge-sm badge-ghost font-mono"
            >{{ ip }}</span>
          </template>
          <span
            v-else
            class="text-warning text-xs"
          >{{ result.resolve.error || $t('routeTestNoAnswer') }}</span>
          <span class="text-base-content/50 text-xs">{{ result.resolve.ms }} ms</span>
        </div>

        <!-- 实际出口 -->
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-base-content/60 w-14 text-xs">{{ $t('routeTestExit') }}</span>
          <template v-if="result.exit.error">
            <span class="text-error text-xs">{{ $t('routeTestRequestFailed', { message: result.exit.error }) }}</span>
          </template>
          <template v-else-if="result.exit.chains?.length">
            <template
              v-for="(hop, i) in result.exit.chains"
              :key="`${hop}-${i}`"
            >
              <ArrowRightCircleIcon
                v-if="i > 0"
                class="text-base-content/40 h-4 w-4"
              />
              <ProxyName :name="hop" />
            </template>
          </template>
          <span
            v-else-if="result.exit.notSeen"
            class="text-warning text-xs"
          >{{ $t('routeTestNotSeen') }}</span>
          <span
            v-else-if="result.exit.connectionsError"
            class="text-warning text-xs"
          >{{ result.exit.connectionsError }}</span>
        </div>
        <div
          v-if="!result.exit.error"
          class="text-base-content/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        >
          <span v-if="result.exit.rule">{{ $t('routeTestRule') }}: <span class="font-mono">{{ result.exit.rule }}</span></span>
          <span v-if="result.exit.destinationIP">{{ $t('routeTestDestination') }}: <span class="font-mono">{{ result.exit.destinationIP }}</span></span>
          <span v-if="result.exit.status !== undefined">HTTP {{ result.exit.status }}</span>
          <span v-if="result.exit.ms !== undefined">{{ $t('routeTestElapsed') }}: {{ result.exit.ms }} ms</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxRouteTest } from '@/api/openbox'
import { testRoute } from '@/api/openbox'
import StatusBadge from '@/components/common/StatusBadge.vue'
import ProxyName from '@/components/proxies/ProxyName.vue'
import { ArrowPathIcon, ArrowRightCircleIcon, BoltIcon } from '@heroicons/vue/24/outline'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ target: string }>()
const loading = ref(false)
const error = ref('')
const result = ref<OpenboxRouteTest | null>(null)
let timer = 0
let seq = 0

const run = async () => {
  const mine = ++seq
  loading.value = true
  error.value = ''
  try {
    const r = await testRoute(props.target)
    if (mine !== seq) return
    result.value = r
  } catch (err) {
    if (mine !== seq) return
    result.value = null
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (mine === seq) loading.value = false
  }
}

// 真实访问一次是有代价的(出网、占一条连接),等输入停下 600ms 再跑
watch(
  () => props.target,
  () => {
    window.clearTimeout(timer)
    result.value = null
    timer = window.setTimeout(run, 600)
  },
  { immediate: true },
)
onBeforeUnmount(() => window.clearTimeout(timer))

const dnsServerText = computed(() => {
  const d = result.value?.dns
  if (!d || !('server' in d) || !d.server) return ''
  const s = d.server
  const type = s.type === 'local' ? 'local' : s.type || ''
  return [s.tag, type && s.server ? `${type} ${s.server}` : type || s.server].filter(Boolean).join(' · ')
})
</script>
