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

      <RouteFlow
        v-if="result && !loading"
        :nodes="flowNodes"
      >
        <!-- 出站:先写从哪个节点出去的,再写结果。访问失败也要知道是哪条线路失败的——
             服务端趁请求挂着的时候就从连接表里认出这条连接,失败了链路也在 -->
        <template #exit>
          <div
            v-if="result.exit.chains?.length"
            class="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
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
          </div>
          <div
            v-if="result.exit.error || exitNote"
            class="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            <span
              v-if="result.exit.error"
              class="text-error text-xs"
            >{{ $t('routeTestRequestFailed', { message: errorText(result.exit.error) }) }}</span>
            <span
              v-if="exitNote"
              class="text-warning text-xs"
            >{{ exitNote }}</span>
          </div>
          <div class="text-base-content/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span class="font-mono">{{ result.exit.url }}</span>
            <span v-if="result.exit.destinationIP">{{ $t('routeTestDestination') }}: <span class="font-mono">{{ result.exit.destinationIP }}</span></span>
            <span v-if="result.exit.status !== undefined">HTTP {{ result.exit.status }} · {{ statusText(result.exit.status) }}</span>
          </div>
          <!-- 走节点的:节点拿到的是 IP(内核不改写目标),按它直接连,不会再解析。拿到的是
               fake-ip 的情况由上面「DNS · 节点」那一环说明,这里不重复 -->
          <div
            v-if="exitNodeNote"
            class="text-base-content/60 text-xs"
          >{{ exitNodeNote }}</div>
        </template>

        <!-- DNS · 节点:节点那头再解析一次。内核交给节点的是 IP,节点本来不用解析;但那个 IP
             是节点自己发出来的 fake-ip 时,它得反查回域名再真正解析——这是第二次解析,画成一环。 -->
        <template #dnsNode>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ProxyName :name="fakeIpHop" />
          </div>
          <div class="text-base-content/60 text-xs">{{ $t('routeTestNodeResolve', { ip: firstAnswer, target: result.target }) }}</div>
        </template>

        <!-- DNS · 本地这一次解析:内核按 dns.rules 选了哪台解析器、往哪发、代理侧解析时经过哪条线路
             (按内核此刻的选择一路下钻到节点,和出站那一行同一种画法)、谁答的、答了什么。
             正常是配置里那台服务器答的;线路对端(开了 fake-ip 的透明代理)也可能把查询截下来答,
             那种情况配置里那台服务器根本没收到查询,应答者按实际写。 -->
        <template #dns>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <template v-if="'error' in result.dns">
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
              <span
                v-if="dnsDecision?.stale"
                class="text-warning text-xs"
              >{{ $t(dnsDecision.stale === 'direct' ? 'routeTestDnsStaleDirect' : 'routeTestDnsStaleProxy') }}</span>
            </template>
          </div>
          <div
            v-if="dnsChain.length"
            class="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            <span class="text-base-content/60 text-xs">{{ $t('penetrationChainHop') }}</span>
            <template
              v-for="(hop, i) in dnsChain"
              :key="`${hop}-${i}`"
            >
              <ArrowRightCircleIcon
                v-if="i > 0"
                class="text-base-content/40 h-4 w-4"
              />
              <ProxyName :name="hop" />
            </template>
          </div>
          <div
            v-if="result.resolve"
            class="flex flex-wrap items-center gap-x-1.5 gap-y-1"
          >
            <template v-if="fakeIpHop">
              <ProxyName
                :name="fakeIpHop"
                class="text-xs"
              />
              <span class="text-warning text-xs">{{ $t('routeTestFakeIpAnswered') }}</span>
            </template>
            <span
              v-else-if="result.resolve.answers.length"
              class="text-xs"
            >{{ $t('routeTestAnsweredBy', { server: dnsServerAddress }) }}</span>
            <template v-if="result.resolve.answers.length">
              <span
                v-for="ip in result.resolve.answers"
                :key="ip"
                class="badge badge-sm badge-ghost font-mono"
              >{{ ip }}</span>
              <span
                v-if="result.resolve.fakeIp && !fakeIpHop"
                class="text-warning text-xs"
              >{{ $t('routeTestFakeIpUpstream') }}</span>
            </template>
            <span
              v-else
              class="text-warning text-xs"
            >{{ result.resolve.error || $t('routeTestNoAnswer') }}</span>
          </div>
          <div
            v-if="fakeIpHop"
            class="text-base-content/60 text-xs"
          >{{ $t('routeTestFakeIpIntercepted', { server: dnsServerAddress }) }}</div>
        </template>

      </RouteFlow>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxRouteTest } from '@/api/openbox'
