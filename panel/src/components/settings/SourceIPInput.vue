<template>
  <div class="relative flex w-full items-center gap-2">
    <slot name="prefix"></slot>
    <TextInput
      class="w-12 max-w-64 flex-1 sm:w-36"
      :menus="sourceList"
      v-model="sourceIPLabel.key"
      placeholder="IP/CIDR | eui64 | /Regex"
    />
    <ArrowRightCircleIcon class="h-4 w-4 shrink-0" />
    <TextInput
      class="w-24 sm:w-40"
      v-model="sourceIPLabel.label"
      :placeholder="$t('label')"
    />
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
import { connections } from '@/store/connections'
import { sourceIPLabelList } from '@/store/settings'
import type { SourceIPLabel } from '@/types'
import { ArrowRightCircleIcon } from '@heroicons/vue/24/outline'
import { uniq } from 'lodash'
import { computed } from 'vue'
import TextInput from '../common/TextInput.vue'

const sourceIPLabel = defineModel<Partial<SourceIPLabel>>({
  default: {
    key: '',
    label: '',
  },
})
const sourceList = computed(() => {
  return uniq(connections.value.map((conn) => conn.metadata.sourceIP))
    .filter(Boolean)
    .filter((ip) => !sourceIPLabelList.value.find((item) => item.key === ip))
    .sort()
})
</script>
