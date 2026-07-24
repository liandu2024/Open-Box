<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
    <div
      class="border-base-300/60 bg-base-100 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border p-3 md:p-4"
    >
      <div class="relative z-30 shrink-0 pb-3">
        <div class="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <div class="flex min-w-0 items-center gap-2 md:contents">
            <details
              ref="domainGroupMenuRef"
              class="dropdown dropdown-bottom"
            >
              <summary
                class="select select-sm flex min-w-36 cursor-pointer list-none items-center gap-2 pr-9 md:min-w-44 [&::-webkit-details-marker]:hidden"
              >
                <ProxyIcon
                  v-if="selectedGroupIcon"
                  :icon="selectedGroupIcon"
                  :size="16"
                  :margin="0"
                />
                <QueueListIcon
                  v-else
                  class="text-base-content/60 h-4 w-4 shrink-0"
                />
                <span class="truncate">{{ selectedGroupItem?.label }}</span>
              </summary>

              <ul
                class="proxy-domain-group-dropdown dropdown-content rounded-box border-base-300/60 z-[60] mt-2 flex max-h-[min(24rem,calc(100vh-12rem))] min-w-56 flex-col overflow-x-hidden overflow-y-auto overscroll-contain border p-2 shadow-lg backdrop-blur-none [scrollbar-gutter:stable]"
              >
                <li
                  v-for="group in domainGroupItems"
                  :key="group.key"
                  class="w-full list-none"
                >
                  <button
                    type="button"
                    class="hover:bg-base-200 focus:bg-base-200 flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left transition-colors"
                    @click="selectDomainGroup(group.key)"
                  >
                    <ProxyIcon
                      v-if="group.icon"
                      :icon="group.icon"
                      :size="16"
                      :margin="0"
                    />
                    <QueueListIcon
                      v-else
                      class="text-base-content/60 h-4 w-4 shrink-0"
                    />
                    <span class="truncate">{{ group.label }}</span>
                  </button>
                </li>
              </ul>
            </details>

            <select
              v-model="selectedProvider"
              class="select select-sm min-w-40 md:min-w-44"
              :disabled="providerOptions.length <= 1"
            >
              <option
                v-for="option in providerOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>

          <div class="scrollbar-hidden max-w-full overflow-x-auto md:ml-auto">
            <div
              role="tablist"
              class="domain-penetration-mode bg-base-200/80 inline-flex h-9 min-w-max items-center gap-1 rounded-md p-1 md:h-10"
            >
              <button
                v-for="tab in familyTabs"
                :key="tab.value"
                type="button"
                role="tab"
                class="domain-penetration-mode-btn shrink-0 rounded-md px-3 py-1 text-sm leading-5 font-medium whitespace-nowrap transition-colors md:px-4 md:py-1.5"
                :class="[
                  selectedFamily === tab.value && !tab.disabled
                    ? 'bg-base-100 text-base-content cursor-pointer shadow-sm'
                    : 'text-base-content/60 hover:text-base-content cursor-pointer',
                  tab.disabled &&
                    'text-base-content/30 hover:text-base-content/30 pointer-events-none cursor-default opacity-55',
                ]"
                :aria-disabled="tab.disabled"
                @click="!tab.disabled && (selectedFamily = tab.value)"
              >
                {{ tab.displayLabel }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        class="domain-penetration-table-card border-base-300/60 bg-base-100 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border backdrop-blur-none"
      >
        <div
          v-if="cacheHintText"
          class="border-base-300/60 bg-base-200/40 shrink-0 border-b px-3 py-2 text-sm"
        >
          {{ cacheHintText }}
        </div>

        <div
          ref="tableShellRef"
          class="domain-penetration-table-shell bg-base-100 min-h-0 flex-1 overflow-auto overscroll-contain backdrop-blur-none"
          @scroll.passive="handleTableScroll"
        >
          <template v-if="loading">
            <div class="flex min-h-56 items-center justify-center px-4 text-sm">
              {{ $t('domainPenetrationLoading') }}
            </div>
          </template>
          <template v-else-if="error">
            <div class="flex min-h-56 items-center justify-center px-4 text-sm">
              {{ error }}
            </div>
          </template>
          <template v-else-if="entries.length === 0">
            <div class="flex min-h-56 items-center justify-center px-4 text-sm">
              {{ $t('domainPenetrationEmpty') }}
            </div>
          </template>
          <template v-else>
            <table
              class="domain-penetration-table table-sm table-pin-rows table w-max min-w-full table-auto rounded-none select-text"
            >
              <thead class="bg-base-100 sticky top-0 z-10">
                <tr>
                  <th
                    v-for="column in columns"
                    :key="column.key"
                    class="bg-base-100 whitespace-nowrap select-none"
                    :class="column.width"
                  >
                    <span v-if="!column.sortable">{{ column.label }}</span>
                    <button
                      v-else
                      type="button"
                      class="flex items-center gap-1 text-left"
                      :class="'cursor-pointer'"
                      @click="toggleColumnSort(column)"
                    >
                      <span>{{ column.label }}</span>
                      <ArrowUpCircleIcon
                        v-if="sortKey === column.key && sortDirection === 'asc'"
                        class="h-4 w-4"
                      />
                      <ArrowDownCircleIcon
                        v-else-if="sortKey === column.key && sortDirection === 'desc'"
                        class="h-4 w-4"
                      />
                    </button>
                  </th>
                </tr>
              </thead>
              <Draggable
                v-model="entries"
                tag="tbody"
                :item-key="getEntryDragKey"
                handle=".domain-rule-drag-handle"
                ghost-class="domain-rule-drag-ghost"
                chosen-class="domain-rule-drag-chosen"
                :animation="150"
                :disabled="!canReorderCustomRules"
                @start="handleDragStart"
                @end="handleDragEnd"
              >
                <template #item="{ element: item, index }">
                  <tr
                    class="domain-rule-row hover:bg-primary! hover:text-primary-content h-9"
                    :class="[
                      index % 2 === 0 ? 'bg-base-100' : 'bg-base-200',
                      'select-text',
                      isEditableCustomRule(item) && 'domain-rule-editable-row',
                    ]"
                    :tabindex="isEditableCustomRule(item) ? 0 : undefined"
                    :title="isEditableCustomRule(item) ? $t('customRuleClickToEdit') : undefined"
                    @click="openEditRule(item)"
                    @keydown.enter.prevent="openEditRule(item)"
                  >
                    <td
                      v-if="isSelectedCustomGroup"
                      :class="index % 2 === 0 ? 'bg-base-100' : 'bg-base-200'"
                      class="h-9 w-10 py-0 text-center align-middle select-none"
                    >
                      <button
                        type="button"
                        class="domain-rule-drag-handle text-base-content/40 hover:text-base-content hover:bg-base-300/60 inline-flex h-7 w-7 items-center justify-center rounded-md transition"
                        :class="
                          canReorderCustomRules
                            ? 'cursor-grab active:cursor-grabbing'
                            : 'cursor-not-allowed opacity-35'
                        "
                        :disabled="!canReorderCustomRules"
                        :title="
                          canReorderCustomRules
                            ? $t('customRuleDragHandle')
                            : $t('customRuleDragUnavailable')
                        "
                        :aria-label="$t('customRuleDragHandle')"
                        @click.stop
                      >
                        <Bars3Icon class="h-4 w-4" />
                      </button>
                    </td>
                    <td
                      :class="index % 2 === 0 ? 'bg-base-100' : 'bg-base-200'"
                      class="h-9 cursor-text py-0 align-middle text-sm font-medium whitespace-nowrap select-text"
                    >
                      {{ getTypeLabel(item.type) }}
                    </td>
                    <td
                      :class="index % 2 === 0 ? 'bg-base-100' : 'bg-base-200'"
                      class="h-9 cursor-text py-0 align-middle text-sm whitespace-nowrap select-text"
                    >
                      {{ item.content || '-' }}
                    </td>
                    <td
                      :class="index % 2 === 0 ? 'bg-base-100' : 'bg-base-200'"
                      class="h-9 cursor-text py-0 align-middle text-sm whitespace-nowrap select-text"
                    >
                      {{ item.params || '-' }}
                    </td>
                    <td
                      :class="index % 2 === 0 ? 'bg-base-100' : 'bg-base-200'"
                      class="text-base-content/75 relative h-9 cursor-text py-0 pr-10 align-middle font-mono text-sm whitespace-nowrap select-text"
                    >
                      {{ item.raw }}
                      <button
                        v-if="isDeletableCustomRule()"
                        type="button"
                        class="custom-rule-delete-button destructive-action text-error bg-base-100/85 absolute top-1/2 right-1 inline-flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md shadow-sm transition"
                        :title="$t('deleteCustomRule')"
                        :aria-label="$t('deleteCustomRule')"
                        @pointerdown.stop
                        @click.stop="requestDeleteRule(item)"
                      >
                        <XMarkIcon class="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                </template>
              </Draggable>
            </table>

            <div
              v-if="loadingMore"
              class="text-base-content/70 bg-base-100/80 sticky bottom-0 flex items-center justify-center py-2 text-sm"
            >
              {{ $t('domainPenetrationLoading') }}
            </div>
          </template>
        </div>
      </div>
    </div>

    <DialogWrapper
      v-model="editRuleDialogOpen"
      :title="$t('editCustomRule')"
      box-class="w-[min(32rem,calc(100vw-2rem))] max-w-none"
      content-class="overflow-visible!"
    >
      <form
        class="flex flex-col gap-4"
        @submit.prevent="submitEditRule"
      >
        <div class="text-base-content/70 text-sm">
          {{
            $t('addDomainRuleTarget', {
              group: selectedGroupItem?.label || '-',
            })
          }}
        </div>

        <label class="form-control gap-1">
          <span class="label-text text-sm">{{ $t('ruleType') }}</span>
          <select
            v-model="editRuleForm.type"
            class="select select-sm w-full"
          >
            <option
              v-for="option in editableRuleTypeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-sm">
            {{ isEditRuleIpType ? $t('ip') : $t('domain') }}
          </span>
          <input
            v-model="editRuleForm.value"
            type="text"
            class="input input-sm w-full"
            :placeholder="editRuleValuePlaceholder"
            autocomplete="off"
          />
        </label>

        <div class="form-control gap-1">
          <span class="label-text text-sm">{{ $t('params') }}</span>
          <div class="relative">
            <button
              type="button"
              class="select select-sm flex w-full cursor-pointer items-center justify-between gap-2 pr-9 text-left"
              :class="editRuleParamDropdownOpen && 'select-primary'"
              @click="toggleEditRuleParamDropdown"
            >
              <span class="min-w-0 flex-1 truncate">
                {{ selectedEditRuleParamOption?.name || editRuleForm.param }}
              </span>
              <ChevronDownIcon
                class="h-4 w-4 shrink-0 transition-transform"
                :class="editRuleParamDropdownOpen && 'rotate-180'"
              />
            </button>

            <div
              v-if="editRuleParamDropdownOpen"
              class="border-base-300 bg-base-100! absolute right-0 bottom-full left-0 z-[70] mb-2 rounded-md border [background-color:var(--color-base-100)] p-2 shadow-xl backdrop-blur-none!"
            >
              <div class="flex min-w-0 items-center gap-2">
                <div
                  role="tablist"
                  class="bg-base-200/80 inline-flex h-8 min-w-max shrink-0 items-center gap-1 rounded-md p-1"
                >
                  <button
                    type="button"
                    role="tab"
                    class="h-6 shrink-0 cursor-pointer rounded-md px-3 text-sm leading-6 font-medium whitespace-nowrap transition-colors"
                    :class="
                      editRuleParamTab === 'group'
                        ? 'bg-base-100 text-base-content shadow-sm'
                        : 'text-base-content/60 hover:text-base-content'
                    "
                    @click="editRuleParamTab = 'group'"
                  >
                    {{ $t('proxyParamGroup') }}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    class="h-6 shrink-0 cursor-pointer rounded-md px-3 text-sm leading-6 font-medium whitespace-nowrap transition-colors"
                    :class="
                      editRuleParamTab === 'node'
                        ? 'bg-base-100 text-base-content shadow-sm'
                        : 'text-base-content/60 hover:text-base-content'
                    "
                    @click="editRuleParamTab = 'node'"
                  >
                    {{ $t('proxyParamNode') }}
                  </button>
                </div>
                <TextInput
                  v-model="editRuleParamSearch"
                  class="min-w-0 flex-1"
                  :placeholder="$t('search')"
                  :clearable="true"
                />
                <button
                  type="button"
                  class="btn btn-circle btn-sm shrink-0"
                  :disabled="isEditRuleParamTestingAll || editRuleParamTestableOptions.length === 0"
                  :title="$t('latency')"
                  @click="testCurrentEditRuleParamTab"
                >
                  <span
                    v-if="isEditRuleParamTestingAll"
                    class="loading loading-spinner loading-sm"
                  />
                  <BoltIcon
                    v-else
                    class="h-4 w-4"
                  />
                </button>
              </div>

              <div
                class="border-base-300/70 bg-base-100! mt-2 max-h-44 overflow-y-auto rounded-md border [background-color:var(--color-base-100)] backdrop-blur-none!"
              >
                <div
                  v-if="filteredEditRuleParamOptions.length === 0"
                  class="text-base-content/60 flex h-16 items-center justify-center text-sm"
                >
                  {{ $t('noData') }}
                </div>
                <template v-else>
                  <div
                    v-for="option in filteredEditRuleParamOptions"
                    :key="`${option.type}:${option.name}`"
                    class="hover:bg-base-200 flex min-h-10 items-center gap-2 px-3 py-2 text-sm transition-colors"
                    :class="editRuleForm.param === option.name && 'bg-primary/10'"
                  >
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                      @click="selectEditRuleParam(option.name)"
                    >
                      <span class="h-4 w-4 shrink-0">
                        <CheckIcon
                          v-if="editRuleForm.param === option.name"
                          class="h-4 w-4"
                        />
                      </span>
                      <span class="min-w-0 flex-1 truncate">{{ option.name }}</span>
                      <span
                        v-if="option.description"
                        class="text-base-content/55 shrink-0 text-xs"
                      >
                        {{ option.description }}
                      </span>
                      <span
                        v-if="option.type !== 'builtin'"
                        class="text-base-content/45 hidden shrink-0 text-xs md:inline"
                      >
                        {{ option.type === 'group' ? $t('proxyParamGroup') : $t('proxyParamNode') }}
                      </span>
                    </button>
                    <LatencyTag
                      v-if="option.type !== 'builtin'"
                      class="bg-base-200/50 hover:bg-base-200 shrink-0 cursor-pointer"
                      :name="getEditRuleParamLatencyTarget(option)"
                      :group-name="getEditRuleParamLatencyGroup(option)"
                      :loading="isEditRuleParamTesting(option)"
                      @click="testEditRuleParamOption(option)"
                    />
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <div class="pending-restart-dialog-footer modal-action mt-1">
          <p class="pending-restart-dialog-hint">
            {{ $t('editCustomRuleHint') }}
          </p>
          <div class="pending-restart-dialog-actions">
            <button
              type="button"
              class="btn btn-sm"
              :disabled="isSavingEditRule"
              @click="editRuleDialogOpen = false"
            >
              {{ $t('cancel') }}
            </button>
            <button
              type="submit"
              class="btn btn-primary btn-sm"
              :disabled="
                isSavingEditRule || !editRuleForm.value.trim() || !editRuleForm.param.trim()
              "
            >
              <span
                v-if="isSavingEditRule"
                class="loading loading-spinner loading-sm"
              />
              {{ $t('save') }}
            </button>
          </div>
        </div>
      </form>
    </DialogWrapper>

    <DialogWrapper
      v-model="deleteRuleDialogOpen"
      :title="$t('deleteCustomRule')"
      box-class="w-[min(32rem,calc(100vw-2rem))] max-w-none"
    >
      <div class="flex flex-col gap-4">
        <div class="text-base-content/70 text-sm">
          {{
            $t('addDomainRuleTarget', {
              group: selectedGroupItem?.label || '-',
            })
          }}
        </div>
        <p class="break-all whitespace-pre-wrap">
          {{
            $t('confirmDeleteCustomRule', {
              record: deletingEntry?.raw || '-',
            })
          }}
        </p>

        <div class="pending-restart-dialog-footer modal-action mt-1">
          <p class="pending-restart-dialog-hint">
            {{ $t('deleteCustomRuleHint') }}
          </p>
          <div class="pending-restart-dialog-actions">
            <button
              type="button"
              class="btn btn-sm"
              :disabled="isDeletingRule"
              @click="deleteRuleDialogOpen = false"
            >
              {{ $t('cancel') }}
            </button>
            <button
              type="button"
              class="btn btn-error btn-sm"
              :disabled="isDeletingRule"
              @click="confirmDeleteRule"
            >
              <span
                v-if="isDeletingRule"
                class="loading loading-spinner loading-sm"
              />
              {{ $t('deleteAction') }}
            </button>
          </div>
        </div>
      </div>
    </DialogWrapper>
  </div>
