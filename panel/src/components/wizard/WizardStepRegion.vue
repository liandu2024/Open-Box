<template>
  <div class="flex flex-col gap-4">
    <div class="space-y-1">
      <h2 class="text-lg font-semibold">{{ $t('wizardStepRegionTitle') }}</h2>
      <p class="text-base-content/70 text-sm">{{ $t('wizardStepRegionDescription') }}</p>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm">{{ $t('wizardRegionLabel') }}</label>
      <select
        v-model="selected"
        class="select select-sm w-full"
      >
        <option
          v-for="opt in REGION_OPTIONS"
          :key="opt.code"
          :value="opt.code"
        >
          {{ $t(opt.labelKey) }}
        </option>
      </select>
    </div>

    <button
      class="btn btn-primary btn-sm w-full"
      @click="$emit('next', selected)"
    >
      {{ $t('wizardContinue') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { guessRegionFromLocale, REGION_OPTIONS } from './regions'

const props = defineProps<{
  initialRegion?: string
}>()

defineEmits<{
  next: [region: string]
}>()

const { locale } = useI18n()

const selected = ref(props.initialRegion || guessRegionFromLocale(locale.value))
</script>
