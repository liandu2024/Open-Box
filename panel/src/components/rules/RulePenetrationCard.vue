<template>
  <!-- 规则页顶上的穿透结果:这个域名/IP 会命中哪条规则、走哪个站点集、最终从哪个出口出去 -->
  <div class="card">
    <div class="app-card-inset flex flex-col gap-2 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <MagnifyingGlassIcon class="text-base-content/60 h-4 w-4 shrink-0" />
        <span class="font-mono font-medium">{{ target }}</span>
        <span
          v-if="loading"
          class="loading loading-spinner loading-xs"
        />
        <span
          v-else-if="error"
          class="text-error text-xs"
        >{{ error }}</span>
      </div>

      <template v-if="result && !loading">
        <!-- 命中情况 -->
        <div class="text-base-content/80 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <template v-if="result.matchError">
            <QuestionMarkCircleIcon class="text-warning h-4 w-4 shrink-0" />
            <span>{{ $t('penetrationMatchError', { message: result.matchError }) }}</span>
          </template>
          <template v-else-if="result.matched">
            <span class="badge badge-sm badge-success badge-soft">{{ $t('ruleLookupMatched', { index: result.matched.index + 1 }) }}</span>
            <span class="text-main font-mono">{{ conditionText }}</span>
          </template>
          <template v-else>
            <span class="badge badge-sm badge-ghost">{{ $t('ruleLookupNoMatch') }}</span>
          </template>
        </div>

        <!-- 出口:站点集 → 当前选的组 → 最终节点(实时,来自代理页同一份数据) -->
        <div
          v-if="!result.matchError"
          class="flex flex-wrap items-center gap-2"
        >
          <span class="text-base-content/60 text-xs">{{ $t('ruleLookupOutbound') }}</span>
          <template v-if="isReject">
            <NoSymbolIcon class="text-error h-4 w-4" />
            <span class="text-error">{{ $t('penetrationBlockedTitle') }}</span>
          </template>
          <ProxyGroupNow
            v-else-if="outbound && proxyMap[outbound]"
            :name="outbound"
            include-self
            force-full-route
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
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxPenetrationResult } from '@/api/openbox'
import { queryPenetration } from '@/api/openbox'
import ProxyGroupNow from '@/components/proxies/ProxyGroupNow.vue'
import { proxyMap } from '@/store/proxies'
import { MagnifyingGlassIcon, NoSymbolIcon, QuestionMarkCircleIcon } from '@heroicons/vue/24/outline'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ target: string }>()
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

const outbound = computed(() => result.value?.finalOutbound || '')
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