</template>

<script setup lang="ts">
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import TextInput from '@/components/common/TextInput.vue'
import {
  disableProxiesPageScroll,
  domainGroupProviderNames,
  domainGroups,
  domainGroupSearch,
  domainGroupSelectedName,
  domainGroupSelectedProvider,
  domainRuleConfigChanged,
  domainRulesReloadRevision,
  nodeGroups,
} from '@/composables/proxies'
import { getProxyNodeProtocolDescription, isPassRuleProxy, isProxyGroup } from '@/helper'
import { showNotification } from '@/helper/notification'
import {
  DOMAIN_GROUP_CUSTOM_SOURCE,
  DOMAIN_GROUP_POST_CUSTOM_KEY,
  DOMAIN_GROUP_PRE_CUSTOM_KEY,
  isDomainGroupCustomKey,
} from '@/helper/proxyDomainGroups'
import { fetchServerApi } from '@/store/auth'
import {
  getIPv6ByName,
  getNowProxyNodeName,
  getTestUrl,
  proxyLatencyTest,
  proxyMap,
  proxyNodesLatencyTest,
} from '@/store/proxies'
import type {
  ProxyGroupRulePenetrationEntry,
  ProxyGroupRulePenetrationFamily,
  ProxyGroupRulePenetrationSortKey,
} from '@/store/proxyGroupRulePenetration'
import { fetchRules, rules } from '@/store/rules'
import { IPv6test } from '@/store/settings'
import type { Rule } from '@/types'
import {
  ArrowDownCircleIcon,
  ArrowUpCircleIcon,
  Bars3Icon,
  BoltIcon,
  CheckIcon,
  ChevronDownIcon,
  QueueListIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Draggable from 'vuedraggable'
import LatencyTag from './LatencyTag.vue'
import ProxyIcon from './ProxyIcon.vue'

type GroupTabValue = Exclude<ProxyGroupRulePenetrationFamily, 'other'>
type FamilyTabItem = {
  value: GroupTabValue
  label: string
  count: number
  disabled: boolean
  displayLabel: string
}

type DomainRuleColumn = {
  key: 'drag' | ProxyGroupRulePenetrationSortKey
  label: string
  width: string
  sortable: boolean
}

type DragEndEvent = {
  oldIndex?: number
  newIndex?: number
}

type CustomRuleParamOption = {
  name: string
  type: 'builtin' | 'group' | 'node'
  index: number
  searchable: string
  description?: string
}

type DomainGroupResponse = {
  cacheKey: string
  counts: {
    all: number
    domain: number
    ip: number
    port: number
  }
  items: ProxyGroupRulePenetrationEntry[]
  missingProviders: string[]
  page: number
  hasMore: boolean
}

const PAGE_SIZE = 100
const SEARCH_DEBOUNCE_MS = 180

const { t } = useI18n()
const tableShellRef = ref<HTMLElement | null>(null)
const domainGroupMenuRef = ref<HTMLDetailsElement | null>(null)
const selectedGroupName = domainGroupSelectedName
const selectedFamily = ref<GroupTabValue>('all')
const selectedProvider = domainGroupSelectedProvider
const search = domainGroupSearch
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const entries = ref<ProxyGroupRulePenetrationEntry[]>([])
const dragSnapshot = ref<ProxyGroupRulePenetrationEntry[]>([])
const isReordering = ref(false)
const suppressRowClick = ref(false)
const editRuleDialogOpen = ref(false)
const isSavingEditRule = ref(false)
const editingEntry = ref<ProxyGroupRulePenetrationEntry | null>(null)
const editRuleParamSearch = ref('')
const editRuleParamTab = ref<'group' | 'node'>('group')
const editRuleParamDropdownOpen = ref(false)
const editRuleParamTesting = ref<Record<string, boolean>>({})
const isEditRuleParamTestingAll = ref(false)
const deleteRuleDialogOpen = ref(false)
const isDeletingRule = ref(false)
const deletingEntry = ref<ProxyGroupRulePenetrationEntry | null>(null)
const deletingCustomGroupMode = ref('')
const editRuleForm = ref({
  type: 'DOMAIN-SUFFIX',
  value: '',
  param: 'DIRECT',
  originalRule: '',
  customGroupMode: '',
})
const missingProviders = ref<string[]>([])
const counts = ref({
  all: 0,
  domain: 0,
  ip: 0,
  port: 0,
})
const sortKey = ref<ProxyGroupRulePenetrationSortKey | null>(null)
const sortDirection = ref<'asc' | 'desc'>('asc')
const page = ref(1)
const hasMore = ref(false)
const cacheKey = ref('')
const debouncedSearchRevision = ref(0)

let searchTimer = 0
let latestRequestId = 0
let fillingViewport = false

const serializeRules = (items: Rule[]) => {
  return items.map((rule) => ({
    type: rule.type,
    payload: rule.payload,
    proxy: rule.proxy,
    index: rule.index,
    disabled: rule.disabled,
    extra: rule.extra
      ? {
          disabled: rule.extra.disabled,
        }
      : undefined,
  }))
}

const ruleTypeLabelKeyMap: Record<string, string> = {
  DOMAIN: 'ruleTypeDomain',
  'DOMAIN-SUFFIX': 'ruleTypeDomainSuffix',
  'DOMAIN-KEYWORD': 'ruleTypeDomainKeyword',
  'IP-CIDR': 'ruleTypeDestinationIP',
  'IP-CIDR6': 'ruleTypeDestinationIP',
  'SRC-IP': 'ruleTypeSourceIP',
  'SRC-IP-CIDR': 'ruleTypeSourceIP',
  'SRC-IP-CIDR6': 'ruleTypeSourceIP',
  'DST-PORT': 'ruleTypeDestinationPort',
  'SRC-PORT': 'ruleTypeSourcePort',
  'IN-PORT': 'ruleTypeInboundPort',
  GEOIP: 'ruleTypeGeoIP',
  MATCH: 'ruleTypeMatch',
  FINAL: 'ruleTypeFinal',
}

const editableRuleTypes = new Set([
  'DOMAIN-SUFFIX',
  'DOMAIN',
  'DOMAIN-KEYWORD',
  'IP-CIDR',
  'IP-CIDR6',
  'SRC-IP-CIDR',
  'SRC-IP-CIDR6',
])
const editableIpRuleTypes = new Set(['IP-CIDR', 'IP-CIDR6', 'SRC-IP-CIDR', 'SRC-IP-CIDR6'])
const editableRuleTypeOptions = computed(() => [
  { value: 'DOMAIN-SUFFIX', label: t('ruleTypeDomainSuffix') },
  { value: 'DOMAIN', label: t('ruleTypeDomain') },
  { value: 'DOMAIN-KEYWORD', label: t('ruleTypeDomainKeyword') },
  { value: 'IP-CIDR', label: t('ruleTypeDestinationIP') },
  { value: 'IP-CIDR6', label: t('ruleTypeDestinationIPv6') },
  { value: 'SRC-IP-CIDR', label: t('ruleTypeSourceIP') },
  { value: 'SRC-IP-CIDR6', label: t('ruleTypeSourceIPv6') },
])
const isEditRuleIpType = computed(() => editableIpRuleTypes.has(editRuleForm.value.type))
const editRuleValuePlaceholder = computed(() => {
  if (editRuleForm.value.type === 'IP-CIDR6') return '2001:db8::/32'
  if (editRuleForm.value.type === 'SRC-IP-CIDR6') return '2001:db8::1/128'
  if (editRuleForm.value.type === 'IP-CIDR') return '8.8.8.8/32'
  if (editRuleForm.value.type === 'SRC-IP-CIDR') return '192.168.1.10/32'
  if (editRuleForm.value.type === 'DOMAIN-KEYWORD') return 'keyword'
  return 'example.com'
})
const editRuleParamOptions = computed<CustomRuleParamOption[]>(() => {
  const options: CustomRuleParamOption[] = []
  const seen = new Set<string>()
  const append = (name: string, type: CustomRuleParamOption['type'], description?: string) => {
    const normalizedName = String(name || '').trim()

    if (!normalizedName || seen.has(normalizedName)) return

    seen.add(normalizedName)
    options.push({
      name: normalizedName,
      type,
      index: options.length,
      searchable: normalizedName.toLowerCase(),
      description,
    })
  }

  append('DIRECT', 'builtin')
  append('REJECT', 'builtin')
  nodeGroups.value.forEach((name) => append(name, 'group'))
  Object.values(proxyMap.value).forEach((proxy) => {
    if (proxy && !isPassRuleProxy(proxy) && !isProxyGroup(proxy.name)) {
      append(
        proxy.name,
        'node',
        getProxyNodeProtocolDescription(proxy, IPv6test.value && getIPv6ByName(proxy.name)),
      )
    }
  })

  return options
})
const filteredEditRuleParamOptions = computed(() => {
  const keywords = editRuleParamSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const filteredOptions = keywords.length
    ? editRuleParamOptions.value.filter((option) =>
        keywords.every((keyword) => option.searchable.includes(keyword)),
      )
    : editRuleParamOptions.value
  const builtins =
    editRuleParamTab.value === 'node'
      ? filteredOptions.filter((option) => option.type === 'builtin')
      : []
  const selectableOptions = filteredOptions
    .filter((option) => option.type === editRuleParamTab.value)
    .sort((left, right) => left.index - right.index)

  return [...builtins, ...selectableOptions]
})
const selectedEditRuleParamOption = computed(() =>
  editRuleParamOptions.value.find((option) => option.name === editRuleForm.value.param),
)
const editRuleParamTestableOptions = computed(() =>
  filteredEditRuleParamOptions.value.filter((option) => option.type !== 'builtin'),
)

const isSelectedCustomGroup = computed(() => isDomainGroupCustomKey(selectedGroupName.value))

const columns = computed<DomainRuleColumn[]>(() => {
  return [
    ...(isSelectedCustomGroup.value
      ? [{ key: 'drag' as const, label: '', width: 'w-10', sortable: false }]
      : []),
    { key: 'type', label: t('category'), width: 'w-22 md:w-32', sortable: true },
    { key: 'content', label: t('content'), width: 'w-34 md:w-72', sortable: true },
    { key: 'params', label: t('params'), width: 'w-24 md:w-36', sortable: true },
    { key: 'raw', label: t('rawContent'), width: 'w-52 md:w-auto', sortable: true },
  ]
})

const canReorderCustomRules = computed(() => {
  return (
    isSelectedCustomGroup.value &&
    selectedFamily.value === 'all' &&
    !selectedProvider.value &&
    !search.value.trim() &&
    sortKey.value === null &&
    !loading.value &&
    !loadingMore.value &&
    !hasMore.value &&
    !isReordering.value
  )
})

const resetSortState = () => {
  sortKey.value = null
  sortDirection.value = 'asc'
}

const getCustomGroupMode = (groupName: string) => {
  if (groupName === DOMAIN_GROUP_PRE_CUSTOM_KEY) {
    return 'pre'
  }

  if (groupName === DOMAIN_GROUP_POST_CUSTOM_KEY) {
    return 'post'
  }

  return ''
}

const domainGroupItems = computed(() => {
  return domainGroups.value.map((name) => {
    const proxy = proxyMap.value[name]
    const label =
      name === DOMAIN_GROUP_PRE_CUSTOM_KEY
        ? t('preCustom')
        : name === DOMAIN_GROUP_POST_CUSTOM_KEY
          ? t('postCustom')
          : name

    return {
      key: name,
      label,
      icon: isDomainGroupCustomKey(name) ? '' : proxy?.icon || '',
    }
  })
})

const selectedGroupItem = computed(() => {
  return domainGroupItems.value.find((item) => item.key === selectedGroupName.value) || null
})

const selectedGroupIcon = computed(() => {
  return selectedGroupItem.value?.icon || ''
})

const closeDomainGroupMenu = () => {
  domainGroupMenuRef.value?.removeAttribute('open')
}

const handleOutsidePointerDown = (event: PointerEvent) => {
  const menu = domainGroupMenuRef.value
  const target = event.target

  if (!menu?.hasAttribute('open') || !(target instanceof Node) || menu.contains(target)) {
    return
  }

  closeDomainGroupMenu()
}

const selectDomainGroup = (key: string) => {
  selectedGroupName.value = key
  closeDomainGroupMenu()
}

const providerOptions = computed(() => {
  const options = [
    {
      value: '',
      label: t('allRuleSets'),
    },
  ]

  if (!selectedGroupName.value || isDomainGroupCustomKey(selectedGroupName.value)) {
    return options
  }

  domainGroupProviderNames.value.forEach((option) => {
    options.push({
      value: option,
      label: option === DOMAIN_GROUP_CUSTOM_SOURCE ? t('custom') : option,
    })
  })

  return options
})

const familyTabs = computed<FamilyTabItem[]>(() => {
  return [
    {
      value: 'all' as GroupTabValue,
      label: t('all'),
      count: counts.value.all,
      disabled: counts.value.all === 0,
    },
    {
      value: 'domain' as GroupTabValue,
      label: t('domain'),
      count: counts.value.domain,
      disabled: counts.value.domain === 0,
    },
    {
      value: 'ip' as GroupTabValue,
      label: t('ip'),
      count: counts.value.ip,
      disabled: counts.value.ip === 0,
    },
    {
      value: 'port' as GroupTabValue,
      label: t('port'),
      count: counts.value.port,
      disabled: counts.value.port === 0,
    },
  ].map((tab) => ({
    ...tab,
    displayLabel: tab.count > 0 ? `${tab.label} (${tab.count})` : tab.label,
  }))
})

const cacheHintText = computed(() => {
  if (missingProviders.value.length === 0) {
    return ''
  }

  return `${t('domainPenetrationMissingProviders')}: ${missingProviders.value.join(', ')}`
})

const getTypeLabel = (type: string) => {
  return t(ruleTypeLabelKeyMap[type] || 'ruleTypeOther')
}

const getEntryDragKey = (item: ProxyGroupRulePenetrationEntry) =>
  `${item.source}\u0000${item.line ?? ''}\u0000${item.raw}`

const isEditableCustomRule = (item: ProxyGroupRulePenetrationEntry) =>
  isSelectedCustomGroup.value && editableRuleTypes.has(item.type)

const isDeletableCustomRule = () => isSelectedCustomGroup.value

const getEditRuleParamLatencyTarget = (option: CustomRuleParamOption) =>
  option.type === 'group' ? getNowProxyNodeName(option.name) : option.name

const getEditRuleParamLatencyGroup = (option: CustomRuleParamOption) =>
  option.type === 'group' ? option.name : undefined

const setEditRuleParamTesting = (option: CustomRuleParamOption, testing: boolean) => {
  const key = `${option.type}:${option.name}`
  editRuleParamTesting.value = {
    ...editRuleParamTesting.value,
    [key]: testing,
  }
}

const isEditRuleParamTesting = (option: CustomRuleParamOption) =>
  editRuleParamTesting.value[`${option.type}:${option.name}`] ?? false

const testEditRuleParamOption = async (option: CustomRuleParamOption) => {
  if (option.type === 'builtin' || isEditRuleParamTesting(option)) return

  setEditRuleParamTesting(option, true)
  try {
    await proxyLatencyTest(
      getEditRuleParamLatencyTarget(option),
      getTestUrl(getEditRuleParamLatencyGroup(option)),
    )
  } catch {
    // The latency helper shows the request result to the user.
  } finally {
    setEditRuleParamTesting(option, false)
  }
}

const testCurrentEditRuleParamTab = async () => {
  if (isEditRuleParamTestingAll.value) return

  const options = editRuleParamTestableOptions.value
  const nodesByUrl = new Map<string, Set<string>>()

  options.forEach((option) => {
    const node = getEditRuleParamLatencyTarget(option)

    if (!node) return

    const url = getTestUrl(getEditRuleParamLatencyGroup(option))
    const nodes = nodesByUrl.get(url) || new Set<string>()
    nodes.add(node)
    nodesByUrl.set(url, nodes)
  })

  if (nodesByUrl.size === 0) return

  isEditRuleParamTestingAll.value = true
  options.forEach((option) => setEditRuleParamTesting(option, true))

  try {
    let testIndex = 0

    for (const [url, nodes] of nodesByUrl) {
      await proxyNodesLatencyTest('domain-rule-param', [...nodes], {
        displayName: t('params'),
        keyName: `domain-rule-param-${editRuleParamTab.value}-${testIndex++}`,
        url,
      })
    }
  } finally {
    options.forEach((option) => setEditRuleParamTesting(option, false))
    isEditRuleParamTestingAll.value = false
  }
}

const toggleEditRuleParamDropdown = () => {
  if (!editRuleParamDropdownOpen.value) {
    const currentTarget = editRuleForm.value.param.split(',')[0]?.trim() || ''
    const currentOption = editRuleParamOptions.value.find((option) => option.name === currentTarget)
    editRuleParamTab.value = currentOption?.type === 'group' ? 'group' : 'node'
  }

  editRuleParamDropdownOpen.value = !editRuleParamDropdownOpen.value
}

const selectEditRuleParam = (name: string) => {
  editRuleForm.value.param = name
  editRuleParamDropdownOpen.value = false
}

const openEditRule = (item: ProxyGroupRulePenetrationEntry) => {
  if (
    suppressRowClick.value ||
    isReordering.value ||
    isSavingEditRule.value ||
    !isEditableCustomRule(item)
  ) {
    return
  }

  const [type, value, ...paramParts] = item.raw.split(',').map((part) => part.trim())
  const customGroupMode = getCustomGroupMode(selectedGroupName.value)

  if (!editableRuleTypes.has(type) || !value || !paramParts.length || !customGroupMode) {
    return
  }

  editingEntry.value = item
  editRuleForm.value = {
    type,
    value,
    param: paramParts.join(','),
    originalRule: item.raw,
    customGroupMode,
  }
  editRuleParamSearch.value = ''
  editRuleParamDropdownOpen.value = false
  editRuleDialogOpen.value = true
}

const getEditedRuleFamily = (type: string): ProxyGroupRulePenetrationEntry['family'] => {
  if (type.startsWith('DOMAIN')) return 'domain'
  if (type.includes('IP')) return 'ip'
  return 'other'
}

const submitEditRule = async () => {
  if (
    isSavingEditRule.value ||
    !editingEntry.value ||
    !editRuleForm.value.value.trim() ||
    !editRuleForm.value.param.trim()
  ) {
    return
  }

  isSavingEditRule.value = true

  try {
    const response = await fetchServerApi('/api/proxy-domain-rules', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        originalRule: editRuleForm.value.originalRule,
        customGroupMode: editRuleForm.value.customGroupMode,
        type: editRuleForm.value.type,
        value: editRuleForm.value.value,
        target: editRuleForm.value.param,
      }),
    })
    const data = (await response.json().catch(() => null)) as {
      message?: string
      changed?: boolean
      rule?: string
    } | null

    if (!response.ok || !data?.rule) {
      throw new Error(data?.message || `Failed to update custom rule: ${response.status}`)
    }

    const currentEntry = editingEntry.value
    const entryIndex = entries.value.findIndex(
      (item) => item === currentEntry || item.raw === editRuleForm.value.originalRule,
    )
    const [type, value, ...paramParts] = data.rule.split(',').map((part) => part.trim())
    const nextFamily = getEditedRuleFamily(type)

    if (entryIndex >= 0) {
      entries.value[entryIndex] = {
        ...currentEntry,
        type,
        family: nextFamily,
        content: value,
        params: paramParts.join(','),
        raw: data.rule,
      }
    }

    if (currentEntry.family !== nextFamily) {
      if (currentEntry.family === 'domain')
        counts.value.domain = Math.max(0, counts.value.domain - 1)
      if (currentEntry.family === 'ip') counts.value.ip = Math.max(0, counts.value.ip - 1)
      if (currentEntry.family === 'port') counts.value.port = Math.max(0, counts.value.port - 1)
      if (nextFamily === 'domain') counts.value.domain += 1
      if (nextFamily === 'ip') counts.value.ip += 1
      if (nextFamily === 'port') counts.value.port += 1

      if (
        selectedFamily.value !== 'all' &&
        selectedFamily.value !== nextFamily &&
        entryIndex >= 0
      ) {
        entries.value.splice(entryIndex, 1)
      }
    }

    if (data.changed) {
      domainRuleConfigChanged.value = true
      cacheKey.value = ''
    }

    editRuleDialogOpen.value = false
    showNotification({
      key: 'custom-rule-updated',
      content: 'customRuleUpdated',
      type: 'alert-success',
    })
  } catch (updateError) {
    console.error(updateError)
    showNotification({
      key: 'custom-rule-update-failed',
      content: 'customRuleUpdateFailed',
      type: 'alert-error',
    })
  } finally {
    isSavingEditRule.value = false
  }
}

