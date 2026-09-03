<template>
  <!-- 真实路由:不是按规则推,是真的解析一次、访问一次,读内核实际走的路。
       左边是自下而上的流程(DNS → 出口 → 出网),右边每一行对应一个节点。 -->
  <div class="card">
    <div class="app-card-inset flex flex-col gap-3 text-sm">
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

      <div
        v-if="result && !loading"
        class="flex gap-4"
      >
        <!-- 左栏:自下而上的流程线。两行固定等高(h-24),线从箭头下方一直画到 DNS 圈的圆心,
             圆圈在线上层(z-10、实底)把线遮住,看起来就是"线穿过两个节点"。 -->
        <div class="relative w-16 shrink-0 pt-[0.85rem] pb-1">
          <div
            class="border-x-transparent absolute left-1/2 top-0 -translate-x-1/2 border-x-[6px] border-b-[10px]"
            style="border-bottom-color: var(--color-primary)"
          />
          <div
            class="absolute left-1/2 w-0.5 -translate-x-1/2 rounded-full"
            style="top: 0.55rem; bottom: 0; background: color-mix(in srgb, var(--color-primary) 55%, transparent)"
          />
          <div class="flex h-16 items-center justify-center">
            <div class="route-node border-primary/70 text-base-content relative z-10 flex h-14 w-14 flex-col items-center justify-center rounded-full border shadow-sm">
              <span class="text-xs leading-none font-medium">{{ $t('routeTestExit') }}</span>
              <span class="mt-1 text-[10px] leading-none opacity-80">{{ result.exit.ms !== undefined ? `${result.exit.ms}ms` : '—' }}</span>
            </div>
          </div>
          <div class="flex h-16 items-center justify-center">
            <div class="route-node border-primary/70 text-base-content relative z-10 flex h-14 w-14 flex-col items-center justify-center rounded-full border shadow-sm">
              <span class="text-xs leading-none font-medium">DNS</span>
              <span class="mt-1 text-[10px] leading-none opacity-80">{{ result.resolve ? `${result.resolve.ms}ms` : '—' }}</span>
            </div>
          </div>
        </div>

        <!-- 右栏:两行和左边的两个圈同高、垂直居中 -->
        <div class="flex min-w-0 flex-1 flex-col pt-[0.85rem]">
          <!-- 出口 -->
          <div class="flex h-16 flex-col justify-center gap-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
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
              >{{ $t('routeTestNotSeen') }}<template v-if="result.exit.debug">(连接表 {{ result.exit.debug.connections }} 条:{{ result.exit.debug.sample.join(', ') }})</template></span>
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
            </div>
          </div>

          <!-- DNS -->
          <div class="flex h-16 flex-col justify-center gap-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <template v-if="'skipped' in result.dns">
                <span class="text-base-content/50 text-xs">{{ $t('routeTestDnsSkipped') }}</span>
              </template>
              <template v-else-if="'error' in result.dns">
                <span class="text-warning text-xs">{{ result.dns.error }}</span>
              </template>
              <template v-else-if="dnsDecision?.rejected">
                <span class="badge badge-sm badge-error badge-soft">{{ $t('penetrationBlockedTitle') }}</span>
              </template>
              <template v-else>
                <StatusBadge
                  :on="!dnsDecision?.viaProxy"
                  :on-text="$t('routeTestDnsDirect')"
                  :off-text="$t('routeTestDnsProxy')"
                />
                <span class="font-mono text-xs">{{ dnsServerText }}</span>
                <template v-if="dnsDecision?.server?.detour">
                  <span class="text-base-content/60 text-xs">{{ $t('penetrationChainHop') }}</span>
                  <ProxyName
                    :name="dnsDecision.server.detour"
                    class="text-xs"
                  />
                </template>
                <span
                  v-if="dnsDecision?.stale"
                  class="text-warning text-xs"
                >{{ $t(dnsDecision.stale === 'direct' ? 'routeTestDnsStaleDirect' : 'routeTestDnsStaleProxy') }}</span>
              </template>
            </div>
            <div
              v-if="result.resolve"
              class="flex flex-wrap items-center gap-x-1.5 gap-y-1"
            >
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
            </div>
          </div>
        </div>
      </div>
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

// 模板里对联合类型做不了细致的收窄,先在这里把"有决策结果"的那一支取出来
const dnsDecision = computed(() => {
  const d = result.value?.dns
  return d && 'ruleIndex' in d ? d : null
})

const dnsServerText = computed(() => {
  const d = result.value?.dns
  if (!d || !('server' in d) || !d.server) return ''
  const s = d.server
  const type = s.type === 'local' ? 'local' : s.type || ''
  return [s.tag, type && s.server ? `${type} ${s.server}` : type || s.server].filter(Boolean).join(' · ')
})
</script>

<style scoped>
/* 圆圈必须是实底:主线从它背后穿过,半透明的话线会透出来 */
.route-node {
  background-color: var(--color-base-100) !important;
}
</style>
