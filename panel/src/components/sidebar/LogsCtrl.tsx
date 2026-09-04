import { isSingBox } from '@/api'
import { normalizeRuleTarget } from '@/store/rules'
import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { LOG_LEVEL } from '@/constant'
import { useTooltip } from '@/helper/tooltip'
import { initLogs, isPaused, logFilter, logLevel, logTypeFilter, logs } from '@/store/logs'
import { logSearchHistory } from '@/store/settings'
import {
  ArrowDownTrayIcon,
  PauseIcon,
  PlayIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import dayjs from 'dayjs'
import { debounce } from 'lodash'
import { computed, defineComponent, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import TextInput from '../common/TextInput.vue'

export default defineComponent({
  setup() {
    const { t } = useI18n()
    const { isLargeCtrlsBar } = useCtrlsBar()
    const { showTip } = useTooltip()
    const insertLogSearchHistory = debounce((log: string) => {
      if (!log) {
        return
      }

      const idx = logSearchHistory.value.indexOf(log)

      if (idx !== -1) {
        logSearchHistory.value.splice(idx, 1)
      }

      logSearchHistory.value.unshift(log)
      if (logSearchHistory.value.length > 5) {
        logSearchHistory.value.pop()
      }
    }, 1500)

    watch(logFilter, insertLogSearchHistory)

    const logLevels = computed(() => {
      if (isSingBox.value) {
        return Object.values(LOG_LEVEL)
      }
      return [LOG_LEVEL.Debug, LOG_LEVEL.Info, LOG_LEVEL.Warning, LOG_LEVEL.Error, LOG_LEVEL.Silent]
    })

    const logFilterOptions = computed(() => {
      const types: string[] = []
      const levels: string[] = []

      if (isSingBox.value) {
        for (const log of logs.value) {
          const startIndex = log.payload.startsWith('[') ? log.payload.indexOf(']') + 2 : 0
          const endIndex = log.payload.indexOf(':', startIndex)
          const type = log.payload.slice(startIndex, endIndex + 1)

          if (!types.includes(type)) {
            types.push(type)
          }

          if (!levels.includes(log.type)) {
            levels.push(log.type)
          }
        }
      } else {
        for (const log of logs.value) {
          const index = log.payload.indexOf(' ')
          const type = index === -1 ? log.payload : log.payload.slice(0, index)

          if (!types.includes(type)) {
            types.push(type)
          }

          if (!levels.includes(log.type)) {
            levels.push(log.type)
          }
        }
      }

      return {
        levels: levels.sort((a, b) => {
          const aIdx = logLevels.value.indexOf(a as LOG_LEVEL)
          const bIdx = logLevels.value.indexOf(b as LOG_LEVEL)
          return aIdx - bIdx
        }),
        types: types.sort(),
      }
    })

    const downloadAllLogs = () => {
      const blob = new Blob(
        [
          logs.value
            .map((log) =>
              [
                log.seq.toString().padEnd(5, ' '),
                log.time,
                log.type.padEnd(7, ' '),
                log.payload,
              ].join('\t'),
            )
            .join('\n'),
        ],
        {
          type: 'text/plain',
        },
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = dayjs().format('YYYY-MM-DD HH-mm-ss') + '.log'
      a.click()
      URL.revokeObjectURL(url)
    }

    return () => {
      const levelSelect = (
        <select
          class={['join-item select select-sm w-24 shrink-0']}
          v-model={logLevel.value}
          onChange={initLogs}
        >
          {logLevels.value.map((opt) => (
            <option
              key={opt}
              value={opt}
            >
              {opt}
            </option>
          ))}
        </select>
      )
      const searchInput = (
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <TextInput
            v-model={logFilter.value}
            beforeClose={true}
            class={isLargeCtrlsBar.value ? 'min-w-64 flex-1' : 'min-w-0 flex-1'}
            placeholder={`${t('search')} | Regex`}
            clearable={true}
            menus={logSearchHistory.value}
            menusDeleteable={true}
            onUpdate:menus={(val) => (logSearchHistory.value = val)}
          />
          <button
            class="btn btn-circle btn-sm shrink-0"
            // 和连接页一样:整条 URL 整理成主机名(不带端口)再搜
            onClick={() => (logFilter.value = normalizeRuleTarget(logFilter.value).replace(/:\d+$/, ''))}
            onMouseenter={(e) => showTip(e, t('ruleFormatQuery'))}
          >
            <SparklesIcon class="h-4 w-4" />
          </button>
        </div>
      )

      const logTypeSelect = (
        <select
          class={['select select-sm shrink-0', isLargeCtrlsBar.value ? 'w-28' : 'w-20 max-w-28']}
          v-model={logTypeFilter.value}
        >
          <option value="">{t('all')}</option>
          <optgroup label={t('logLevel')}>
            {logFilterOptions.value.levels.map((opt) => (
              <option
                key={opt}
                value={opt}
              >
                {opt}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('logType')}>
            {logFilterOptions.value.types.map((opt) => (
              <option
                key={opt}
                value={opt}
              >
                {opt}
              </option>
            ))}
          </optgroup>
        </select>
      )

      const buttons = (
        <div class="flex items-center gap-2">
          <button
            class="btn btn-circle btn-sm"
            onClick={downloadAllLogs}
          >
            <ArrowDownTrayIcon class="h-4 w-4" />
          </button>
          <button
            class="btn btn-circle btn-sm"
            onClick={() => (isPaused.value = !isPaused.value)}
          >
            {isPaused.value ? <PlayIcon class="h-4 w-4" /> : <PauseIcon class="h-4 w-4" />}
          </button>
          <button
            class="btn btn-circle btn-sm"
            onClick={() => (logs.value = [])}
          >
            <XMarkIcon class="h-4 w-4" />
          </button>
        </div>
      )

      const content = !isLargeCtrlsBar.value ? (
        <div class="app-card-padding flex flex-col gap-2">
          <div class="flex w-full justify-between gap-2">
            <div class="join flex-1">{levelSelect}</div>
            {buttons}
          </div>
          <div class="flex w-full items-center gap-2">
            {logTypeSelect}
            {searchInput}
          </div>
        </div>
      ) : (
        <div class="app-card-padding flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            {levelSelect}
            <div class="flex w-96 items-center gap-2">
              {logTypeSelect}
              {searchInput}
            </div>
          </div>
          {buttons}
        </div>
      )

      return <div class="ctrls-bar">{content}</div>
    }
  },
})