const requestDeleteRule = (item: ProxyGroupRulePenetrationEntry) => {
  const customGroupMode = getCustomGroupMode(selectedGroupName.value)

  if (!isDeletableCustomRule() || !customGroupMode || isDeletingRule.value) {
    return
  }

  deletingEntry.value = item
  deletingCustomGroupMode.value = customGroupMode
  deleteRuleDialogOpen.value = true
}

const confirmDeleteRule = async () => {
  if (isDeletingRule.value || !deletingEntry.value || !deletingCustomGroupMode.value) {
    return
  }

  isDeletingRule.value = true
  const targetEntry = deletingEntry.value

  try {
    const response = await fetchServerApi('/api/proxy-domain-rules', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customGroupMode: deletingCustomGroupMode.value,
        rule: targetEntry.raw,
      }),
    })
    const data = (await response.json().catch(() => null)) as {
      message?: string
      changed?: boolean
      rule?: string
    } | null

    if (!response.ok || !data?.changed) {
      throw new Error(data?.message || `Failed to delete custom rule: ${response.status}`)
    }

    const entryIndex = entries.value.findIndex(
      (item) => item === targetEntry || item.raw === targetEntry.raw,
    )

    if (entryIndex >= 0) {
      entries.value.splice(entryIndex, 1)
    }

    counts.value.all = Math.max(0, counts.value.all - 1)
    if (targetEntry.family === 'domain') {
      counts.value.domain = Math.max(0, counts.value.domain - 1)
    } else if (targetEntry.family === 'ip') {
      counts.value.ip = Math.max(0, counts.value.ip - 1)
    } else if (targetEntry.family === 'port') {
      counts.value.port = Math.max(0, counts.value.port - 1)
    }

    domainRuleConfigChanged.value = true
    cacheKey.value = ''
    deleteRuleDialogOpen.value = false
    showNotification({
      key: 'custom-rule-deleted',
      content: 'customRuleDeleted',
      type: 'alert-success',
    })
  } catch (deleteError) {
    console.error(deleteError)
    showNotification({
      key: 'custom-rule-delete-failed',
      content: 'customRuleDeleteFailed',
      type: 'alert-error',
    })
  } finally {
    isDeletingRule.value = false
  }
}

