<template>
  <!-- 「域名穿透」:一个站点集会命中哪些域名/IP。样式对齐 AnGe-Board 的同名对话框;
       数据来自站点集自己的规则(规则集由内核解码展开 + 手写条件),而不是 Clash 的规则缓存。 -->
  <DialogWrapper
    v-model="penetrationDialogVisible"
    :mobile-fullscreen="true"
    :box-class="'max-w-256 md:max-w-256'"
    :header-class="'max-md:px-3'"
    :content-class="'max-md:px-3 max-md:py-3 md:h-[90dvh] md:max-h-[90dvh] md:overflow-hidden'"
  >
    <template #title-left>
      <div class="flex min-w-0 items-center gap-1">
        <div
          v-if="dialogGroup?.icon"
          class="flex h-5 w-5 shrink-0 items-center justify-center"
        >
          <ProxyIcon
            :icon="dialogGroup.icon"
            :size="20"
            :scale="dialogGroup.iconScale"
            :margin="0"
          />
        </div>
        <span class="truncate text-base leading-6 font-semibold">
          {{ penetrationDialogGroupName }} | {{ $t('domainPenetration') }}
        </span>
      </div>
    </template>

    <template #title-right>
      <div class="mr-8 ml-auto flex shrink-0 justify-end md:hidden">
        <TextInput
          class="domain-penetration-title-search w-32 max-w-[40vw] md:w-96 md:max-w-none"
          v-model="penetrationDialogSearch"
          :placeholder="$t('domainPenetrationSearchPlaceholder')"
          :clearable="true"
        />
      </div>
    </template>

    <div class="flex h-full min-h-0 min-w-0 flex-col gap-3 md:gap-4">
      <div class="flex items-center gap-4 max-md:block">
        <div class="domain-penetration-mode-shell min-w-0 overflow-x-auto">
          <div
            role="tablist"
            class="domain-penetration-mode bg-base-200/80 inline-flex h-9 min-w-max items-center gap-1 rounded-md p-1 md:h-10"
          >
            <button
              v-for="tab in tabs"
              :key="tab.value"
              type="button"
              role="tab"
              class="domain-penetration-mode-btn shrink-0 rounded-md px-3 py-1 text-sm leading-5 font-medium whitespace-nowrap transition-colors md:px-4 md:py-1.5"
              :class="[
                penetrationDialogTab === tab.value && !tab.disabled
                  ? 'bg-base-100 text-base-content cursor-pointer shadow-sm'
                  : 'text-base-content/60 hover:text-base-content cursor-pointer',
                tab.disabled &&
                  'text-base-content/30 hover:text-base-content/30 pointer-events-none cursor-default opacity-55',
              ]"
              :aria-disabled="tab.disabled"
              @click="!tab.disabled && (penetrationDialogTab = tab.value)"
            >
              {{ tab.displayLabel }}
            </button>
          </div>
        </div>

        <div class="ml-auto hidden w-[30rem] max-w-[46vw] shrink-0 items-center justify-end gap-2 md:flex">
          <TextInput
            class="min-w-0 flex-1"
            v-model="penetrationDialogSearch"
            :placeholder="$t('domainPenetrationSearchPlaceholder')"
            :clearable="true"
          />
          <!-- 和连接页同一套:整条 URL 整理成主机名(不带端口)再搜 -->
          <button
            type="button"
            class="btn btn-sm shrink-0"
            @click="formatSearch"
          >
            {{ $t('ruleFormatQuery') }}
          </button>
        </div>
      </div>

      <div
        class="domain-penetration-table-card border-base-300/60 bg-base-100 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border"
      >
        <div
          v-if="hintText"
          class="border-base-300/60 bg-base-200/40 border-b px-3 py-2 text-sm"
        >
          {{ hintText }}
        </div>

        <div
          ref="tableShellRef"
          class="domain-penetration-table-shell min-h-0 flex-1 overflow-auto overscroll-contain"
          @scroll.passive="handleTableScroll"
        >
          <template v-if="penetrationDialogLoading">
            <div class="flex min-h-56 items-center justify-center px-4 text-sm">
              {{ $t('domainPenetrationLoading') }}
            </div>
          </template>
          <template v-else-if="penetrationDialogError">
            <div class="flex min-h-56 items-center justify-center px-4 text-sm">
              {{ penetrationDialogError }}
            </div>
          </template>
          <template v-else-if="penetrationDialogFallback">
            <div class="flex min-h-56 items-center justify-center px-4 text-sm">
              {{ $t('domainPenetrationFallbackHint') }}
            </div>
          </template>
          <template v-else-if="penetrationDialogEntries.length === 0">
            <div class="flex min-h-56 items-center justify-center px-4 text-sm">
              {{ $t('domainPenetrationEmpty') }}
            </div>
          </template>
          <template v-else>
            <table
              class="domain-penetration-table table-pin-rows table table-sm w-max min-w-full table-auto rounded-none select-text"
            >
              <thead class="bg-base-100 sticky top-0 z-10">
                <tr>
                  <th
                    v-for="column in columns"
                    :key="column.key"
                    class="bg-base-100 whitespace-nowrap select-none"
                    :class="column.width"
                  >
                    <button
                      type="button"
                      class="flex cursor-pointer items-center gap-1 text-left"
                      @click="toggleSort(column.key)"
                    >
                      <span>{{ column.label }}</span>
                      <ArrowUpCircleIcon
                        v-if="penetrationDialogSortKey === column.key && penetrationDialogSortDirection === 'asc'"
                        class="h-4 w-4"
                      />
                      <ArrowDownCircleIcon
                        v-else-if="penetrationDialogSortKey === column.key && penetrationDialogSortDirection === 'desc'"
                        class="h-4 w-4"
                      />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(item, index) in penetrationDialogEntries"
                  :key="`${item.type}-${item.content}-${item.source}-${index}`"
                  class="hover:bg-primary! hover:text-primary-content h-9"
                  :class="[index % 2 === 0 ? 'bg-base-100' : 'bg-base-200', 'select-text']"
                >
                  <td
                    :class="index % 2 === 0 ? 'bg-base-100' : 'bg-base-200'"
                    class="h-9 cursor-text py-0 align-middle text-sm font-medium whitespace-nowrap select-text"
                  >
                    {{ typeLabel(item.type) }}
                  </td>
                  <td
                    :class="index % 2 === 0 ? 'bg-base-100' : 'bg-base-200'"
                    class="h-9 cursor-text py-0 align-middle text-sm whitespace-nowrap select-text"
                  >
                    {{ item.content || '-' }}
                  </td>
                  <td
                    :class="index % 2 === 0 ? 'bg-base-100' : 'bg-base-200'"
                    class="text-base-content/75 h-9 cursor-text py-0 align-middle font-mono text-sm whitespace-nowrap select-text"
                  >
                    {{ item.source === 'custom' ? $t('ruleSourceCustom') : item.source }}
                  </td>
                </tr>
              </tbody>
            </table>

            <div
              v-if="penetrationDialogLoadingMore"
              class="text-base-content/70 bg-base-100/80 sticky bottom-0 flex items-center justify-center py-2 text-sm"
            >
              {{ $t('domainPenetrationLoading') }}
            </div>
          </template>
        </div>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import {
  loadPenetration,
  penetrationDialogCounts,
  penetrationDialogEntries,
  penetrationDialogError,
  penetrationDialogFallback,
  penetrationDialogGroupName,
  penetrationDialogHasMore,
  penetrationDialogLoading,
  penetrationDialogLoadingMore,
  penetrationDialogMissing,
  penetrationDialogSearch,
  penetrationDialogSortDirection,
  penetrationDialogSortKey,
  penetrationDialogTab,
  penetrationDialogVisible,
  type PenetrationSortKey,
  type PenetrationTab,
} from '@/store/proxyGroupRulePenetration'
import { proxyMap } from '@/store/proxies'
import { normalizeRuleTarget } from '@/store/rules'
import { ArrowDownCircleIcon, ArrowUpCircleIcon } from '@heroicons/vue/24/outline'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import DialogWrapper from '../common/DialogWrapper.vue'
import TextInput from '../common/TextInput.vue'
import ProxyIcon from './ProxyIcon.vue'

