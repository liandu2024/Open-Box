<template>
  <div
    class="flex flex-col gap-4"
    @keydown.enter="handleSubmit"
  >
    <div class="space-y-2">
      <h1 class="text-2xl font-semibold">{{ $t('setupPasswordTitle') }}</h1>
      <p class="text-base-content/70 text-sm">
        {{ $t('setupPasswordDescription') }}
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm">{{ $t('newPassword') }}</label>
      <label class="input input-sm flex w-full items-center gap-2">
        <input
          v-model="newPassword"
          :type="showPassword ? 'text' : 'password'"
          class="grow"
          autocomplete="new-password"
          autofocus
        />
        <button
          type="button"
          class="text-base-content/60 hover:text-base-content flex items-center"
          @click="showPassword = !showPassword"
        >
          <EyeIcon
            v-if="showPassword"
            class="h-4 w-4"
          />
          <EyeSlashIcon
            v-else
            class="h-4 w-4"
          />
        </button>
      </label>
      <p class="text-base-content/60 text-xs">{{ $t('passwordMinLengthHint') }}</p>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm">{{ $t('confirmNewPassword') }}</label>
      <input
        v-model="confirmPassword"
        :type="showPassword ? 'text' : 'password'"
        class="input input-sm w-full"
        autocomplete="new-password"
      />
    </div>

    <p
      v-if="errorMessage"
      class="text-error text-sm"
    >
      {{ errorMessage }}
    </p>

    <button
      class="btn btn-primary btn-sm w-full"
      :disabled="loading"
      @click="handleSubmit"
    >
      {{ $t('setupPasswordButton') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { PASSWORD_ALREADY_SET_CODE, PASSWORD_TOO_SHORT_CODE, setupPassword } from '@/store/auth'
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

// The standalone /setup route's form (SetupPasswordPage.vue, forced by the router guard
// while no password exists). This component only knows how to collect+submit a new
// password and emit `success` — the caller decides where to go next.
const emit = defineEmits<{
  success: []
}>()

const MIN_PASSWORD_LENGTH = 8

const { t } = useI18n()

const newPassword = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const loading = ref(false)
const errorMessage = ref('')

const handleSubmit = async () => {
  if (loading.value) return

  if (newPassword.value.length < MIN_PASSWORD_LENGTH) {
    errorMessage.value = t('passwordMinLengthHint')
    return
  }

  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = t('passwordsDoNotMatch')
    return
  }

  loading.value = true
  errorMessage.value = ''

  try {
    const result = await setupPassword(newPassword.value)

    if (!result.ok) {
      if (result.code === PASSWORD_TOO_SHORT_CODE) {
        errorMessage.value = t('passwordMinLengthHint')
      } else if (result.code === PASSWORD_ALREADY_SET_CODE) {
        // Another tab/session already finished setup — the store has resynced
        // itself; reload so the router picks up the now-current state.
        errorMessage.value = t('passwordAlreadySetError')
        window.setTimeout(() => window.location.reload(), 1500)
      } else {
        errorMessage.value = t('setupPasswordFailed')
      }
      return
    }

    emit('success')
  } catch {
    errorMessage.value = t('setupPasswordFailed')
  } finally {
    loading.value = false
  }
}
</script>