const resetListState = () => {
  entries.value = []
  missingProviders.value = []
  error.value = ''
  counts.value = {
    all: 0,
    domain: 0,
    ip: 0,
    port: 0,
  }
  page.value = 1
  hasMore.value = false
}

const buildRequestBody = (targetPage: number) => {
  const customGroupMode = getCustomGroupMode(selectedGroupName.value)

  return {
    groupName: selectedGroupName.value,
    customGroup: Boolean(customGroupMode),
    customGroupMode: customGroupMode || undefined,
    providerName:
      selectedProvider.value === DOMAIN_GROUP_CUSTOM_SOURCE ? 'controller' : selectedProvider.value,
    page: targetPage,
    pageSize: customGroupMode ? 500 : PAGE_SIZE,
    tab: selectedFamily.value,
    search: search.value.trim(),
    sortKey: sortKey.value,
    sortDirection: sortDirection.value,
    ...(customGroupMode
      ? {}
      : cacheKey.value
        ? { cacheKey: cacheKey.value }
        : { rules: serializeRules(rules.value) }),
  }
}

const requestEntries = async (targetPage: number) => {
  let response = await fetchServerApi('/api/proxy-group-rule-penetration', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(buildRequestBody(targetPage)),
  })

  if (response.status === 410 && cacheKey.value) {
    cacheKey.value = ''
    response = await fetchServerApi('/api/proxy-group-rule-penetration', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildRequestBody(targetPage)),
    })
  }

  return response
}

