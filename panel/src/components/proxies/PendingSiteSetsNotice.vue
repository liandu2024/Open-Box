<template>
  <!-- 站点集在「分流与策略」里保存后,内核还在用旧配置跑,新的 selector 要等重启才有。
       这里把还没出现在内核里的站点集点出来,并给一个一键重启——不然人会以为没保存上。 -->
  <div
    v-if="pending.length"
    class="alert alert-info mx-2 mt-2 flex flex-wrap items-center gap-2 py-2 text-sm"
  >
    <InformationCircleIcon class="h-5 w-5 shrink-0" />
    <span class="min-w-0 flex-1">{{ $t('proxiesPendingSiteSets', { names: pending.join('、') }) }}</span>
    <button
      type="button"
      class="btn btn-sm btn-neutral"
      :disabled="applying"
      @click="apply"
    >
      <span
        v-if="applying"
        class="loading loading-spinner loading-xs"
      ></span>
      {{ $t('proxiesPendingApply') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { runServiceAction } from '@/api/openbox'
import { showNotification } from '@/helper/notification'
import { loadOpenboxSiteSets, siteSetOrder } from '@/store/openboxSiteSets'
import { fetchProxies, proxyMap } from '@/store/proxies'
import { InformationCircleIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// 档案里有、内核里没有的站点集。兜底「其他」只要内核在跑就一定在,不用单独排除。
const pending = computed(() => siteSetOrder.value.filter((name) => !proxyMap.value[name]))

const applying = ref(false)
const apply = async () => {
  if (applying.value) return
  applying.value = true
  try {
    const result = await runServiceAction('restart')
    if (!result.ok) {
      showNotification({
        content: t('proxiesPendingApplyFailed', {
          detail: result.stderr || t('kernelActionNoDetail', { code: result.code }),
        }),
        type: 'alert-error',
      })
      return
    }
    await Promise.all([loadOpenboxSiteSets(), fetchProxies()])
    showNotification({ content: 'proxiesPendingApplied', type: 'alert-success' })
  } catch (error) {
    showNotification({
      content: t('kernelActionRequestFailed', {
        message: error instanceof Error ? error.message : String(error),
      }),
      type: 'alert-error',
    })
  } finally {
    applying.value = false
  }
}
</script>