const { t } = useI18n()
const tableShellRef = ref<HTMLElement | null>(null)
const debouncedSearchRevision = ref(0)
let searchTimer = 0
let fillingViewport = false

const tabs = computed(() =>
  (
    [
      { value: 'all' as PenetrationTab, label: t('all'), count: penetrationDialogCounts.value.all },
      { value: 'domain' as PenetrationTab, label: t('domain'), count: penetrationDialogCounts.value.domain },
      { value: 'ip' as PenetrationTab, label: t('ip'), count: penetrationDialogCounts.value.ip },
    ] as const
  ).map((tab) => ({
    ...tab,
    disabled: tab.count === 0,
    displayLabel: tab.count > 0 ? `${tab.label} (${tab.count})` : tab.label,
  })),
)

const dialogGroup = computed(() => proxyMap.value[penetrationDialogGroupName.value])

const TYPE_LABEL_KEY: Record<string, string> = {
  domain: 'ruleTypeDomain',
  domain_suffix: 'ruleTypeDomainSuffix',
  domain_keyword: 'ruleTypeDomainKeyword',
  domain_regex: 'ruleTypeDomainRegex',
  ip_cidr: 'ruleTypeIpCidr',
}
const typeLabel = (type: string) => t(TYPE_LABEL_KEY[type] || 'ruleTypeOther')