const maybeFillViewport = async () => {
  if (fillingViewport) {
    return
  }

  const shell = tableShellRef.value

  if (!shell || loading.value || loadingMore.value || !hasMore.value) {
    return
  }

  fillingViewport = true

  try {
    while (
      hasMore.value &&
      !loading.value &&
      !loadingMore.value &&
      shell.scrollHeight <= shell.clientHeight + 48
    ) {
      await loadEntries({ append: true })
      await nextTick()
    }
  } finally {
    fillingViewport = false
  }
}

const loadEntries = async (options?: { append?: boolean }) => {
  if (!selectedGroupName.value) {
    resetListState()
    return
  }

  if (rules.value.length === 0) {
    await fetchRules()
  }

  const append = options?.append === true
  const targetPage = append ? page.value + 1 : 1
  const requestId = ++latestRequestId

  if (append) {
    if (loading.value || loadingMore.value || !hasMore.value) {
      return
    }

    loadingMore.value = true
  } else {
    loading.value = true
    error.value = ''
    page.value = 1
    hasMore.value = false
    entries.value = []
    missingProviders.value = []
  }

  try {
    const response = await requestEntries(targetPage)

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { message?: string } | null
      throw new Error(errorBody?.message || `Failed to load domain group rules: ${response.status}`)
    }

    const data = (await response.json()) as DomainGroupResponse

    if (requestId !== latestRequestId) {
      return
    }

    cacheKey.value = isSelectedCustomGroup.value ? '' : data.cacheKey || cacheKey.value
    counts.value = data.counts
    page.value = data.page
    hasMore.value = data.hasMore
    missingProviders.value = data.missingProviders
    entries.value = append ? [...entries.value, ...data.items] : data.items

    if (!append) {
      tableShellRef.value?.scrollTo({ top: 0 })
    }

    await nextTick()
    await maybeFillViewport()
  } catch (loadError) {
    if (requestId !== latestRequestId) {
      return
    }

    if (!append) {
      resetListState()
    }

    error.value = loadError instanceof Error ? loadError.message : String(loadError)
  } finally {
    if (requestId === latestRequestId) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

const handleTableScroll = () => {
  const shell = tableShellRef.value

  if (!shell || loading.value || loadingMore.value || !hasMore.value) {
    return
  }

  if (shell.scrollTop + shell.clientHeight >= shell.scrollHeight - 160) {
    void loadEntries({ append: true })
  }
}

const toggleSort = (key: ProxyGroupRulePenetrationSortKey) => {
  if (sortKey.value !== key) {
    sortKey.value = key
    sortDirection.value = 'asc'
    return
  }

  if (sortDirection.value === 'asc') {
    sortDirection.value = 'desc'
    return
  }

  sortKey.value = null
  sortDirection.value = 'asc'
}

const toggleColumnSort = (column: DomainRuleColumn) => {
  if (!column.sortable || column.key === 'drag') {
    return
  }

  toggleSort(column.key)
}

const handleDragStart = () => {
  if (!canReorderCustomRules.value) {
    return
  }

  dragSnapshot.value = [...entries.value]
  suppressRowClick.value = true
}

const releaseRowClick = () => {
  window.setTimeout(() => {
    suppressRowClick.value = false
  }, 0)
}

const handleDragEnd = async (event: DragEndEvent) => {
  if (
    !canReorderCustomRules.value ||
    event.oldIndex === undefined ||
    event.newIndex === undefined ||
    event.oldIndex === event.newIndex
  ) {
    dragSnapshot.value = []
    releaseRowClick()
    return
  }

  const previousEntries = dragSnapshot.value
  isReordering.value = true

  try {
    const response = await fetchServerApi('/api/proxy-domain-rules/order', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customGroupMode: getCustomGroupMode(selectedGroupName.value),
        orderedRules: entries.value.map((item) => item.raw),
      }),
    })
    const data = (await response.json().catch(() => null)) as {
      message?: string
      changed?: boolean
    } | null

    if (!response.ok) {
      throw new Error(data?.message || `Failed to reorder custom rules: ${response.status}`)
    }

    if (data?.changed) {
      domainRuleConfigChanged.value = true
      cacheKey.value = ''
    }

    showNotification({
      key: 'custom-rule-order-saved',
      content: 'customRuleOrderSaved',
      type: 'alert-success',
    })
  } catch (reorderError) {
    console.error(reorderError)
    entries.value = previousEntries
    showNotification({
      key: 'custom-rule-order-failed',
      content: 'customRuleOrderFailed',
      type: 'alert-error',
    })
  } finally {
    dragSnapshot.value = []
    isReordering.value = false
    releaseRowClick()
  }
}

