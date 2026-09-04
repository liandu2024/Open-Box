import { disconnectAllAPI, disconnectByIdAPI } from '@/api'
import { normalizeRuleTarget } from '@/store/rules'
import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { SORT_DIRECTION, SORT_TYPE } from '@/constant'
import { useTooltip } from '@/helper/tooltip'
import {
  connectionFilter,
  connections,
  connectionSortDirection,
  connectionSortType,
  isPaused,
  quickFilterEnabled,
  renderConnections,
} from '@/store/connections'
import { useConnectionCard } from '@/store/settings'
import {
  ArrowDownCircleIcon,
  ArrowUpCircleIcon,
  LinkIcon,
  LinkSlashIcon,
  PauseIcon,
  PlayIcon,
  WrenchScrewdriverIcon,
  XMarkIcon, SparklesIcon } from '@heroicons/vue/24/outline'
import { defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DialogWrapper from '../common/DialogWrapper.vue'
import TextInput from '../common/TextInput.vue'
import ConnectionCardSettings from '../settings/ConnectionCardSettings.vue'
import TableSettings from '../settings/TableSettings.vue'
import ConnectionTabs from './ConnectionTabs.vue'
import SourceIPFilter from './SourceIPFilter.vue'

const handlerClickCloseAll = () => {
  if (renderConnections.value.length === connections.value.length) {
    disconnectAllAPI()
  } else {
    renderConnections.value.forEach((conn) => {
      disconnectByIdAPI(conn.id)
    })
  }
}

export default defineComponent({
  name: 'ConnectionCtrl',
  components: {
    TextInput,
    ConnectionTabs,
    SourceIPFilter,
  },
  setup() {
    const { t } = useI18n()
    const settingsModel = ref(false)
    const { showTip, updateTip } = useTooltip()
    const { isLargeCtrlsBar } = useCtrlsBar(useConnectionCard.value ? 860 : 720)

    return () => {
      const sortForCards = (
        <div
          class={`flex items-center gap-1 text-sm ${isLargeCtrlsBar.value ? 'w-auto' : 'w-full'}`}
        >
          <span class="shrink-0">{t('sortBy')}</span>
          <div class={`join flex-1 ${isLargeCtrlsBar.value ? 'min-w-46' : ''}`}>
            <select
              class="join-item select select-sm flex-1"
              v-model={connectionSortType.value}
            >
              {(Object.values(SORT_TYPE) as string[]).map((opt) => (
                <option
                  key={opt}
                  value={opt}
                >
                  {t(opt) || opt}
                </option>
              ))}
            </select>
            <button
              class="btn join-item btn-sm"
              onClick={() => {
                connectionSortDirection.value =
                  connectionSortDirection.value === SORT_DIRECTION.ASC
                    ? SORT_DIRECTION.DESC
                    : SORT_DIRECTION.ASC
              }}
            >
              {connectionSortDirection.value === SORT_DIRECTION.ASC ? (
                <ArrowUpCircleIcon class="h-4 w-4" />
              ) : (
                <ArrowDownCircleIcon class="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      )

      const settingsModal = (
        <>
          <button
            class="btn btn-circle btn-sm"
            onClick={() => (settingsModel.value = true)}
          >
            <WrenchScrewdriverIcon class="h-4 w-4" />
          </button>
          <DialogWrapper
            v-model={settingsModel.value}
            title={t('connectionSettings')}
          >
            {/* 这个弹窗只管表格列。「隐藏连接」的开关在工具栏上(链条图标)就有,匹配用的
                正则固定用默认那条;「完整显示代理链」恒开。跳去设置页的入口也去掉了——
                这里能改的东西本来就都在眼前。 */}
            <div class="flex flex-col gap-4 p-2 text-sm">
              {useConnectionCard.value ? <ConnectionCardSettings /> : <TableSettings />}
            </div>
          </DialogWrapper>
        </>
      )

      const searchInput = (
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <TextInput
            v-model={connectionFilter.value}
            placeholder={`${t('search')} | ${t('searchMultiple')}`}
            clearable={true}
            before-close={true}
            class={isLargeCtrlsBar.value ? 'w-32 max-w-80 flex-1' : 'w-full'}
          />
          <button
            class="btn btn-circle btn-sm shrink-0"
            // 连接表按主机名匹配,端口不要:board.ok1248.cn:4433 → board.ok1248.cn
            onClick={() => (connectionFilter.value = normalizeRuleTarget(connectionFilter.value).replace(/:\d+$/, ''))}
            onMouseenter={(e) => showTip(e, t('ruleFormatQuery'))}
          >
            <SparklesIcon class="h-4 w-4" />
          </button>
        </div>
      )

      const buttons = (
        <>
          <button
            class="btn btn-circle btn-sm"
            onClick={() => {
              quickFilterEnabled.value = !quickFilterEnabled.value
              updateTip(quickFilterEnabled.value ? t('showConnection') : t('hideConnection'))
            }}
            onMouseenter={(e) =>
              showTip(e, quickFilterEnabled.value ? t('showConnection') : t('hideConnection'), {
                appendTo: 'parent',
              })
            }
          >
            {quickFilterEnabled.value ? (
              <LinkSlashIcon class="h-4 w-4" />
            ) : (
              <LinkIcon class="h-4 w-4" />
            )}
          </button>
          <button
            class="btn btn-circle btn-sm"
            onClick={() => {
              isPaused.value = !isPaused.value
            }}
          >
            {isPaused.value ? <PlayIcon class="h-4 w-4" /> : <PauseIcon class="h-4 w-4" />}
          </button>
          <button
            class="btn btn-circle btn-sm"
            onClick={handlerClickCloseAll}
          >
            <XMarkIcon class="h-4 w-4" />
          </button>
        </>
      )

      const content = !isLargeCtrlsBar.value ? (
        <div class="app-card-padding flex flex-wrap items-center gap-2">
          <div class="flex w-full min-w-0 items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <ConnectionTabs />
            </div>
            {!useConnectionCard.value && (
              <div class="flex shrink-0 items-center gap-1">
                {settingsModal}
                {buttons}
              </div>
            )}
          </div>
          {useConnectionCard.value && (
            <div class="flex w-full items-center gap-2">
              {sortForCards}
              {settingsModal}
              {buttons}
            </div>
          )}
          <div class="join w-full">
            <SourceIPFilter class="w-40" />
            {searchInput}
          </div>
        </div>
      ) : (
        <div class="app-card-padding flex items-center gap-2">
          <ConnectionTabs />
          {useConnectionCard.value && sortForCards}
          <SourceIPFilter class="w-40" />
          <div class="flex flex-1">{searchInput}</div>
          {settingsModal}
          {buttons}
        </div>
      )

      return <div class="ctrls-bar">{content}</div>
    }
  },
})
