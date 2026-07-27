<template>
  <div class="flex flex-col gap-4">
    <div class="space-y-1">
      <h2 class="text-lg font-semibold">{{ $t('wizardStepLanguageTitle') }}</h2>
      <p class="text-base-content/70 text-sm">{{ $t('wizardStepLanguageDescription') }}</p>
    </div>

    <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        class="btn btn-outline btn-sm justify-start"
        :class="language === opt.value && 'btn-primary'"
        @click="language = opt.value"
      >
        {{ opt.label }}
      </button>
    </div>

    <button
      class="btn btn-primary btn-sm w-full"
      @click="handleContinue"
    >
      {{ $t('wizardContinue') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { LANG } from '@/constant'
import { language } from '@/store/settings'
import { wizardLanguageConfirmed } from '@/store/wizard'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{
  next: []
}>()

const { locale } = useI18n()

const options = [
  { value: LANG.EN_US, label: 'English' },
  { value: LANG.ZH_CN, label: '简体中文' },
  { value: LANG.ZH_TW, label: '繁體中文' },
] as const

const handleContinue = () => {
  locale.value = language.value
  wizardLanguageConfirmed.value = true
  emit('next')
}
</script>
