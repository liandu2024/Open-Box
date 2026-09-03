<template>
  <!-- 新建 / 编辑一条终端分流规则:名称、终端(每行一个 IP 或网段,也可从已知终端里选)、出口 -->
  <DialogWrapper
    v-model="isOpen"
    :title="$t(route ? 'clientRouteEditTitle' : 'clientRouteAddTitle')"
    box-class="w-full max-w-xl"
  >
    <div class="flex flex-col gap-4 text-sm">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">{{ $t('clientRouteNameLabel') }}</label>
        <input
          v-model="form.name"
          type="text"
          class="input input-sm w-full"
          :placeholder="$t('clientRouteNamePlaceholder')"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">{{ $t('clientRouteSourcesLabel') }}</label>
        <textarea
          v-model="form.sourcesText"
          rows="4"
          class="textarea textarea-sm w-full font-mono"
          :placeholder="$t('clientRouteSourcesPlaceholder')"
        />
        <div class="flex items-center gap-2">
          <span class="text-base-content/60 text-xs">{{ $t('clientRouteKnownLabel') }}</span>
          <select
            class="select select-sm min-w-0 flex-1"
            :value="''"
            @change="addKnown(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ $t('clientRouteKnownPlaceholder') }}</option>
            <option
              v-for="c in knownClients"
              :key="c.ip"
              :value="c.ip"
            >
              {{ c.ip }}{{ c.name ? ` · ${c.name}` : '' }}
            </option>
          </select>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">{{ $t('clientRouteOutboundLabel') }}</label>
        <select
          v-model="form.outbound"
          class="select select-sm w-full"
        >
          <option value="">—</option>
          <optgroup
            v-if="options.builtin.length"
            :label="$t('clientRouteOutboundBuiltin')"
          >
            <option
              v-for="o in options.builtin"
              :key="o"
              :value="o"
            >{{ o }}</option>
          </optgroup>
          <optgroup
            v-if="options.groups.length"
            :label="$t('clientRouteOutboundGroups')"
          >
            <option
              v-for="o in options.groups"
              :key="o"
              :value="o"
            >{{ o }}</option>
          </optgroup>
          <optgroup
            v-if="options.policies.length"
            :label="$t('clientRouteOutboundPolicies')"
          >
            <option
              v-for="o in options.policies"
              :key="o"
              :value="o"
            >{{ o }}</option>
          </optgroup>
        </select>
        <p class="text-base-content/50 text-xs">{{ $t('clientRouteHint') }}</p>
      </div>

      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="btn btn-sm"
          @click="isOpen = false"
        >
          {{ $t('cancel') }}
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="submit"
        >
          {{ $t('save') }}
        </button>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import type { OpenboxClientRoute } from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { showNotification } from '@/helper/notification'
import { computed, reactive, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  route: OpenboxClientRoute | null
  knownClients: Array<{ ip: string; name: string }>
  options: { builtin: string[]; groups: string[]; policies: string[] }
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [route: OpenboxClientRoute]
}>()

const isOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const newId = () => `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
const form = reactive({ id: newId(), enabled: true, name: '', sourcesText: '', outbound: '' })

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const r = props.route
    form.id = r?.id || newId()
    form.enabled = r ? r.enabled !== false : true
    form.name = r?.name || ''
    form.sourcesText = (r?.sources || []).join('\n')
    form.outbound = r?.outbound || ''
  },
)

const addKnown = (ip: string) => {
  if (!ip) return
  const lines = form.sourcesText.split('\n').map((x) => x.trim()).filter(Boolean)
  if (!lines.includes(ip)) lines.push(ip)
  form.sourcesText = lines.join('\n')
}

// 和 server/engine/client-routes.mjs 同一套判断:裸 IP 或带前缀的网段
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const isIpOrCidr = (raw: string) => {
  const [addr, prefix, ...rest] = raw.split('/')
  if (rest.length) return false
  const v4 = IPV4.test(addr)
  const v6 = !v4 && /^[0-9a-f:]+$/i.test(addr) && addr.includes(':') && addr.split('::').length <= 2
  if (!v4 && !v6) return false
  if (prefix === undefined) return true
  if (!/^\d+$/.test(prefix)) return false
  const n = Number(prefix)
  return n >= 0 && n <= (v4 ? 32 : 128)
}

const fail = (content: string, params?: Record<string, string>) => {
  showNotification({ content, params, type: 'alert-error' })
}

const submit = () => {
  const name = form.name.trim()
  if (!name) return fail('clientRouteErrName')
  const sources = form.sourcesText.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)
  if (!sources.length) return fail('clientRouteErrNoSources')
  const bad = sources.find((x) => !isIpOrCidr(x))
  if (bad) return fail('clientRouteErrSources', { value: bad })
  if (!form.outbound) return fail('clientRouteErrOutbound')
  emit('saved', { id: form.id, enabled: form.enabled, name, sources: [...new Set(sources)], outbound: form.outbound })
  isOpen.value = false
}
</script>
