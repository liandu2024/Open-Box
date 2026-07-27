<template>
  <DialogWrapper
    v-model="isOpen"
    :title="$t('changePassword')"
  >
    <div
      class="flex flex-col gap-3 text-sm"
      @keydown.enter="handleSubmit"
    >
      <p class="text-base-content/70">
        {{ $t('changePasswordDescription') }}
      </p>

      <div class="flex flex-col gap-1">
        <label class="text-sm">{{ $t('currentPassword') }}</label>
        <input
          v-model="currentPassword"
          type="password"
          class="input input-sm w-full"
          autocomplete="current-password"
          autofocus
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-sm">{{ $t('newPassword') }}</label>
        <input
          v-model="newPassword"
          type="password"
          class="input input-sm w-full"
          autocomplete="new-password"
        />
        <p class="text-base-content/60 text-xs">{{ $t('passwordMinLengthHint') }}</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-sm">{{ $t('confirmNewPassword') }}</label>
        <input
          v-model="confirmPassword"
          type="password"
          class="input input-sm w-full"
          autocomplete="new-password"
        />
      </div>

      <p
        v-if="errorMessage"
        class="text-error text-xs"
      >
        {{ errorMessage }}
      </p>
      <p
        v-if="successMessage"
        class="text-success text-xs"
      >
        {{ successMessage }}
      </p>

      <button
        class="btn btn-primary btn-sm w-full"
        :disabled="loading"
        @click="handleSubmit"
      >
        {{ $t('changePassword') }}
      </button>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import {
  ACCESS_PASSWORD_INVALID_CODE,
  changePassword,
  PASSWORD_TOO_SHORT_CODE,
} from '@/store/auth'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const isOpen = defineModel<boolean>({ required: true })

const MIN_PASSWORD_LENGTH = 8

const { t } = useI18n()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const resetForm = () => {
  currentPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  errorMessage.value = ''
  successMessage.value = ''
}

// Fresh form every time the dialog opens, so a previous run's error/success
// message or half-typed passwords never linger into the next attempt.
watch(isOpen, (open) => {
  if (open) {
    resetForm()
  }
})

const handleSubmit = async () => {
  if (loading.value) return

  errorMessage.value = ''
  successMessage.value = ''

  if (newPassword.value.length < MIN_PASSWORD_LENGTH) {
    errorMessage.value = t('passwordMinLengthHint')
    return
  }

  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = t('passwordsDoNotMatch')
    return
  }

  loading.value = true

  try {
    const result = await changePassword(currentPassword.value, newPassword.value)

    if (!result.ok) {
      if (result.code === ACCESS_PASSWORD_INVALID_CODE) {
        errorMessage.value = t('currentPasswordIncorrect')
      } else if (result.code === PASSWORD_TOO_SHORT_CODE) {
        errorMessage.value = t('passwordMinLengthHint')
      } else {
        errorMessage.value = t('changePasswordFailed')
      }
      return
    }

    successMessage.value = t('passwordChanged')
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch {
    errorMessage.value = t('changePasswordFailed')
  } finally {
    loading.value = false
  }
}
</script>
