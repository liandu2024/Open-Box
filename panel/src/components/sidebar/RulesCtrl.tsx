import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { iconUrlFor } from '@/helper/iconUrl'
import { useTooltip } from '@/helper/tooltip'
import { normalizeRuleTarget, rulesFilter } from '@/store/rules'
import { SparklesIcon } from '@heroicons/vue/24/outline'
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import TextInput from '../common/TextInput.vue'

// 顶栏右侧的四个快捷查询:点一下把站点域名填进搜索框,规则查询和真实路由测试就自动跑起来(和手输一样,
// 由 lookupTarget 驱动)。图标用节点组 / 站点集同一套品牌图标
const QUICK_SITES = [
  { id: 'baidu', name: '百度', host: 'www.baidu.com', icon: 'brand:baidu' },
  { id: 'google', name: 'Google', host: 'www.google.com', icon: 'brand:google' },
  // 灰色透明版和路由链图标保持一致,同时兼顾浅色与深色主题
  { id: 'chatgpt', name: 'ChatGPT', host: 'chatgpt.com', icon: 'brand:openai-light' },
  { id: 'telegram', name: 'Telegram', host: 'web.telegram.org', icon: 'brand:telegram' },
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

      // 和搜索框同一行(手机上也是):搜索框 flex-1 让位,四个按钮不换行
      const quickSites = (
        <div class="ml-auto flex shrink-0 items-center gap-1">
          {QUICK_SITES.map((site) => (
            <button
              key={site.id}
              type="button"
              class="btn btn-circle btn-sm"
              aria-label={site.name}
              onClick={() => (rulesFilter.value = normalizeRuleTarget(site.host))}
              onMouseenter={(e) => showTip(e, t('ruleQuickOpen', { site: site.name }))}
            >
              <img
                src={iconUrlFor(site.icon)}
                alt={site.name}
                class="h-5 w-5"
              />
            </button>
          ))}
        </div>
      )

      const content = (
        <div class="app-card-padding flex w-full min-w-0 items-center gap-2">
          {searchInput}
          {quickSites}
        </div>
      )

      return <div class="ctrls-bar">{content}</div>
    }
  },
})
