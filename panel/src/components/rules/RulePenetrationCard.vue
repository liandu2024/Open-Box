<template>
  <!-- 规则页顶上的穿透结果:这个域名/IP 会命中哪条规则、走哪个站点集、最终从哪个出口出去 -->
  <div class="card">
    <div class="app-card-inset flex flex-col gap-2 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <MagnifyingGlassIcon class="text-base-content/60 h-4 w-4 shrink-0" />
        <span class="font-medium">{{ $t('ruleLookupTitle') }}</span>
        <span class="text-base-content/50">·</span>
        <span class="font-mono font-medium">{{ display || target }}</span>
        <span
          v-if="loading"
          class="loading loading-spinner loading-xs"
        />
        <span
          v-else-if="error"
          class="text-error text-xs"
        >{{ error }}</span>
      </div>

      <!-- 分流改了但内核还没重启:上面按当前设置推算、下面是内核此刻的实际行为,两者对不上
           是正常的。不说一句的话,看起来就像查出来是乱的。 -->
      <div
        v-if="result?.routingStale && !loading"
        class="text-warning flex items-start gap-1.5 text-xs"
      >
        <ExclamationTriangleIcon class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{{ $t('ruleLookupRoutingStale') }}</span>
      </div>

      <!-- 第一层(部署时记下的):DNS 怎么分、直连目标在入口有没有原生旁路。这是记录不是推算,
           所以放在推算的链路之前单独一行,免得和"规则路由"混成一回事 -->
      <div
        v-if="firstLayerText && !loading"
        class="text-base-content/60 text-xs"
      >{{ firstLayerText }}</div>

      <RouteFlow
        v-if="result && !loading"
        :nodes="flowNodes"
      >
        <!-- 出口:按规则推出来的链路(站点集 → 当前选的组 → 节点,实时) -->
        <template #exit>
          <div class="flex flex-wrap items-center gap-2">
            <template v-if="result.matchError">
              <span class="text-warning text-xs">{{ $t('penetrationMatchError', { message: result.matchError }) }}</span>
            </template>
            <template v-else-if="isReject">
              <NoSymbolIcon class="text-error h-4 w-4" />
              <span class="text-error">{{ $t('penetrationBlockedTitle') }}</span>
            </template>
            <!-- 只有能往下钻的出站(站点集 / 节点组)才画链路;直连、拒绝和具体节点没有
                 下级,ProxyGroupNow 对它们什么都不渲染,会留下一行空白 -->
            <ProxyGroupNow
              v-else-if="outbound && proxyMap[outbound]?.now"
              :name="outbound"
              include-self
            />
            <ProxyName
              v-else-if="outbound && proxyMap[outbound]"
              :name="outbound"
              class="text-sm font-medium"
            />
            <span
              v-else-if="outbound"
              class="font-medium"
            >{{ outbound }}</span>
            <span
              v-if="result.chainError"
              class="text-warning text-xs"
            >{{ $t('penetrationChainError', { message: result.chainError }) }}</span>
          </div>
        </template>

        <!-- DNS:按内核当前配置里的 DNS 规则推出来的解析方式 -->
        <template #dns>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <template v-if="!result.dns || 'skipped' in result.dns">
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
            </template>
          </div>
        </template>

        <!-- 规则:命中第几条、哪个站点集、具体条目 -->
        <template #rule>
          <div class="text-base-content/80 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <template v-if="result.matchError">
              <QuestionMarkCircleIcon class="text-warning h-4 w-4 shrink-0" />
              <span>{{ $t('penetrationMatchError', { message: result.matchError }) }}</span>
            </template>
            <template v-else-if="result.matched">
              <span class="badge badge-sm badge-success badge-soft">{{ $t('ruleLookupMatched', { index: result.matched.index + 1 }) }}</span>
              <template v-if="(ownerName || outbound) && !isReject">
                <span class="text-base-content/60">{{ $t('ruleLookupSiteSet') }}</span>
                <!-- 前置自定义分流不生成 selector,它的名字不是出站名,按纯文本显示;
                     站点集照旧走 ProxyName(名字就是出站名,能配上图标) -->
                <span
                  v-if="ownerName"
                  class="text-sm font-medium"
                >{{ ownerName }}</span>
                <ProxyName
                  v-else
                  :name="outbound"
                  class="text-sm font-medium"
                />
              </template>
              <span class="text-base-content/50 font-mono text-[11px]">{{ conditionText }}</span>
            </template>
            <template v-else>
              <span class="badge badge-sm badge-ghost">{{ $t('ruleLookupNoMatch') }}</span>
            </template>
          </div>
          <div
            v-if="result.matched?.entries?.length"
            class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          >
            <template
              v-for="(e, i) in result.matched.entries.slice(0, 4)"
              :key="`${e.source}-${e.type}-${e.value}-${i}`"
            >
              <span class="badge badge-sm badge-ghost font-mono">{{ typeLabel(e.type) }}</span>
              <span class="text-main font-mono">{{ e.value }}</span>
              <span class="text-base-content/50">{{ e.source === 'custom' ? $t('ruleSourceCustom') : e.source }}</span>
            </template>
            <span
              v-if="(result.matched.entriesTotal || 0) > 4"
              class="text-base-content/50"
            >{{ $t('ruleLookupMoreEntries', { count: (result.matched.entriesTotal || 0) - 4 }) }}</span>
          </div>
        </template>
      </RouteFlow>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxPenetrationResult } from '@/api/openbox'
