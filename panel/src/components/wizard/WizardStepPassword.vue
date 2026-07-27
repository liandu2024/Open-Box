<template>
  <PasswordSetupForm @success="$emit('next')" />
</template>

<script setup lang="ts">
// Step 1: reuses Task 3's standalone setup form as-is (see
// src/components/auth/PasswordSetupForm.vue) — it only knows how to collect+submit a new
// password and emit `success`; this wrapper just turns that into "advance the wizard" instead
// of PasswordSetupForm's other caller (SetupPasswordPage.vue) navigating away.
//
// In practice the router guard already forces `/setup` (not `/wizard`) whenever no password
// exists, so this step is normally pre-satisfied by the time a user reaches the wizard at all
// — it's kept here so the wizard is still correct on its own if that ever changes (e.g. direct
// navigation to `/wizard` before the guard has settled).
import PasswordSetupForm from '@/components/auth/PasswordSetupForm.vue'

defineEmits<{
  next: []
}>()
</script>
