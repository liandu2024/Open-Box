<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      :style="padding"
    >
      <div class="flex flex-col gap-3 p-3">
        <!-- 订阅管理 / 节点管理 是设置页的两个一级页签(由父组件通过 tab 属性告诉这里显示
             哪一半);操作按钮 Teleport 到顶部页签栏右上角(SettingsMenu 的
             #settings-header-actions),位置固定。 -->
        <Teleport
          defer
          to="#settings-header-actions"
        >
          <button
            v-if="pageTab === 'subs'"
            type="button"
            class="btn btn-primary btn-sm"
            @click="showAddDialog = true"
          >
            <PlusIcon class="h-4 w-4" />
            {{ $t('subscriptionAdd') }}
          </button>
          <!-- 节点管理:两个图标按钮,悬停显示说明 -->
          <template v-else>
            <button
              type="button"
              class="btn btn-sm btn-square"
              :title="$t('groupAutoAdd')"
              :aria-label="$t('groupAutoAdd')"
              @click="groupsPanel?.openAutoDialog()"
            >
              <SparklesIcon class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm btn-square"
              :title="$t('groupAdd')"
              :aria-label="$t('groupAdd')"
              @click="groupsPanel?.openEditor(null)"
            >
              <PlusIcon class="h-4 w-4" />
            </button>
          </template>
        </Teleport>

        <NodeGroupsPanel
          v-if="pageTab === 'groups'"
          ref="groupsPanel"
        />

        <template v-if="pageTab === 'subs'">
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
            @refresh="handleRefresh(sub.id)"
            @delete="requestDelete(sub)"
            @edit="requestEdit(sub)"
          />
        </div>
        </template>
      </div>
    </div>

    <AddSubscriptionDialog
      v-model="showAddDialog"
      @saved="handleSaved"
    />

    <!-- 编辑用同一个弹窗组件,传入 subscription 即切到编辑模式。v-if 保证每次打开都是
         全新实例:弹窗内部在 open 时才 resetForm,而重命名规则编辑器的初始值只在挂载时
         读一次,复用实例会把上一个订阅的规则带过来 -->
    <AddSubscriptionDialog
      v-if="editing"
      v-model="showEditDialog"
      :subscription="editing"
      @saved="handleEdited"
    />

    <DialogWrapper
      v-model="showDeleteDialog"
      :title="$t('subscriptionDeleteTitle')"
    >
      <div class="flex flex-col gap-4 p-2">
        <p class="text-sm">
          {{ $t('subscriptionDeleteConfirm', { name: pendingDelete?.name || '' }) }}
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
import NodeGroupsPanel from '@/components/subscription/NodeGroupsPanel.vue'
import SubscriptionCard from '@/components/subscription/SubscriptionCard.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import {
  PlusIcon,
  RssIcon,
  SparklesIcon,
} from '@heroicons/vue/24/outline'
import { showNotification } from '@/helper/notification'
import { computed, onMounted, ref, useTemplateRef } from 'vue'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})

const props = defineProps<{
  tab?: 'subs' | 'groups'
}>()
const pageTab = computed(() => props.tab ?? 'subs')

const subscriptions = ref<OpenboxSubscription[]>([])
const loading = ref(false)

const loadSubscriptions = async () => {
  loading.value = true
  try {
    subscriptions.value = await fetchSubscriptions()
  } catch (error) {
    showNotification({
      content: 'subscriptionListFailed',
      type: 'alert-error',
      params: { message: error instanceof Error ? error.message : String(error) },
    })
  } finally {
    loading.value = false
  }
}

onMounted(loadSubscriptions)

// 「添加分组」按钮挪到了页签那一行(和「添加订阅」同一个位置),按钮在父组件、
// 弹窗在子组件,所以要拿到子组件的引用去开它。
const groupsPanel = useTemplateRef('groupsPanel')

const showAddDialog = ref(false)
const handleSaved = () => {
  void loadSubscriptions()
}

const showEditDialog = ref(false)
const editing = ref<OpenboxSubscription | null>(null)

const requestEdit = (sub: OpenboxSubscription) => {
  editing.value = sub
  showEditDialog.value = true
}

const handleEdited = () => {
  editing.value = null
  void loadSubscriptions()
}

const refreshingId = ref<string | null>(null)

const handleRefresh = async (id: string) => {
  if (refreshingId.value) return

  refreshingId.value = id

  try {
    await refreshSubscription(id)
    await loadSubscriptions()
  } catch (error) {
    showNotification({
      content: 'subscriptionRefreshFailed',
      type: 'alert-error',
      params: { message: error instanceof Error ? error.message : String(error) },
    })
  } finally {
    refreshingId.value = null
  }
}

const showDeleteDialog = ref(false)
const pendingDelete = ref<OpenboxSubscription | null>(null)
const deleting = ref(false)

const requestDelete = (sub: OpenboxSubscription) => {
  pendingDelete.value = sub
  showDeleteDialog.value = true
}

const confirmDelete = async () => {
  if (deleting.value || !pendingDelete.value) return

  deleting.value = true

  try {
    await deleteSubscription(pendingDelete.value.id)
    showDeleteDialog.value = false
    await loadSubscriptions()
  } catch (error) {
    showNotification({
      content: 'subscriptionDeleteFailed',
      type: 'alert-error',
      params: { message: error instanceof Error ? error.message : String(error) },
    })
  } finally {
    deleting.value = false
  }
}
</script>
