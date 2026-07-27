<template>
  <select
    class="select select-sm w-48"
    v-model="mode"
  >
    <option
      v-for="opt in options"
      :key="opt.value"
      :value="opt.value"
    >
      {{ $t(opt.labelKey) }}
    </option>
  </select>
</template>

<script setup lang="ts">
import { THEME_MODE } from '@/constant'
import { themeMode } from '@/store/settings'

const mode = themeMode

const options = [
  { value: THEME_MODE.AUTO, labelKey: 'themeModeAuto' },
  { value: THEME_MODE.LIGHT, labelKey: 'themeModeLight' },
  { value: THEME_MODE.DARK, labelKey: 'themeModeDark' },
] as const
</script>
