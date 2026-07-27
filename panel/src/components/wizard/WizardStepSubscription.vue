<template>
  <div class="flex flex-col gap-4">
    <div class="space-y-1">
      <h2 class="text-lg font-semibold">{{ $t('wizardStepSubscriptionTitle') }}</h2>
      <p class="text-base-content/70 text-sm">{{ $t('wizardStepSubscriptionDescription') }}</p>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm">{{ $t('wizardSubscriptionNameLabel') }}</label>
      <input
        v-model="name"
        type="text"
        class="input input-sm w-full"
        :placeholder="$t('wizardSubscriptionNamePlaceholder')"
      />
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm">{{ $t('wizardSubscriptionUrlLabel') }}</label>
      <input
        v-model="url"
        type="text"
        class="input input-sm w-full"
        placeholder="https://"
        autocomplete="off"
      />
    </div>

    <p
      v-if="previewSummary"
      class="text-success text-sm"
    >
      {{ previewSummary }}
    </p>
    <p
      v-if="errorMessage"
      class="text-error text-sm"
    >
      {{ errorMessage }}
    </p>

    <div class="flex items-center gap-2">
      <button
        class="btn btn-outline btn-sm"
        :disabled="!url.trim() || previewing || importing"
        @click="handlePreview"
      >
        {{ previewing ? $t('wizardLoading') : $t('wizardPreview') }}
      </button>
      <button
        class="btn btn-primary btn-sm flex-1"
        :disabled="!url.trim() || importing"
        @click="handleImport"
      >
        {{ importing ? $t('wizardLoading') : $t('wizardImport') }}
      </button>
    </div>

    <button
      type="button"
      class="text-base-content/60 hover:text-base-content self-center text-xs underline-offset-2 hover:underline"
      :disabled="importing"
      @click="$emit('next')"
    >
      {{ $t('wizardSubscriptionSkipLink') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { createSubscription, previewSubscription } from '@/api/openbox'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{
  next: []
}>()

const { t } = useI18n()

const name = ref('')
const url = ref('')
const previewing = ref(false)
const importing = ref(false)
const previewSummary = ref('')
const errorMessage = ref('')

const handlePreview = async () => {
  if (previewing.value || !url.value.trim()) return

  previewing.value = true
  errorMessage.value = ''
  previewSummary.value = ''

  try {
    const result = await previewSubscription({ url: url.value.trim() })
    previewSummary.value =
      result.skipped.length > 0
        ? `${t('wizardSubscriptionPreviewSummary', { count: result.nodes.length })} · ${t('wizardSubscriptionSkippedSummary', { count: result.skipped.length })}`
        : t('wizardSubscriptionPreviewSummary', { count: result.nodes.length })
  } catch (error) {
    errorMessage.value = t('wizardSubscriptionImportFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    previewing.value = false
  }
}

const handleImport = async () => {
  if (importing.value || !url.value.trim()) return

  importing.value = true
  errorMessage.value = ''

  try {
    await createSubscription({
      url: url.value.trim(),
      name: name.value.trim() || t('wizardSubscriptionDefaultName'),
    })
    emit('next')
  } catch (error) {
    errorMessage.value = t('wizardSubscriptionImportFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    importing.value = false
  }
}
</script>