watch(
  domainGroupItems,
  (items) => {
    if (items.length === 0) {
      selectedGroupName.value = ''
      resetListState()
      return
    }

    if (items.some((item) => item.key === selectedGroupName.value)) {
      return
    }

    selectedGroupName.value = items[0].key
  },
  { immediate: true },
)

watch(selectedGroupName, (groupName, previousGroupName) => {
  if (groupName === previousGroupName) {
    return
  }

  if (isDomainGroupCustomKey(groupName)) {
    resetSortState()
    selectedProvider.value = ''
  }
})

watch(
  providerOptions,
  (items) => {
    if (items.some((item) => item.value === selectedProvider.value)) {
      return
    }

    selectedProvider.value = ''
  },
  { immediate: true },
)

watch(
  familyTabs,
  (items) => {
    const currentTab = items.find((item) => item.value === selectedFamily.value)

    if (currentTab && !currentTab.disabled) {
      return
    }

    selectedFamily.value = items.find((item) => !item.disabled)?.value || 'all'
  },
  { immediate: true },
)

watch(search, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    debouncedSearchRevision.value += 1
  }, SEARCH_DEBOUNCE_MS)
})

watch(editRuleDialogOpen, (open) => {
  if (!open) editRuleParamDropdownOpen.value = false
})

