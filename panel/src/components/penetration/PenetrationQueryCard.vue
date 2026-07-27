<template>
  <div class="card">
    <div class="app-card-padding flex flex-col gap-3 text-sm">
      <div>
        <h2 class="text-base font-semibold">{{ $t('penetrationTitle') }}</h2>
        <p class="text-base-content/60 text-xs">{{ $t('penetrationDescription') }}</p>
      </div>

      <form
        class="join w-full sm:w-96"
        @submit.prevent="handleSubmit"
      >
        <TextInput
          v-model="target"
          class="join-item flex-1"
          :placeholder="$t('penetrationInputPlaceholder')"
          :clearable="true"
        />
        <button
          type="submit"
          class="btn btn-primary btn-sm join-item"
          :disabled="loading"
        >
          <span
            v-if="loading"
            class="loading loading-spinner loading-xs"
          />
          {{ $t('penetrationQuery') }}
        </button>
      </form>

      <p
        v-if="validationError"
        class="text-error text-xs"
      >
        {{ validationError }}
      </p>
      <p
        v-else-if="queryError"
        class="text-error text-xs"
      >
        {{ queryError }}
      </p>

      <PenetrationPath
        v-if="result"
        :target="queriedTarget"
        :matched="result.matched"
        :chain="result.chain"
        :final-outbound="result.finalOutbound"
        :chain-error="result.chainError"
        :match-error="result.matchError"
      />
      <p
        v-else-if="!loading"
        class="text-base-content/50 text-xs"
      >
        {{ $t('penetrationEmptyHint') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { isValidPenetrationTarget, queryPenetration, type OpenboxPenetrationResult } from '@/api/openbox'
import TextInput from '@/components/common/TextInput.vue'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PenetrationPath from './PenetrationPath.vue'

const { t } = useI18n()

const target = ref('')
const queriedTarget = ref('')
const loading = ref(false)
const validationError = ref('')
const queryError = ref('')
const result = ref<OpenboxPenetrationResult | null>(null)

// Rejects obviously-bad input (flag-like, e.g. "--help") before it ever round-trips to the
// server — see isValidPenetrationTarget's docs in api/openbox.ts. The server enforces the same
// rule independently (Important 6 in the P3/P4a review), so this is purely a faster/friendlier
// first line, not the actual authority.
const handleSubmit = async () => {
  const value = target.value.trim()
  validationError.value = ''
  queryError.value = ''

  if (!value) {
    validationError.value = t('penetrationInputRequired')
    return
  }
  if (!isValidPenetrationTarget(value)) {
    validationError.value = t('penetrationInputInvalid')
    return
  }

  loading.value = true
  result.value = null
  try {
    result.value = await queryPenetration(value)
    queriedTarget.value = value
  } catch (error) {
    queryError.value = t('penetrationQueryFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    loading.value = false
  }
}
</script>
