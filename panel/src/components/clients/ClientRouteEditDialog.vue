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
        <!-- 从已知终端添加:带搜索的浮层(DHCP 租约 + 近期流量里的来源 IP),点一项加进上面的
             终端框,已加的打勾,可以连续加多项;点外面关闭。 -->
        <div class="flex items-center gap-2">
          <span class="text-base-content/60 shrink-0 text-xs">{{ $t('clientRouteKnownLabel') }}</span>
          <div
            ref="knownTriggerRef"
            role="button"
            tabindex="0"
            class="input input-sm hover:border-base-content/30 flex min-w-0 flex-1 cursor-pointer items-center gap-1.5"
            @click="knownToggle"
            @keydown.enter.prevent="knownToggle"
          >
            <span class="text-base-content/40 min-w-0 flex-1 truncate text-left">{{ $t('clientRouteKnownPlaceholder') }}</span>
            <ChevronDownIcon class="text-base-content/40 h-3.5 w-3.5 shrink-0" />
          </div>
          <Teleport to="#app-content">
            <div
              v-if="knownOpen"
              ref="knownPanelRef"
              class="app-popover border-base-content/10 z-[1000] flex flex-col gap-2 rounded-lg border p-2 shadow-lg"
              :style="knownStyle"
            >
              <TextInput
                v-model="knownKeyword"
                :placeholder="$t('outboundPickerSearch')"
                clearable
              />
              <ul class="min-h-0 flex-1 overflow-y-auto text-sm">
                <li
                  v-for="c in visibleKnown"
                  :key="c.ip"
                >
                  <button
                    type="button"
                    class="hover:bg-base-200 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                    @click="addKnown(c)"
                  >
                    <CheckIcon
                      class="h-4 w-4 shrink-0"
                      :class="hasSource(c.ip) ? 'text-success' : 'invisible'"
                    />
                    <span class="shrink-0 font-mono text-xs">{{ c.ip }}</span>
                    <span class="text-base-content/60 min-w-0 flex-1 truncate text-xs">{{ c.name }}</span>
                    <span
                      v-if="c.mac"
                      class="text-base-content/40 shrink-0 font-mono text-xs"
                    >{{ c.mac }}</span>
                  </button>
                </li>
                <li
                  v-if="!visibleKnown.length"
                  class="text-base-content/50 px-2 py-3 text-center text-xs"
                >
                  {{ $t('outboundPickerNoMatch') }}
                </li>
              </ul>
            </div>
          </Teleport>
        </div>
      </div>

      <!-- 不进内核(GitHub #39):像 OpenClash 的黑名单,按 MAC 在入口就放行;开着时不用选出站 -->
      <label class="flex cursor-pointer items-start gap-2">
        <input
          v-model="form.bypass"
          type="checkbox"
          class="checkbox checkbox-sm mt-0.5"
        />
        <span class="flex flex-col gap-0.5">
          <span class="text-sm">{{ $t('clientRouteBypassLabel') }}</span>
          <span class="text-base-content/50 text-xs">{{ $t('clientRouteBypassHint') }}</span>
        </span>
      </label>

      <div
        v-if="form.bypass"
        class="flex flex-col gap-1"
      >
        <label class="text-xs font-medium">{{ $t('clientRouteMacsLabel') }}</label>
        <textarea
          v-model="form.macsText"
          rows="3"
          class="textarea textarea-sm w-full font-mono"
          :placeholder="$t('clientRouteMacsPlaceholder')"
        />
      </div>

      <div
        v-else
        class="flex flex-col gap-1"
      >
        <label class="text-xs font-medium">{{ $t('clientRouteOutboundLabel') }}</label>
        <OutboundPicker
          v-model="form.outbound"
          :options="options"
          :placeholder="$t('outboundPickerPlaceholder')"
        />
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
import OutboundPicker, { type OutboundPickerOptions } from '@/components/common/OutboundPicker.vue'
import TextInput from '@/components/common/TextInput.vue'
import { useAnchoredDropdown } from '@/composables/anchoredDropdown'
import { showNotification } from '@/helper/notification'
import { CheckIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import { computed, reactive, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  route: OpenboxClientRoute | null
  knownClients: Array<{ ip: string; name: string; mac?: string }>
  options: OutboundPickerOptions
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
const form = reactive({ id: newId(), enabled: true, name: '', sourcesText: '', outbound: '', bypass: false, macsText: '' })

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
    form.bypass = r?.bypass === true
    form.macsText = (r?.macs || []).join('\n')
  },
)

const sourceLines = () => form.sourcesText.split('\n').map((x) => x.trim()).filter(Boolean)
const hasSource = (ip: string) => sourceLines().includes(ip) || sourceLines().includes(`${ip}/32`)
const macLines = () => form.macsText.split(/[\n,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
// 从已知终端加:IP 进终端框;不进内核模式下租约里有 MAC 的顺手填进 MAC 框
const addKnown = (c: { ip: string; mac?: string }) => {
  if (!c.ip || hasSource(c.ip)) return
  form.sourcesText = [...sourceLines(), c.ip].join('\n')
  const mac = (c.mac || '').toLowerCase()
  if (mac && !macLines().includes(mac)) form.macsText = [...macLines(), mac].join('\n')
}

// 已知终端的浮层
const {
  open: knownOpen,
  triggerRef: knownTriggerRef,
  panelRef: knownPanelRef,
  style: knownStyle,
  toggle: knownToggle,
  close: knownClose,
} = useAnchoredDropdown({ minWidth: 320, maxHeight: 300 })
const knownKeyword = ref('')
watch(knownOpen, (v) => {
  if (v) knownKeyword.value = ''
})
watch(isOpen, (v) => {
  if (!v) knownClose()
})
const visibleKnown = computed(() => {
  const kw = knownKeyword.value.trim().toLowerCase()
  return props.knownClients.filter((c) => !kw || c.ip.includes(kw) || (c.name || '').toLowerCase().includes(kw))
})

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

// 和 server/engine/client-routes.mjs 的 normalizeMac 同一套:六组十六进制,冒号或横线
const MAC = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i
const submit = () => {
  const name = form.name.trim()
  if (!name) return fail('clientRouteErrName')
  const sources = form.sourcesText.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)
  if (!sources.length) return fail('clientRouteErrNoSources')
  const bad = sources.find((x) => !isIpOrCidr(x))
  if (bad) return fail('clientRouteErrSources', { value: bad })
  if (form.bypass) {
    const macs = [...new Set(macLines().map((m) => m.replace(/-/g, ':')))]
    if (!macs.length) return fail('clientRouteErrNoMacs')
    const badMac = macs.find((m) => !MAC.test(m))
    if (badMac) return fail('clientRouteErrMacs', { value: badMac })
    emit('saved', { id: form.id, enabled: form.enabled, name, sources: [...new Set(sources)], outbound: '', bypass: true, macs })
    isOpen.value = false
    return
  }
  if (!form.outbound) return fail('clientRouteErrOutbound')
  emit('saved', { id: form.id, enabled: form.enabled, name, sources: [...new Set(sources)], outbound: form.outbound })
  isOpen.value = false
}
</script>
