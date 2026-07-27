<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      :style="padding"
    >
      <div class="flex flex-col gap-3 p-3">
        <div class="flex items-center justify-between gap-2">
          <h1 class="text-lg font-semibold">{{ $t('subscriptions') }}</h1>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            @click="showAddDialog = true"
          >
            <PlusIcon class="h-4 w-4" />
            {{ $t('subscriptionAdd') }}
          </button>
        </div>

        <p
          v-if="listError"
          class="text-error text-sm"
        >
          {{ listError }}
        </p>

        <div
          v-if="loading && subscriptions.length === 0"
          class="flex justify-center py-14"
        >
          <span class="loading loading-spinner loading-md" />
        </div>

        <div
          v-else-if="subscriptions.length === 0"
          class="border-base-content/15 flex flex-col items-center gap-3 rounded-lg border border-dashed py-14 text-center"
        >
          <RssIcon class="text-base-content/30 h-10 w-10" />
          <p class="text-base-content/60 text-sm">{{ $t('subscriptionEmptyHint') }}</p>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            @click="showAddDialog = true"
          >
            <PlusIcon class="h-4 w-4" />
            {{ $t('subscriptionAdd') }}
          </button>
        </div>

        <div
          v-else
          class="flex flex-col gap-2"
        >
          <SubscriptionCard
            v-for="sub in subscriptions"
            :key="sub.id"
            :subscription="sub"
            :refreshing="refreshingId === sub.id"
            :refresh-error="refreshErrors[sub.id]"
            @refresh="handleRefresh(sub.id)"
            @delete="requestDelete(sub)"
          />
        </div>
      </div>
    </div>

    <AddSubscriptionDialog
      v-model="showAddDialog"
      @saved="handleSaved"
    />

    <DialogWrapper
      v-model="showDeleteDialog"
      :title="$t('subscriptionDeleteTitle')"
    >
      <div class="flex flex-col gap-4 p-2">
        <p class="text-sm">
          {{ $t('subscriptionDeleteConfirm', { name: pendingDelete?.name || '' }) }}
        </p>
        <p
          v-if="deleteError"
          class="text-error text-xs"
        >
          {{ deleteError }}
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="showDeleteDialog = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-error btn-sm"
            :disabled="deleting"
            @click="confirmDelete"
          >
            <span
              v-if="deleting"
              class="loading loading-spinner loading-xs"
            />
            {{ $t('confirm') }}
          </button>
        </div>
      </div>
    </DialogWrapper>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxSubscription } from '@/api/openbox'
import { deleteSubscription, fetchSubscriptions, refreshSubscription } from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import AddSubscriptionDialog from '@/components/subscription/AddSubscriptionDialog.vue'
import SubscriptionCard from '@/components/subscription/SubscriptionCard.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { PlusIcon, RssIcon } from '@heroicons/vue/24/outline'
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})

const subscriptions = ref<OpenboxSubscription[]>([])
const loading = ref(false)
const listError = ref('')

const loadSubscriptions = async () => {
  loading.value = true
  listError.value = ''
  try {
    subscriptions.value = await fetchSubscriptions()
  } catch (error) {
    listError.value = t('subscriptionListFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    loading.value = false
  }
}

onMounted(loadSubscriptions)

const showAddDialog = ref(false)
const handleSaved = () => {
  void loadSubscriptions()
}

const refreshingId = ref<string | null>(null)
const refreshErrors = reactive<Record<string, string>>({})

const handleRefresh = async (id: string) => {
  if (refreshingId.value) return

  refreshingId.value = id
  delete refreshErrors[id]

  try {
    await refreshSubscription(id)
    await loadSubscriptions()
  } catch (error) {
    refreshErrors[id] = t('subscriptionRefreshFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    refreshingId.value = null
  }
}

const showDeleteDialog = ref(false)
const pendingDelete = ref<OpenboxSubscription | null>(null)
const deleting = ref(false)
const deleteError = ref('')

const requestDelete = (sub: OpenboxSubscription) => {
  pendingDelete.value = sub
  deleteError.value = ''
  showDeleteDialog.value = true
}

const confirmDelete = async () => {
  if (deleting.value || !pendingDelete.value) return

  deleting.value = true
  deleteError.value = ''

  try {
    await deleteSubscription(pendingDelete.value.id)
    showDeleteDialog.value = false
    await loadSubscriptions()
  } catch (error) {
    deleteError.value = t('subscriptionDeleteFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    deleting.value = false
  }
}
</script>
