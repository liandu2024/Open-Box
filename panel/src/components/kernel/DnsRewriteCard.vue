<template>
  <!-- DNS 重写:把一个域名的解析答案改成别的域名或固定 IP(服务端 engine/dns-rewrite.mjs + system/dns-rewrite-server.mjs)。
       规则存在档案 dns.rewrite 里;改了源域名要重启内核(内核的 DNS 规则按源域名生成),目标改了面板侧两秒内生效 -->
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4 text-sm">
      <div class="flex items-center justify-between gap-2">
        <div>
          <h2 class="text-base font-semibold">{{ $t('dnsRewriteTitle') }}</h2>
          <p class="text-base-content/60 text-xs">{{ $t('dnsRewriteDescription') }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="saving"
            @click="restoreDefaults"
          >
            {{ $t('dnsRewriteRestore') }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="saving"
            @click="openEditor(null)"
          >
            {{ $t('dnsRewriteAdd') }}
          </button>
        </div>
      </div>

      <p
        v-if="!rules.length"
        class="text-base-content/50 text-xs"
      >{{ $t('dnsRewriteEmpty') }}</p>
      <!-- 规则一行一条,分割线分开,不再套一层卡片 -->
      <div
        v-else
        class="divide-base-content/10 divide-y"
      >
        <div
          v-for="rule in rules"
          :key="rule.id"
          class="flex items-center gap-2 py-2"
          :class="rule.enabled === false && 'opacity-50'"
        >
          <input
            type="checkbox"
            class="toggle toggle-sm shrink-0"
            :checked="rule.enabled !== false"
            :disabled="saving"
            @change="toggleRule(rule, ($event.target as HTMLInputElement).checked)"
          />
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 font-mono text-xs">
            <span class="truncate">{{ rule.source }}</span>
            <span class="text-base-content/50">→</span>
            <span class="truncate">{{ targetText(rule) }}</span>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-square btn-xs"
            :aria-label="$t('groupEdit')"
            @click="openEditor(rule)"
          >
            <PencilSquareIcon class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-square btn-xs hover:text-error"
            :aria-label="$t('delete')"
            @click="askDelete(rule)"
          >
            <TrashIcon class="h-4 w-4" />
          </button>
        </div>
      </div>
      <p class="text-base-content/50 text-xs">{{ $t('dnsRewriteNote') }}</p>
    </div>

    <DialogWrapper
      v-model="showEditor"
      :title="$t(editing ? 'dnsRewriteEditTitle' : 'dnsRewriteAddTitle')"
      box-class="w-full max-w-lg"
    >
      <div
        v-if="draft"
        class="flex flex-col gap-3"
      >
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('dnsRewriteSource') }}</label>
          <input
            v-model="draft.source"
            type="text"
            class="input input-sm w-full font-mono"
            placeholder="services.googleapis.cn / *.example.com"
          />
          <p class="text-base-content/50 text-xs">{{ $t('dnsRewriteSourceHint') }}</p>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('dnsRewriteTarget') }}</label>
          <div
            role="tablist"
            class="tabs-box tabs tabs-sm w-fit"
          >
            <a
              role="tab"
              :class="['tab', draft.kind === 'domain' && 'tab-active']"
              @click="draft.kind = 'domain'"
            >{{ $t('dnsRewriteKindDomain') }}</a>
            <a
              role="tab"
              :class="['tab', draft.kind === 'ip' && 'tab-active']"
              @click="draft.kind = 'ip'"
            >{{ $t('dnsRewriteKindIp') }}</a>
          </div>
          <input
            v-if="draft.kind === 'domain'"
            v-model="draft.domain"
            type="text"
            class="input input-sm w-full font-mono"
            placeholder="services.googleapis.com"
          />
          <textarea
            v-else
            v-model="draft.addressesText"
            class="textarea textarea-sm w-full font-mono"
            rows="3"
            placeholder="192.168.3.1&#10;2001:db8::1"
          />
          <p class="text-base-content/50 text-xs">{{ $t(draft.kind === 'domain' ? 'dnsRewriteDomainHint' : 'dnsRewriteIpHint') }}</p>
        </div>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showEditor = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="saving"
            @click="saveDraft"
          >
            <span
              v-if="saving"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('subscriptionSave') }}
          </button>
        </div>
      </div>
    </DialogWrapper>

    <DialogWrapper
      v-model="showDelete"
      :title="$t('dnsRewriteDeleteTitle')"
    >
      <div class="flex flex-col gap-4 p-2">
        <p class="text-sm">{{ $t('dnsRewriteDeleteConfirm', { source: pendingDelete?.source || '' }) }}</p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showDelete = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-error btn-sm"
            :disabled="saving"
            @click="confirmDelete"
          >
            {{ $t('confirm') }}
          </button>
        </div>
      </div>
    </DialogWrapper>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxDnsRewriteRule, OpenboxProfile } from '@/api/openbox'
