import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { useTooltip } from '@/helper/tooltip'
import { normalizeRuleTarget, rulesFilter } from '@/store/rules'
import { SparklesIcon } from '@heroicons/vue/24/outline'
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import TextInput from '../common/TextInput.vue'

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

      const content = (
        <div class="app-card-padding flex w-full min-w-0 items-center gap-2">{searchInput}</div>
      )

      return <div class="ctrls-bar">{content}</div>
    }
  },
})
