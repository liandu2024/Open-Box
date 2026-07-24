<template>
  <div class="join flex">
    <select
      class="join-item select select-sm w-46 max-w-60 flex-1"
      v-model="activeUuid"
    >
      <option
        v-for="opt in opts"
        :key="opt.value"
        :value="opt.value"
      >
        {{ opt.label }}
      </option>
    </select>
    <button
      v-if="!disableEditBackend"
      class="btn join-item btn-sm px-3 whitespace-nowrap"
      @click="editBackend"
      :disabled="!activeBackend"
      :aria-label="t('editBackendTitle')"
      :title="t('editBackendTitle')"
    >
      {{ t('editBackendTitle') }}
    </button>
    <button
      class="btn join-item btn-sm"
      @click="addBackend"
    >
      <PlusIcon class="h-4 w-4" />
    </button>
  </div>

  <!-- 编辑Backend Modal -->
  <EditBackendModal v-model="showEditModal" />
</template>

<script setup lang="ts">
import { ROUTE_NAME } from '@/constant'
import { getLabelFromBackend } from '@/helper/utils'
import router from '@/router'
import { activeBackend, activeUuid, backendList } from '@/store/setup'
import { PlusIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import EditBackendModal from './EditBackendModal.vue'

withDefaults(
  defineProps<{
    disableEditBackend?: boolean
  }>(),
  {
    disableEditBackend: false,
  },
)

const opts = computed(() => {
  return backendList.value.map((b) => {
    return {
      label: getLabelFromBackend(b),
      value: b.uuid,
    }
  })
})

const showEditModal = ref(false)
const { t } = useI18n()

const addBackend = () => {
  activeUuid.value = null
  router.push({ name: ROUTE_NAME.setup })
}

const editBackend = () => {
  if (!activeBackend.value) return
  showEditModal.value = true
}
</script>
