<template>
  <!-- 出口选择器:带搜索的浮层,两个页签「节点 / 节点组」。节点页签里内置的直连 / 拒绝
       排最前(它们是单个出站,不是组),其后按订阅名分组列出节点;节点组页签只有用户的组。
       面板 Teleport 出弹窗(见 composables/anchoredDropdown.ts)。 -->
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
            >{{ $t('clientRouteOutboundNodes') }} ({{ nodes.length + options.builtin.length }})</a>
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
          <!-- 一键测当前页签里列出来的全部节点 / 节点组 -->
          <button
            type="button"
            class="btn btn-circle btn-sm shrink-0"
            :disabled="testingAll"
            v-tip="$t('outboundPickerTestAll')"
            @click="testAll"
          >
            <span
              v-if="testingAll"
              class="loading loading-spinner loading-xs"
            />
            <BoltIcon
              v-else
              class="h-4 w-4"
            />
          </button>
        </div>
        <ul class="min-h-0 flex-1 overflow-y-auto text-sm">
          <template v-if="tab === 'nodes'">
            <template v-if="visibleBuiltin.length">
              <li class="text-base-content/50 px-2 pt-2 pb-1 text-xs font-medium">{{ $t('groupBuiltinBadge') }}</li>
              <li
                v-for="b in visibleBuiltin"
                :key="b"
              >
                <div
                  class="hover:bg-base-200 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left"
                  :class="{ 'bg-base-200': b === modelValue }"
                  :data-active="b === modelValue"
                  @click="choose(b)"
                >
                  <span class="min-w-0 flex-1 truncate">{{ b }}</span>
                  <template v-if="testable(b)">
                    <LatencyTag
                      :name="b"
                      :loading="testing.has(b)"
                    />
                    <button
                      type="button"
                      class="btn btn-ghost btn-square btn-xs shrink-0"
                      v-tip="$t('outboundPickerTestOne')"
                      :disabled="testing.has(b)"
                      @click.stop="testOne(b, 'node')"
                    >
                      <BoltIcon class="h-3.5 w-3.5" />
                    </button>
                  </template>
                </div>
              </li>
            </template>
            <template
              v-for="sec in nodeSections"
              :key="sec.subscription"
            >
              <li class="text-base-content/50 px-2 pt-2 pb-1 text-xs font-medium">{{ sec.subscription }}</li>
              <li
                v-for="n in sec.items"
                :key="n"
              >
                <div
                  class="hover:bg-base-200 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left"
                  :class="{ 'bg-base-200': n === modelValue }"
                  :data-active="n === modelValue"
                  @click="choose(n)"
                >
                  <span class="min-w-0 flex-1 truncate">{{ n }}</span>
                  <LatencyTag
                    :name="n"
                    :loading="testing.has(n)"
                  />
                  <button
                    type="button"
                    class="btn btn-ghost btn-square btn-xs shrink-0"
                    v-tip="$t('outboundPickerTestOne')"
                    :disabled="testing.has(n)"
                    @click.stop="testOne(n, 'node')"
                  >
                    <BoltIcon class="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            </template>
          </template>
          <template v-else>
            <li
              v-for="g in visibleGroups"
              :key="g.name"
            >
              <div
                class="hover:bg-base-200 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left"
                :class="{ 'bg-base-200': g.name === modelValue }"
                :data-active="g.name === modelValue"
                @click="choose(g.name)"
              >
                <span class="min-w-0 flex-1 truncate">{{ g.name }}</span>
                <template v-if="testable(g.name)">
                  <LatencyTag
                    :name="g.name"
                    :loading="testing.has(g.name)"
                  />
                  <button
                    type="button"
                    class="btn btn-ghost btn-square btn-xs shrink-0"
                    v-tip="$t('outboundPickerTestGroupNow')"
                    :disabled="testing.has(g.name)"
                    @click.stop="testOne(g.name, 'group')"
                  >
                    <BoltIcon class="h-3.5 w-3.5" />
                  </button>
                </template>
              </div>
            </li>
          </template>
          <li
            v-if="(tab === 'nodes' && !nodeSections.length && !visibleBuiltin.length) || (tab === 'groups' && !visibleGroups.length)"
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
import LatencyTag from '@/components/proxies/LatencyTag.vue'
import { useAnchoredDropdown } from '@/composables/anchoredDropdown'
import { fetchProxies, getNowProxyNodeName, proxyLatencyTest, proxyMap } from '@/store/proxies'
import { BoltIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import { computed, reactive, ref, watch } from 'vue'
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
  // 打开时停在当前值所在的页签(内置直连 / 拒绝算节点)
  tab.value = props.options.groups.includes(modelValue.value) ? 'groups' : 'nodes'
  // 延迟数据来自内核的 clash API,设置页可能还没拉过
  if (!Object.keys(proxyMap.value).length) void fetchProxies().catch(() => {})
})

// ---- 测速:复用代理页的那套(单个节点 / 整个组),结果写进 proxyMap,LatencyTag 直接读
const testing = reactive(new Set<string>())
const testingAll = ref(false)
// 拒绝出站没有延迟可测;内核里没有的名字(比如还没重启)也测不了
const testable = (name: string) => {
  const p = proxyMap.value[name]
  if (!p) return false
  const type = String(p.type || '').toLowerCase()
  return type !== 'block' && type !== 'reject'
}
// 节点组只测它当前选中的那个节点(顺着 now 找到末端),不把成员全测一遍——
// 延迟标签对组显示的也正是这个节点的延迟,测的和看的是同一个
const targetOf = (name: string, kind: 'node' | 'group') => (kind === 'group' ? getNowProxyNodeName(name) : name)
const testOne = async (name: string, kind: 'node' | 'group') => {
  if (testing.has(name)) return
  const target = targetOf(name, kind)
  if (!testable(target)) return
  testing.add(name)
  try {
    await proxyLatencyTest(target)
  } catch {
    // 失败的提示由 store 里的测速函数自己发
  } finally {
    testing.delete(name)
  }
}
const testAll = async () => {
  if (testingAll.value) return
  testingAll.value = true
  try {
    if (tab.value === 'nodes') {
      // 节点多,5 个一批;内置直连也在这一页(拒绝测不了,testOne 里会跳过)
      const names = [...visibleBuiltin.value, ...nodeSections.value.flatMap((sec) => sec.items)]
      for (let i = 0; i < names.length; i += 5) {
        await Promise.all(names.slice(i, i + 5).map((n) => testOne(n, 'node')))
      }
    } else {
      // 每个组只测当前选中的节点,几个组指向同一个节点时也只测一次
      const seen = new Set<string>()
      const jobs: Array<Promise<void>> = []
      for (const g of visibleGroups.value) {
        if (!testable(g.name)) continue
        const target = targetOf(g.name, 'group')
        if (seen.has(target)) continue
        seen.add(target)
        jobs.push(testOne(g.name, 'group'))
        if (jobs.length >= 5) {
          await Promise.all(jobs.splice(0))
        }
      }
      await Promise.all(jobs)
    }
  } finally {
    testingAll.value = false
  }
}

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
const visibleBuiltin = computed(() => props.options.builtin.filter((name) => match(name)))
const groupItems = computed(() => props.options.groups.map((name) => ({ name })))
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
