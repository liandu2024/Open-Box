<template>
  <div class="card border-error/40 border-2">
    <div class="app-card-padding flex flex-col gap-3 text-sm">
      <div class="flex items-center gap-2">
        <SignalSlashIcon class="text-error h-5 w-5 shrink-0" />
        <h2 class="text-error text-base font-semibold">{{ $t('kernelEmergencyTitle') }}</h2>
      </div>
      <p class="text-base-content/70 text-xs">{{ $t('kernelEmergencyDescription') }}</p>

      <div
        v-if="resultMessage"
        class="rounded-lg border px-3 py-2 text-xs"
        :class="
          resultMessage.kind === 'success' ? 'border-success/30 bg-success/10 text-success' : 'border-error/30 bg-error/10 text-error'
        "
      >
        {{ resultMessage.text }}
      </div>

      <button
        type="button"
        class="btn btn-error btn-sm w-full sm:w-auto"
        @click="openDialog"
      >
        <SignalSlashIcon class="h-4 w-4" />
        {{ $t('kernelEmergencyButton') }}
      </button>
    </div>

    <DialogWrapper
      v-model="dialogOpen"
      :title="$t('kernelEmergencyDialogTitle')"
      box-class="max-w-md"
    >
      <div class="flex flex-col gap-4 p-2 text-sm">
        <p class="text-base-content/80">{{ $t('kernelEmergencyConsequence') }}</p>
        <ul class="text-base-content/70 list-disc pl-5 text-xs">
          <li>{{ $t('kernelEmergencyConsequenceStop') }}</li>
          <li>{{ $t('kernelEmergencyConsequenceDns') }}</li>
          <li>{{ $t('kernelEmergencyConsequenceFirewall') }}</li>
        </ul>

        <label class="flex cursor-pointer items-start gap-2 text-xs">
          <input
            v-model="understood"
            type="checkbox"
            class="checkbox checkbox-sm mt-0.5"
          />
          <span>{{ $t('kernelEmergencyConfirmCheckbox') }}</span>
        </label>

        <p
          v-if="dialogError"
          class="text-error text-xs"
        >
          {{ dialogError }}
        </p>

        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            :disabled="submitting"
            @click="dialogOpen = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-error btn-sm"
            :disabled="!understood || submitting"
            @click="confirmRollback"
          >
            <span
              v-if="submitting"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('kernelEmergencyConfirmButton') }}
          </button>
        </div>
      </div>
    </DialogWrapper>
  </div>
</template>

<script setup lang="ts">
import { emergencyRollback } from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { SignalSlashIcon } from '@heroicons/vue/24/outline'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{
  refresh: []
}>()

const { t } = useI18n()

const dialogOpen = ref(false)
const understood = ref(false)
const submitting = ref(false)
const dialogError = ref('')

const resultMessage = ref<{ kind: 'success' | 'error'; text: string } | null>(null)

// Confirmation is gated behind an explicit "I understand" checkbox on top of the confirm button
// itself — this is the panic button for a user whose internet just broke, so it has to be both
// unmissable (prominent red card) and impossible to trigger with a single stray click (unlike
// SubscriptionsPage's plain delete-confirm dialog, which is a fine amount of friction for a
// reversible, low-stakes action but not for one that kills proxying network-wide).
const openDialog = () => {
  understood.value = false
  dialogError.value = ''
  dialogOpen.value = true
}

const confirmRollback = async () => {
  if (!understood.value || submitting.value) return

  submitting.value = true
  dialogError.value = ''
  try {
    const result = await emergencyRollback()
    resultMessage.value = {
      kind: 'success',
      text: t('kernelEmergencySuccess', { actions: result.actions.join(', ') || t('kernelEmergencyNoActions') }),
    }
    dialogOpen.value = false
    emit('refresh')
  } catch (error) {
    dialogError.value = t('kernelEmergencyFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    submitting.value = false
  }
}
</script>
