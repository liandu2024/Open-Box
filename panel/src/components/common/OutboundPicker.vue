<template>
  <!-- 出口选择器:带搜索的浮层,两个页签「节点 / 节点组」。节点按订阅名分组列出;
       节点组页签里内置的直连 / 拒绝排最前。面板 Teleport 出弹窗(见 composables/anchoredDropdown.ts)。 -->
  <div class="w-full">
    <div
      ref="triggerRef"
      role="button"
      tabindex="0"
      class="input input-sm hover:border-base-content/30 flex w-full cursor-pointer items-center gap-1.5"
      @click="toggle"
      @keydown.enter.prevent="toggle"
    >
      <span
        class="min-w-0 flex-1 truncate text-left"
        :class="{ 'text-base-content/40': !modelValue }"
      >{{ modelValue || placeholder }}</span>
      <span
        v-if="currentKind"
        class="text-base-content/50 shrink-0 text-xs"
      >{{ currentKind }}</span>
      <ChevronDownIcon class="text-base-content/40 h-3.5 w-3.5 shrink-0" />
    </div>

    <Teleport to="#app-content">
      <div
        v-if="open"
        ref="panelRef"
        class="app-popover border-base-content/10 z-[1000] flex flex-col gap-2 rounded-lg border p-2 shadow-lg"
        :style="style"
      >
        <div class="flex items-center gap-2">
          <div
            role="tablist"
            class="tabs-box tabs tabs-xs shrink-0"
          >
            <a
              role="tab"
              class="tab"
              :class="tab === 'nodes' && 'tab-active'"
              @click="tab = 'nodes'"
            >{{ $t('clientRouteOutboundNodes') }} ({{ nodes.length }})</a>
            <a
              role="tab"
              class="tab"
              :class="tab === 'groups' && 'tab-active'"
              @click="tab = 'groups'"
            >{{ $t('clientRouteOutboundGroups') }} ({{ groupItems.length }})</a>
          </div>
          <TextInput
            v-model="keyword"
            class="min-w-0 flex-1"
            :placeholder="$t('outboundPickerSearch')"
            clearable
          />
        </div>
        <ul class="min-h-0 flex-1 overflow-y-auto text-sm">
          <template v-if="tab === 'nodes'">
            <template
              v-for="sec in nodeSections"
              :key="sec.subscription"
            >
              <li class="text-base-content/50 px-2 pt-2 pb-1 text-xs font-medium">{{ sec.subscription }}</li>
              <li
                v-for="n in sec.items"
                :key="n"
              >
                <button
                  type="button"
                  class="hover:bg-base-200 flex w-full items-center rounded-md px-2 py-1.5 text-left"
                  :class="{ 'bg-base-200': n === modelValue }"
                  @click="choose(n)"
                >
                  <span class="min-w-0 flex-1 truncate">{{ n }}</span>
                </button>
              </li>
            </template>
          </template>
          <template v-else>
            <li
              v-for="g in visibleGroups"
              :key="g.name"
            >
              <button
                type="button"
                class="hover:bg-base-200 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                :class="{ 'bg-base-200': g.name === modelValue }"
                @click="choose(g.name)"
              >
                <span class="min-w-0 flex-1 truncate">{{ g.name }}</span>
                <span
                  v-if="g.builtin"
                  class="text-base-content/50 shrink-0 text-xs"
                >{{ $t('groupBuiltinBadge') }}</span>
              </button>
            </li>
          </template>
          <li
            v-if="(tab === 'nodes' && !nodeSections.length) || (tab === 'groups' && !visibleGroups.length)"
            class="text-base-content/50 px-2 py-3 text-center text-xs"
          >
            {{ $t('outboundPickerNoMatch') }}
          </li>
        </ul>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import TextInput from '@/components/common/TextInput.vue'
import { useAnchoredDropdown } from '@/composables/anchoredDropdown'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

export interface OutboundPickerOptions {
  // 内置直连 / 拒绝(用它们当前的名字)
  builtin: string[]
  // 用户的节点组
  groups: string[]
  // 单个节点,带订阅名
  nodes: Array<{ name: string; subscription: string }>
}

const props = defineProps<{
  options: OutboundPickerOptions
  placeholder?: string
}>()
const modelValue = defineModel<string>({ required: true })

const { t } = useI18n()
const { open, triggerRef, panelRef, style, toggle, close } = useAnchoredDropdown({ minWidth: 340, maxHeight: 360 })
const tab = ref<'nodes' | 'groups'>('nodes')
const keyword = ref('')
watch(open, (v) => {
  if (!v) return
  keyword.value = ''
  // 打开时停在当前值所在的页签
  const inGroups = props.options.builtin.includes(modelValue.value) || props.options.groups.includes(modelValue.value)
  tab.value = inGroups ? 'groups' : 'nodes'
})

const kw = computed(() => keyword.value.trim().toLowerCase())
const match = (s: string) => !kw.value || s.toLowerCase().includes(kw.value)

const nodes = computed(() => props.options.nodes)
const nodeSections = computed(() => {
  const map = new Map<string, string[]>()
  for (const n of nodes.value) {
    if (!match(n.name) && !match(n.subscription)) continue
    const key = n.subscription || t('outboundPickerNoSubscription')
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(n.name)
  }
  return [...map.entries()].map(([subscription, items]) => ({ subscription, items }))
})
const groupItems = computed(() => [
  ...props.options.builtin.map((name) => ({ name, builtin: true })),
  ...props.options.groups.map((name) => ({ name, builtin: false })),
])
const visibleGroups = computed(() => groupItems.value.filter((g) => match(g.name)))

const currentKind = computed(() => {
  const v = modelValue.value
  if (!v) return ''
  if (props.options.builtin.includes(v)) return t('groupBuiltinBadge')
  if (props.options.groups.includes(v)) return t('clientRouteOutboundGroups')
  const n = nodes.value.find((x) => x.name === v)
  return n ? n.subscription : ''
})

const choose = (name: string) => {
  modelValue.value = name
  close()
}
</script>