import { fetchDnsRewriteDefaults } from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { showNotification } from '@/helper/notification'
import { PencilSquareIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()
const { t } = useI18n()

const rules = computed<OpenboxDnsRewriteRule[]>(() => props.profile.dns?.rewrite?.rules ?? [])
const saving = ref(false)

const targetText = (rule: OpenboxDnsRewriteRule) => (rule.domain ? rule.domain : (rule.addresses ?? []).join(', '))

const notifyError = (err: unknown) =>
  showNotification({ content: 'routingSaveFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })

// 哪些改动要重启内核:内核的 DNS 规则按「启用的源域名」生成,所以增删规则、改源域名、启停都要重启;
// 只改目标(域名 / IP)是面板侧的重写服务在做,两秒内自己生效
const emit = defineEmits<{ needsRestart: [] }>()
const needsRestart = (before: OpenboxDnsRewriteRule[], after: OpenboxDnsRewriteRule[]) => {
  const key = (list: OpenboxDnsRewriteRule[]) => list.map((r) => `${r.id}\u0000${normalizeDomain(r.source)}\u0000${r.enabled !== false}`).sort().join('\n')
  return key(before) !== key(after)
}
// 整份规则表一次写回(数组是整体替换的,不会被默认值合并回来);服务端校验不过会报错回来
const persist = async (next: OpenboxDnsRewriteRule[]) => {
  saving.value = true
  const restart = needsRestart(rules.value, next)
  try {
    await props.patchProfile({ dns: { rewrite: { initialized: 1, rules: next } } })
    showNotification({ content: restart ? 'dnsRewriteSavedRestart' : 'dnsRewriteSavedLive', type: 'alert-success' })
    if (restart) emit('needsRestart')
    return true
  } catch (err) {
    notifyError(err)
    return false
  } finally {
    saving.value = false
  }
}

const toggleRule = (rule: OpenboxDnsRewriteRule, enabled: boolean) =>
  persist(rules.value.map((r) => (r.id === rule.id ? { ...r, enabled } : r)))

// ---- 编辑弹窗 ----
// 弹窗只定义规则本身(源 / 目标);启用与否在列表的开关上,备注不在这里改
interface Draft { id: string; source: string; kind: 'domain' | 'ip'; domain: string; addressesText: string }
const showEditor = ref(false)
const editing = ref<OpenboxDnsRewriteRule | null>(null)
const draft = ref<Draft | null>(null)
const openEditor = (rule: OpenboxDnsRewriteRule | null) => {
  editing.value = rule
  draft.value = rule
    ? { id: rule.id, source: rule.source, kind: rule.domain ? 'domain' : 'ip', domain: rule.domain || '', addressesText: (rule.addresses ?? []).join('\n') }
    : { id: '', source: '', kind: 'domain', domain: '', addressesText: '' }
  showEditor.value = true
}

const DOMAIN_RE = /^(?:\*\.)?(?:(?!-)[a-z0-9_-]{1,63}(?<!-)\.)*(?!-)[a-z0-9_-]{1,63}(?<!-)$/i
const normalizeDomain = (v: string) => v.trim().toLowerCase().replace(/\.+$/, '')
const isIPv4 = (v: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every((x) => Number(x) <= 255)
const isIPv6 = (v: string) => /^[0-9a-f:.]+$/i.test(v) && v.includes(':')

const saveDraft = async () => {
  const d = draft.value
  if (!d || saving.value) return
  const source = normalizeDomain(d.source)
  if (!source || !DOMAIN_RE.test(source) || source.indexOf('*') > 0) {
    showNotification({ content: 'dnsRewriteBadSource', type: 'alert-error' })
    return
  }
  if (rules.value.some((r) => r.id !== d.id && normalizeDomain(r.source) === source)) {
    showNotification({ content: 'dnsRewriteDuplicate', params: { source }, type: 'alert-error' })
    return
  }
  const rule: OpenboxDnsRewriteRule = {
    id: d.id || `rw-${Date.now().toString(36)}`,
    enabled: editing.value ? editing.value.enabled !== false : true,
    source, domain: '', addresses: [],
    note: editing.value?.note || '',
  }
  if (d.kind === 'domain') {
    const domain = normalizeDomain(d.domain)
    if (!domain || !DOMAIN_RE.test(domain) || domain.includes('*') || domain === source) {
      showNotification({ content: 'dnsRewriteBadDomain', type: 'alert-error' })
      return
    }
    rule.domain = domain
  } else {
    const addresses = d.addressesText.split(/[\n,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
    if (!addresses.length || addresses.some((a) => !isIPv4(a) && !isIPv6(a))) {
      showNotification({ content: 'dnsRewriteBadAddress', type: 'alert-error' })
      return
    }
    rule.addresses = [...new Set(addresses)]
  }
  const next = editing.value ? rules.value.map((r) => (r.id === editing.value?.id ? rule : r)) : [...rules.value, rule]
  if (await persist(next)) showEditor.value = false
}

// ---- 删除 ----
const showDelete = ref(false)
const pendingDelete = ref<OpenboxDnsRewriteRule | null>(null)
const askDelete = (rule: OpenboxDnsRewriteRule) => {
  pendingDelete.value = rule
  showDelete.value = true
}
const confirmDelete = async () => {
  const rule = pendingDelete.value
  if (!rule) return
  if (await persist(rules.value.filter((r) => r.id !== rule.id))) {
    showDelete.value = false
    pendingDelete.value = null
  }
}

// ---- 恢复默认:只动两条默认项(按稳定 id 重置 / 补回),其它规则原样保留;同源的自定义规则让默认项让位 ----
const restoreDefaults = async () => {
  if (saving.value) return
  let defaults: OpenboxDnsRewriteRule[]
  try {
    defaults = await fetchDnsRewriteDefaults()
  } catch (err) {
    notifyError(err)
    return
  }
  const out: OpenboxDnsRewriteRule[] = []
  const seen = new Set<string>()
  for (const r of rules.value) {
    const d = defaults.find((x) => x.id === r.id)
    if (d) { out.push({ ...d }); seen.add(d.id) } else out.push(r)
  }
  for (const d of defaults) {
    if (seen.has(d.id) || out.some((r) => r.source === d.source)) continue
    out.push({ ...d })
  }
  if (JSON.stringify(out) === JSON.stringify(rules.value)) {
    showNotification({ content: 'dnsRewriteAlreadyDefault', type: 'alert-info' })
    return
  }
  await persist(out)
  void t
}
</script>