watch(
  [
    selectedGroupName,
    selectedProvider,
    selectedFamily,
    sortKey,
    sortDirection,
    debouncedSearchRevision,
    domainRulesReloadRevision,
  ],
  async ([groupName], [previousGroupName]) => {
    if (!groupName) {
      resetListState()
      return
    }

    if (groupName !== previousGroupName) {
      cacheKey.value = ''
    }

    await loadEntries()
  },
  { immediate: true },
)

onMounted(() => {
  disableProxiesPageScroll.value = true
  void (async () => {
    if (rules.value.length === 0) {
      await fetchRules()
    }

    await nextTick()
    await maybeFillViewport()
  })()
  document.addEventListener('pointerdown', handleOutsidePointerDown)
  window.addEventListener('resize', maybeFillViewport)
})

onBeforeUnmount(() => {
  window.clearTimeout(searchTimer)
  disableProxiesPageScroll.value = false
  document.removeEventListener('pointerdown', handleOutsidePointerDown)
  window.removeEventListener('resize', maybeFillViewport)
})
</script>

<style scoped>
.domain-penetration-table tbody::before {
  content: none !important;
  display: none !important;
}

.domain-penetration-table tbody tr:nth-child(odd),
.domain-penetration-table tbody tr:nth-child(odd) > td {
  background-color: var(--color-base-100) !important;
}

