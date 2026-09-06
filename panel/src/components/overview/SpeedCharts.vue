<template>
  <BasicCharts
    ref="chartRef"
    :pausable="pausable"
    :data="chartsData"
    :label-formatter="labelFormatter"
    :tool-tip-formatter="tooltipFormatter"
    :min="60 * 1000"
  />
</template>

<script setup lang="ts">
import { getToolTipForParams } from '@/helper'
import { prettyBytesHelper } from '@/helper/utils'
import { downloadSpeedHistory, uploadSpeedHistory } from '@/store/overview'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BasicCharts from './BasicCharts.vue'

// 侧边栏那张小图不放暂停键;概览里的照旧
withDefaults(defineProps<{ pausable?: boolean }>(), { pausable: true })
const chartRef = ref()
const { t } = useI18n()
const chartsData = computed(() => {
  return [
    {
      name: t('ulSpeed'),
      data: uploadSpeedHistory.value,
    },
    {
      name: t('dlSpeed'),
      data: downloadSpeedHistory.value,
    },
  ]
})

const labelFormatter = (value: number) => {
  return `${prettyBytesHelper(value, {
    maximumFractionDigits: 0,
    binary: false,
  })}/s`
}
const tooltipFormatter = (value: ToolTipParams[]) => {
  return value
    .map((item) => {
      return getToolTipForParams(item, {
        binary: false,
        suffix: '/s',
      })
    })
    .join('')
}
</script>
