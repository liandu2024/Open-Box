<template>
  <div class="bg-base-200/50 flex h-full w-full items-center justify-center overflow-auto px-4">
    <div class="card bg-base-100 w-full max-w-md gap-4 px-6 py-6 shadow-xl">
      <PasswordSetupForm @success="handleSuccess" />
    </div>
  </div>
</template>

<script setup lang="ts">
import PasswordSetupForm from '@/components/auth/PasswordSetupForm.vue'
import { ROUTE_NAME } from '@/constant'
import router from '@/router'

const handleSuccess = () => {
  const redirect = router.currentRoute.value.query.redirect
  const target =
    typeof redirect === 'string' && redirect
      ? redirect
      : router.resolve({
          name: ROUTE_NAME.proxies,
        }).fullPath

  // Match LoginPage's post-auth navigation: a full reload re-runs bootstrap
  // (initializePersistentStorage etc.) against the freshly-authenticated
  // session instead of carrying over pre-setup state.
  window.location.hash = target
  window.location.reload()
}
</script>
