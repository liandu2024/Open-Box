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
import { showNotification } from '@/helper/notification'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import {
  ACCESS_PASSWORD_INVALID_CODE,
  changePassword,
  PASSWORD_TOO_SHORT_CODE,
} from '@/store/auth'
import { ref, watch } from 'vue'

const isOpen = defineModel<boolean>({ required: true })

const MIN_PASSWORD_LENGTH = 4


const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)

const resetForm = () => {
  currentPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
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


  if (newPassword.value.length < MIN_PASSWORD_LENGTH) {
    showNotification({ content: 'passwordMinLengthHint', type: 'alert-error' })
    return
  }

  if (newPassword.value !== confirmPassword.value) {
    showNotification({ content: 'passwordsDoNotMatch', type: 'alert-error' })
    return
  }

  loading.value = true

  try {
    const result = await changePassword(currentPassword.value, newPassword.value)

    if (!result.ok) {
      if (result.code === ACCESS_PASSWORD_INVALID_CODE) {
        showNotification({ content: 'currentPasswordIncorrect', type: 'alert-error' })
      } else if (result.code === PASSWORD_TOO_SHORT_CODE) {
        showNotification({ content: 'passwordMinLengthHint', type: 'alert-error' })
      } else {
        showNotification({ content: 'changePasswordFailed', type: 'alert-error' })
      }
      return
    }

    // 改完就关:提示已经在右上角弹了,留着空表单只会让人以为没成功
    showNotification({ content: 'passwordChanged', type: 'alert-success' })
    resetForm()
    isOpen.value = false
  } catch {
    showNotification({ content: 'changePasswordFailed', type: 'alert-error' })
  } finally {
    loading.value = false
  }
}
</script>
