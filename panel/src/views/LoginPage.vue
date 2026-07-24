<template>
  <div
    class="bg-base-200/50 flex h-full w-full items-center justify-center overflow-auto px-4"
    @keydown.enter="handleLogin"
  >
    <div class="card bg-base-100 w-full max-w-md gap-4 px-6 py-6 shadow-xl">
      <div class="space-y-2">
        <h1 class="text-2xl font-semibold">{{ $t('passwordLoginTitle') }}</h1>
        <p class="text-base-content/70 text-sm">
          {{ $t('passwordLoginDescription') }}
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-sm">{{ $t('accessPassword') }}</label>
        <input
          v-model="password"
          type="password"
          class="input input-sm w-full"
          autofocus
        />
      </div>

      <p
        v-if="error"
        class="text-error text-sm"
      >
        {{ $t('wrongAccessPassword') }}
      </p>

      <button
        class="btn btn-primary btn-sm w-full"
        @click="handleLogin"
      >
        {{ $t('login') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ROUTE_NAME } from '@/constant'
import router from '@/router'
import { loginWithAccessPassword } from '@/store/auth'
import { activeBackend } from '@/store/setup'
import { ref } from 'vue'

const password = ref('')
const error = ref(false)
const loading = ref(false)

const handleLogin = async () => {
  if (loading.value) return

  loading.value = true

  try {
    const result = await loginWithAccessPassword(password.value)

    if (!result.ok) {
      error.value = true
      return
    }

    error.value = false

    const redirect = router.currentRoute.value.query.redirect
    const target =
      typeof redirect === 'string' && redirect
        ? redirect
        : router.resolve({
            name: activeBackend.value ? ROUTE_NAME.proxies : ROUTE_NAME.setup,
          }).fullPath

    window.location.hash = target
    window.location.reload()
  } finally {
    loading.value = false
  }
}
</script>