import { testRoute } from '@/api/openbox'
import StatusBadge from '@/components/common/StatusBadge.vue'
import ProxyName from '@/components/proxies/ProxyName.vue'
import RouteFlow from '@/components/rules/RouteFlow.vue'
import { ArrowPathIcon, ArrowRightCircleIcon, BoltIcon } from '@heroicons/vue/24/outline'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ target: string; port?: number | null }>()
const { t } = useI18n()
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
    const r = await testRoute(props.target, props.port ?? undefined)
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
  () => [props.target, props.port] as const,
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

// HTTP 状态码翻译成人话:2xx 正常;3xx 跳转;4xx 站点能到但拒了请求;5xx 站点能到但它自己出错
const statusText = (code: number) => {
  const exact = t(`httpStatus_${code}`)
  if (exact !== `httpStatus_${code}`) return exact
  const family = `httpStatus_${Math.floor(code / 100)}xx`
  const text = t(family)
  return text === family ? '' : text
}
// 访问失败的原因翻译成人话
const errorText = (raw: string) => {
  if (/timeout/i.test(raw)) return t('routeTestErrTimeout')
  if (/^inbound:/i.test(raw)) return t('routeTestErrInbound')
  if (/^CONNECT:/i.test(raw)) return t('routeTestErrConnect', { detail: raw.replace(/^CONNECT:\s*/i, '') })
  if (/connection closed|ECONNRESET/i.test(raw)) return t('routeTestErrClosed')
  return raw
}

// 连接表里没认出这条连接时的提示:访问成功和失败两种说法不一样;链路找到了就不用提
const exitNote = computed(() => {
  const e = result.value?.exit
  if (!e || e.chains?.length) return ''
  if (e.notSeen) {
    const base = t(e.error ? 'routeTestNotSeenFailed' : 'routeTestNotSeen')
    return e.debug ? `${base}(连接表 ${e.debug.connections} 条:${e.debug.sample.join(', ')})` : base
  }
  return e.connectionsError || ''
})

// 有几次 DNS 解析就画几个圆环,自下而上就是流量真实走的路:
//   DNS(本地这一次:内核选的解析器、经过的线路、谁答的、答案)
//   → DNS · 节点(只在节点那头还要再解析一次时画:内核交给节点的是节点自己发的 fake-ip,
//     它得反查回域名再真正解析)
//   → 出站(链路、结果;走节点的写明节点拿到的是 IP、按它直接连)
// 目标是 IP 时没有解析,DNS 整个不画(画出来只能写"不用解析",是噪音)。
const dnsSkipped = computed(() => Boolean(result.value && result.value.dns && 'skipped' in result.value.dns))
// 本地这次解析的答案是线路对端的 fake-ip:应答者就是 detour 此刻落到的那个节点,它那头还要再解析一次
const fakeIpHop = computed(() => (result.value?.resolve?.fakeIp && result.value.resolve.fakeIpFrom) || '')
const firstAnswer = computed(() => result.value?.resolve?.answers?.[0] || '')
// 代理侧解析实际经过的线路:站点集 → 节点组 → 节点;拿不到内核状态时只有 detour 那一个名字
const dnsChain = computed(() => {
  const d = dnsDecision.value
  if (!d?.server?.detour) return []
  return d.runtimeChain?.length ? d.runtimeChain : [d.server.detour]
})
const flowNodes = computed(() => [
  { key: 'exit', label: t('routeTestExit'), sub: result.value?.exit.ms !== undefined ? `${result.value.exit.ms}ms` : '—' },
  ...(fakeIpHop.value ? [{ key: 'dnsNode', label: 'DNS', sub: t('routeTestDnsNodeSub') }] : []),
  ...(dnsSkipped.value ? [] : [{ key: 'dns', label: 'DNS', sub: result.value?.resolve ? `${result.value.resolve.ms}ms` : '—' }]),
])
// 走节点、拿到的是真实 IP:写明节点按它直接连,不再解析。拿到 fake-ip 的由「DNS · 节点」那环说明
const exitNodeNote = computed(() => {
  const e = result.value?.exit
  if (!e?.viaProxy || fakeIpHop.value) return ''
  const ip = e.destinationIP || e.connectTo
  return ip ? t('routeTestExitByIp', { ip }) : ''
})

// 配置里那台服务器的地址(local 没有地址就用 tag)
const dnsServerAddress = computed(() => {
  const d = result.value?.dns
  if (!d || !('server' in d) || !d.server) return ''
  return d.server.server || d.server.tag || ''
})
const dnsServerText = computed(() => {
  const d = result.value?.dns
  if (!d || !('server' in d) || !d.server) return ''
  const s = d.server
  const type = s.type === 'local' ? 'local' : s.type || ''
  return [s.tag, type && s.server ? `${type} ${s.server}` : type || s.server].filter(Boolean).join(' · ')
})
</script>

