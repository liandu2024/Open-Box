<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4">
      <div>
        <h2 class="text-base font-semibold">{{ $t('routingOutboundsTitle') }}</h2>
        <p class="text-base-content/60 text-xs">{{ $t('routingOutboundsDescription') }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-4">
        <label
          v-for="opt in OPTIONS"
          :key="opt.key"
          class="flex cursor-pointer items-center gap-2 text-sm"
        >
          <input
            type="checkbox"
            class="checkbox checkbox-sm"
            :checked="enabled(opt.key)"
            :disabled="saving"
            @change="toggle(opt.key, ($event.target as HTMLInputElement).checked)"
          />
          {{ $t(opt.labelKey) }}
        </label>
      </div>

      <!-- 把"站点集里到底会看到哪几项"直接摆出来:三个开关是抽象的,这一行才是结果。
           节点组取自「节点组」页(权威来源),不从配置预览里猜。 -->
      <div class="border-base-300/60 rounded-lg border p-3">
        <p class="text-base-content/60 mb-2 text-xs">{{ $t('routingOutboundsPreview') }}</p>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="item in preview"
            :key="item"
            class="badge badge-outline badge-sm"
          >{{ item }}</span>
          <span
            v-if="!preview.length"
            class="text-base-content/50 text-xs"
          >{{ $t('routingOutboundsEmpty') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxOutboundOptions, OpenboxProfile } from '@/api/openbox'
import { showNotification } from '@/helper/notification'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  profile: OpenboxProfile
  // 「节点组」页里建的组名,站点集的选择器里会原样列出来
  groupNames: string[]
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const { t } = useI18n()

type OptionKey = keyof OpenboxOutboundOptions
const OPTIONS: { key: OptionKey; labelKey: string }[] = [
  { key: 'direct', labelKey: 'direct' },
  { key: 'groups', labelKey: 'groupsTab' },
  { key: 'reject', labelKey: 'routingOutboundReject' },
]

const saving = ref(false)
// 服务端把这三个当成"没写就是开",界面要保持一致,否则老档案打开就显示成全关
const enabled = (key: OptionKey) => props.profile.routing.outboundOptions?.[key] !== false

const preview = computed(() => {
  const list: string[] = []
  if (enabled('direct')) list.push(t('direct'))
  if (enabled('groups')) list.push(...props.groupNames)
  if (enabled('reject')) list.push(t('routingOutboundReject'))
  return list
})

const toggle = async (key: OptionKey, value: boolean) => {
  if (saving.value) return
  saving.value = true
  try {
    await props.patchProfile({ routing: { outboundOptions: { [key]: value } } })
  } catch (error) {
    showNotification({
      content: 'routingSaveFailed',
      type: 'alert-error',
      params: { message: error instanceof Error ? error.message : String(error) },
    })
  } finally {
    saving.value = false
  }
}
</script>