import { queryPenetration } from '@/api/openbox'
import ProxyGroupNow from '@/components/proxies/ProxyGroupNow.vue'
import ProxyName from '@/components/proxies/ProxyName.vue'
import RouteFlow from '@/components/rules/RouteFlow.vue'
import { ruleTypeLabelKey } from '@/helper/ruleType'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { proxyMap } from '@/store/proxies'
import { ExclamationTriangleIcon, MagnifyingGlassIcon, NoSymbolIcon, QuestionMarkCircleIcon } from '@heroicons/vue/24/outline'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// target 是拿去查规则/DNS 的主机名;display 是搜索框里的原样(可能带端口),标题显示它
const props = defineProps<{ target: string; display?: string }>()
const emit = defineEmits<{ matched: [index: number | null] }>()
const { t } = useI18n()

const loading = ref(false)
const error = ref('')
const result = ref<OpenboxPenetrationResult | null>(null)
let timer = 0
let seq = 0

const run = async () => {
  const target = props.target
  const mine = ++seq
  loading.value = true
  error.value = ''
  try {
    const r = await queryPenetration(target)
    if (mine !== seq) return
    result.value = r
    emit('matched', r.matched ? r.matched.index : null)
  } catch (err) {
    if (mine !== seq) return
    result.value = null
    emit('matched', null)
    error.value = t('penetrationQueryFailed', { message: err instanceof Error ? err.message : String(err) })
  } finally {
    if (mine === seq) loading.value = false
  }
}

// 边输入边查,停 400ms 再发请求(规则集匹配要起一次内核进程,不能每个字母都跑)
watch(
  () => props.target,
  () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(run, 400)
  },
  { immediate: true },
)
onBeforeUnmount(() => window.clearTimeout(timer))

const typeLabel = (type: string) => t(ruleTypeLabelKey(type))

// 目标是 IP 时没有解析这一步,DNS 节点整个不画(和「真实路由」一致)
const dnsSkipped = computed(() => Boolean(result.value && (!result.value.dns || 'skipped' in result.value.dns)))
const flowNodes = computed(() => [
  { key: 'exit', label: t('routeTestExit') },
  ...(dnsSkipped.value ? [] : [{ key: 'dns', label: 'DNS' }]),
  { key: 'rule', label: t('routeTestRuleNode'), sub: result.value?.matched ? `#${result.value.matched.index + 1}` : undefined },
])
const dnsDecision = computed(() => {
  const d = result.value?.dns
  return d && 'ruleIndex' in d ? d : null
})
const dnsServerText = computed(() => {
  const d = dnsDecision.value
  if (!d || !d.server) return ''
  const s = d.server
  const type = s.type === 'local' ? 'local' : s.type || ''
  return [s.tag, type && s.server ? `${type} ${s.server}` : type || s.server].filter(Boolean).join(' · ')
})

const outbound = computed(() => result.value?.finalOutbound || '')
// 命中的是哪一条分流条目:站点集的名字就是出站名,前置自定义分流不是,服务端单独给
const ownerName = computed(() => result.value?.matched?.ownerName || '')
// 第一层判定的一句话说明:DNS none / domains / all,入口旁路开没开(nft 还是路由表)、没开的原因
const firstLayerText = computed(() => {
  const f = result.value?.firstLayer
  if (!f) return ''
  const dns = f.dnsMode === 'dnsmasq'
    ? t(`ruleLookupFirstLayerDns_${f.dnsForward}`)
    : f.dnsMode === 'hijack' ? t('ruleLookupFirstLayerDnsHijack') : t('ruleLookupFirstLayerDnsOff')
  const bypass = f.nativeBypass?.enabled
    ? t('ruleLookupFirstLayerBypassOn', { sets: f.nativeBypass.sets.join(', '), via: f.nativeBypass.via === 'route' ? t('ruleLookupFirstLayerViaRoute') : 'nft' })
    : t('ruleLookupFirstLayerBypassOff', { reason: f.nativeBypass?.reason || '' })
  const v6 = f.ipv6 ? `;${t(`ruleLookupFirstLayerIpv6_${f.ipv6}`)}` : ''
  return `${t('ruleLookupFirstLayer')}:${dns};${bypass}${v6}`
})

const isReject = computed(() => result.value?.matched?.action === 'reject')
const conditionText = computed(() => {
  const rule = (result.value?.matched?.rule || {}) as Record<string, unknown>
  if (rule.ip_is_private) return t('penetrationRulePrivateIp')
  return Object.entries(rule)
    .filter(([k]) => !['outbound', 'action'].includes(k))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(' ') : String(v)}`)
    .join('  ')
})
</script>