const columns = computed(
  () =>
    [
      { key: 'type', label: t('category'), width: 'w-22 md:w-32' },
      { key: 'content', label: t('content'), width: 'w-56 md:w-auto' },
      { key: 'source', label: t('ruleSource'), width: 'w-40 md:w-56' },
    ] as const,
)

const formatSearch = () => {
  penetrationDialogSearch.value = normalizeRuleTarget(penetrationDialogSearch.value).replace(/:\d+$/, '')
}

const toggleSort = (key: PenetrationSortKey) => {
  if (penetrationDialogSortKey.value !== key) {
    penetrationDialogSortKey.value = key
    penetrationDialogSortDirection.value = 'asc'
    return
  }
  if (penetrationDialogSortDirection.value === 'asc') {
    penetrationDialogSortDirection.value = 'desc'
    return
  }
  penetrationDialogSortKey.value = null
  penetrationDialogSortDirection.value = 'asc'
}

const maybeFillViewport = async () => {
  if (fillingViewport) return
  const shell = tableShellRef.value
  if (
    !shell ||
    !penetrationDialogVisible.value ||
    penetrationDialogLoading.value ||
    penetrationDialogLoadingMore.value ||
    !penetrationDialogHasMore.value
  ) {
    return
  }
  fillingViewport = true
  try {
    while (
      penetrationDialogHasMore.value &&
      !penetrationDialogLoading.value &&
      !penetrationDialogLoadingMore.value &&
      shell.scrollHeight <= shell.clientHeight + 48
    ) {
      await loadPenetration({ append: true })
      await nextTick()
    }
  } finally {
    fillingViewport = false
  }
}

const handleTableScroll = () => {
  const shell = tableShellRef.value
  if (
    !shell ||
    penetrationDialogLoading.value ||
    penetrationDialogLoadingMore.value ||
    !penetrationDialogHasMore.value
  ) {
    return
  }
  if (shell.scrollTop + shell.clientHeight >= shell.scrollHeight - 160) {
    void loadPenetration({ append: true })
  }
}

watch(
  () => penetrationDialogSearch.value,
  () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      debouncedSearchRevision.value += 1
    }, 180)
  },
)

watch(
  tabs,
  (items) => {
    const current = items.find((item) => item.value === penetrationDialogTab.value)
    if (current && !current.disabled) return
    penetrationDialogTab.value = items.find((item) => !item.disabled)?.value || 'all'
  },
  { immediate: true },
)

watch(
  [
    () => penetrationDialogTab.value,
    () => penetrationDialogSortKey.value,
    () => penetrationDialogSortDirection.value,
    debouncedSearchRevision,
  ],
  async () => {
    if (!penetrationDialogVisible.value || !penetrationDialogGroupName.value) return
    await loadPenetration()
    await nextTick()
    await maybeFillViewport()
  },
)

watch(
  () => penetrationDialogEntries.value.length,
  async () => {
    await nextTick()
    await maybeFillViewport()
  },
)

onBeforeUnmount(() => {
  window.clearTimeout(searchTimer)
})

const hintText = computed(() => {
  if (penetrationDialogMissing.value.length === 0) return ''
  return `${t('domainPenetrationMissingRulesets')}: ${penetrationDialogMissing.value.join('、')}`
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

.domain-penetration-table-shell,
.domain-penetration-table,
.domain-penetration-table tbody,
.domain-penetration-table tr,
.domain-penetration-table td,
.domain-penetration-table th {
  -webkit-user-select: text;
  user-select: text;
}

.domain-penetration-title-search :deep(.input) {
  height: 2.25rem;
  min-height: 2.25rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.domain-penetration-mode-shell {
  scrollbar-width: none;
}

.domain-penetration-mode-shell::-webkit-scrollbar {
  display: none;
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

.domain-penetration-table thead tr:first-child th:first-child {
  border-top-left-radius: var(--app-radius-panel, 1.25rem) !important;
  overflow: hidden;
  background-clip: padding-box;
}
</style>
