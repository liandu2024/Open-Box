import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { iconUrlFor } from '@/helper/iconUrl'
import { useTooltip } from '@/helper/tooltip'
import { normalizeRuleTarget, rulesFilter } from '@/store/rules'
import { SparklesIcon } from '@heroicons/vue/24/outline'
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import TextInput from '../common/TextInput.vue'

// 顶栏右侧的四个快捷测试:点一下在新标签页打开站点,看当前分流下能不能访问。图标用节点组 / 站点集同一套品牌图标
const QUICK_SITES = [
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/', icon: 'brand:baidu' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/', icon: 'brand:google' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', icon: 'brand:openai' },
  { id: 'telegram', name: 'Telegram', url: 'https://web.telegram.org/', icon: 'brand:telegram' },
]

export default defineComponent({
  name: 'RulesCtrl',
  setup() {
    const { t } = useI18n()
    const { isLargeCtrlsBar } = useCtrlsBar()
    const { showTip } = useTooltip()

    return () => {
      const searchInput = (
        <>
          <TextInput
            class={isLargeCtrlsBar.value ? 'w-80' : 'min-w-0 flex-1'}
            v-model={rulesFilter.value}
            placeholder={t('ruleSearchPlaceholder')}
            clearable={true}
          />
          <button
            class="btn btn-circle btn-sm shrink-0"
            onClick={() => (rulesFilter.value = normalizeRuleTarget(rulesFilter.value))}
            onMouseenter={(e) => showTip(e, t('ruleFormatQuery'))}
          >
            <SparklesIcon class="h-4 w-4" />
          </button>
        </>
      )

      // 窄屏上四个按钮换到第二行靠右,不挤搜索框;宽屏跟在搜索框后面靠右
      const quickSites = (
        <div class="ml-auto flex shrink-0 items-center gap-1 max-sm:basis-full max-sm:justify-end">
          {QUICK_SITES.map((site) => (
            <button
              key={site.id}
              type="button"
              class="btn btn-circle btn-sm"
              aria-label={site.name}
              onClick={() => window.open(site.url, '_blank', 'noopener,noreferrer')}
              onMouseenter={(e) => showTip(e, t('ruleQuickOpen', { site: site.name }))}
            >
              <img
                src={iconUrlFor(site.icon)}
                alt={site.name}
                class="h-4 w-4"
              />
            </button>
          ))}
        </div>
      )

      const content = (
        <div class="app-card-padding flex w-full min-w-0 flex-wrap items-center gap-2">
          {searchInput}
          {quickSites}
        </div>
      )

      return <div class="ctrls-bar">{content}</div>
    }
  },
})