.domain-penetration-table tbody tr:nth-child(even),
.domain-penetration-table tbody tr:nth-child(even) > td {
  background-color: var(--color-base-200) !important;
}

.domain-penetration-table tbody tr:hover > td {
  background-color: var(--color-primary) !important;
}

.domain-penetration-table .domain-rule-editable-row,
.domain-penetration-table .domain-rule-editable-row > td {
  cursor: pointer !important;
}

.custom-rule-delete-button {
  opacity: 0;
  pointer-events: none;
}

.domain-rule-row:hover .custom-rule-delete-button,
.domain-rule-row:focus-within .custom-rule-delete-button {
  opacity: 1;
  pointer-events: auto;
}

@media (hover: none) {
  .custom-rule-delete-button {
    opacity: 1;
    pointer-events: auto;
  }
}

.domain-penetration-table :deep(.domain-rule-drag-ghost) > td {
  opacity: 0.45;
}

.domain-penetration-table :deep(.domain-rule-drag-chosen) > td {
  background-color: color-mix(in srgb, var(--color-primary) 18%, var(--color-base-100)) !important;
}

.domain-penetration-table thead th {
  position: relative;
}

.domain-penetration-table thead {
  border-top-left-radius: var(--app-radius-panel, 1.25rem);
  overflow: hidden;
  clip-path: inset(0 round var(--app-radius-panel, 1.25rem) 0 0 0);
}

.domain-penetration-table thead th::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background-color: color-mix(in srgb, var(--color-base-300) 60%, transparent);
  pointer-events: none;
}

.domain-penetration-table thead tr {
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--color-base-300) 60%, transparent);
}

.domain-penetration-table thead tr:first-child th:first-child {
  border-top-left-radius: var(--app-radius-panel, 1.25rem) !important;
  overflow: hidden;
  background-clip: padding-box;
}

.domain-penetration-table-shell,
.domain-penetration-table,
.domain-penetration-table tbody,
.domain-penetration-table-shell tbody,
.domain-penetration-table tr,
.domain-penetration-table-shell tr,
.domain-penetration-table td,
.domain-penetration-table-shell td,
.domain-penetration-table th,
.domain-penetration-table-shell th {
  -webkit-user-select: text;
  user-select: text;
}
</style>
