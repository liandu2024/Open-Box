<template>
  <nav
    class="flex flex-wrap items-center justify-between gap-3 text-xs"
    :aria-label="$t('pagination')"
  >
    <span class="text-base-content/60">{{
      $t('paginationTotal', { n: total.toLocaleString() })
    }}</span>
    <div class="flex flex-wrap items-center gap-3">
      <select
        class="select select-xs w-28"
        :value="customSize ? 'custom' : String(pageSize)"
        :aria-label="$t('paginationPageSize')"
        :disabled="disabled"
        @change="selectSize"
      >
        <option
          v-for="size in presets"
          :key="size"
          :value="String(size)"
        >
          {{ $t('paginationRowsPerPage', { n: size }) }}
        </option>
        <option value="custom">{{ $t('custom') }}</option>
      </select>
      <form
        v-if="customSize"
        class="flex items-center gap-1"
        novalidate
        @submit.prevent="applyCustomSize"
      >
        <input
          v-model="customValue"
          type="number"
          class="input input-xs w-20"
          min="1"
          :max="maxPageSize"
          step="1"
          :aria-label="$t('paginationCustomSize')"
          :placeholder="`1–${maxPageSize}`"
          :disabled="disabled"
        />
        <button
          type="submit"
          class="btn btn-ghost btn-xs"
          :disabled="disabled"
        >
          {{ $t('confirm') }}
        </button>
      </form>
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          :disabled="disabled || currentPage <= 1"
          @click="goToPage(currentPage - 1)"
        >
          {{ $t('paginationPrevious') }}
        </button>
        <span class="whitespace-nowrap tabular-nums">{{ currentPage }} / {{ pageCount }}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          :disabled="disabled || currentPage >= pageCount"
          @click="goToPage(currentPage + 1)"
        >
          {{ $t('paginationNext') }}
        </button>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { showNotification } from '@/helper/notification'
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    total: number
    disabled?: boolean
    maxPageSize?: number
  }>(),
  { disabled: false, maxPageSize: 1000 },
)
const page = defineModel<number>('page', { default: 1 })
const pageSize = defineModel<number>('pageSize', { default: 20 })
const emit = defineEmits<{ change: [value: { page: number; pageSize: number }] }>()
const presets = computed(() => [20, 50, 100].filter((size) => size <= props.maxPageSize))
const pageCount = computed(() => Math.max(1, Math.ceil(props.total / Math.max(1, pageSize.value))))
const currentPage = computed(() => Math.min(pageCount.value, Math.max(1, page.value)))
const customSize = ref(!presets.value.includes(pageSize.value))
const customValue = ref(String(pageSize.value))
watch(pageSize, (value) => {
  customValue.value = String(value)
  if (!presets.value.includes(value)) customSize.value = true
})

const setSize = (size: number) => {
  if (props.disabled || size === pageSize.value) return
  pageSize.value = size
  page.value = 1
  emit('change', { page: 1, pageSize: size })
}
const selectSize = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  customSize.value = value === 'custom'
  if (customSize.value) customValue.value = String(pageSize.value)
  else setSize(Number(value))
}
const applyCustomSize = () => {
  if (props.disabled) return
  const size = Number(customValue.value)
  if (!Number.isInteger(size) || size < 1 || size > props.maxPageSize) {
    showNotification({
      content: 'paginationSizeInvalid',
      params: { max: String(props.maxPageSize) },
      type: 'alert-error',
    })
    return
  }
  setSize(size)
}
const goToPage = (target: number) => {
  if (props.disabled) return
  const next = Math.min(pageCount.value, Math.max(1, target))
  if (next === page.value) return
  page.value = next
  emit('change', { page: next, pageSize: pageSize.value })
}
</script>
