import { useCtrlsBar } from '@/composables/useCtrlsBar'
import { rulesFilter } from '@/store/rules'
import {
  disconnectOnRuleDisable,
  displayLatencyInRule,
  displayNowNodeInRule,
} from '@/store/settings'
import { WrenchScrewdriverIcon } from '@heroicons/vue/24/outline'
import { defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DialogWrapper from '../common/DialogWrapper.vue'
import TextInput from '../common/TextInput.vue'

export default defineComponent({
  name: 'RulesCtrl',
  setup() {
    const { t } = useI18n()
    const settingsModel = ref(false)
    const { isLargeCtrlsBar } = useCtrlsBar()

    return () => {
      const searchInput = (
        <TextInput
          class={isLargeCtrlsBar.value ? 'w-80' : 'min-w-0 flex-1'}
          v-model={rulesFilter.value}
          placeholder={t('ruleSearchPlaceholder')}
          clearable={true}
        />
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
            title={t('ruleSettings')}
          >
            <div class="flex flex-col gap-4 p-2 text-sm">
              <div class="flex items-center gap-2">
                {t('displaySelectedNode')}
                <input
                  class="toggle"
                  type="checkbox"
                  v-model={displayNowNodeInRule.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('displayLatencyNumber')}
                <input
                  class="toggle"
                  type="checkbox"
                  v-model={displayLatencyInRule.value}
                />
              </div>
              <div class="flex items-center gap-2">
                {t('disconnectOnRuleDisable')}
                <input
                  class="toggle"
                  type="checkbox"
                  v-model={disconnectOnRuleDisable.value}
                />
              </div>
            </div>
          </DialogWrapper>
        </>
      )

      const content = (
        <div class="app-card-padding flex w-full min-w-0 items-center gap-2">
          {searchInput}
          <div class="ml-auto flex shrink-0 items-center gap-2">{settingsModal}</div>
        </div>
      )

      return <div class="ctrls-bar">{content}</div>
    }
  },
})
