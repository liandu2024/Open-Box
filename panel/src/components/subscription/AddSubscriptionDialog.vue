<template>
  <DialogWrapper
    v-model="isOpen"
    :title="$t('subscriptionAddTitle')"
    box-class="w-full max-w-4xl"
  >
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <!-- Left: source + name + rename rules -->
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('subscriptionNameLabel') }}</label>
          <input
            v-model="name"
            type="text"
            class="input input-sm w-full"
            :placeholder="$t('subscriptionNamePlaceholder')"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('subscriptionUrlLabel') }}</label>
          <input
            v-model="url"
            type="text"
            class="input input-sm w-full"
            placeholder="https://"
            autocomplete="off"
          />
          <p class="text-base-content/50 text-xs">{{ $t('subscriptionUrlHint') }}</p>
        </div>

        <div class="flex flex-col gap-1">
          <button
            type="button"
            class="text-primary self-start text-xs underline-offset-2 hover:underline"
            @click="togglePasteMode"
          >
            {{ pasteMode ? $t('subscriptionUsePasteHide') : $t('subscriptionUsePasteShow') }}
          </button>
          <template v-if="pasteMode">
            <textarea
              v-model="content"
              rows="5"
              class="textarea textarea-sm w-full font-mono"
              :placeholder="$t('subscriptionContentPlaceholder')"
            />
            <p class="text-warning text-xs">{{ $t('subscriptionContentPreviewOnlyHint') }}</p>
          </template>
        </div>

        <div class="divider my-0" />

        <RenameRulesEditor @change="handleRenameOptionsChange" />
      </div>

      <!-- Right: live preview -->
      <div class="lg:border-base-content/10 flex min-h-0 flex-col gap-3 lg:border-l lg:pl-5">
        <SubscriptionPreviewPanel
          :has-source="hasSource"
          :loading="previewing"
          :error="previewErrorMessage"
          :preview="preview"
        />
      </div>
    </div>

    <div class="mt-5 flex flex-col gap-2">
      <p
        v-if="saveErrorMessage"
        class="text-error text-sm"
      >
        {{ saveErrorMessage }}
      </p>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="btn btn-sm"
          @click="isOpen = false"
        >
          {{ $t('cancel') }}
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="!canSave || saving"
          @click="handleSave"
        >
          <span
            v-if="saving"
            class="loading loading-spinner loading-xs"
          />
          {{ $t('subscriptionSave') }}
        </button>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import type { OpenboxRenameOptions, OpenboxSubscriptionPreview } from '@/api/openbox'
import { createSubscription, previewSubscription } from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { debounce } from 'lodash'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import RenameRulesEditor from './RenameRulesEditor.vue'
import SubscriptionPreviewPanel from './SubscriptionPreviewPanel.vue'

const isOpen = defineModel<boolean>({ required: true })

const emit = defineEmits<{
  saved: []
}>()

const { t } = useI18n()

const name = ref('')
const url = ref('')
const content = ref('')
const pasteMode = ref(false)

const renameOptions = ref<OpenboxRenameOptions>({})
const handleRenameOptionsChange = (value: OpenboxRenameOptions) => {
  renameOptions.value = value
}

const preview = ref<OpenboxSubscriptionPreview | null>(null)
const previewing = ref(false)
const previewErrorMessage = ref('')
const saving = ref(false)
const saveErrorMessage = ref('')

// content (when the paste-mode textarea is non-empty) wins over url — mirrors
// server/api/subscriptions.mjs's resolveNodes priority, so what's shown in the preview panel is
// always exactly what a save/preview call with these fields would produce.
const effectiveSource = computed(() => {
  const trimmedContent = content.value.trim()
  if (trimmedContent) return { content: trimmedContent }
  const trimmedUrl = url.value.trim()
  if (trimmedUrl) return { url: trimmedUrl }
  return null
})
const hasSource = computed(() => effectiveSource.value !== null)

const canSave = computed(() => Boolean(url.value.trim()) && !previewing.value)

const togglePasteMode = () => {
  pasteMode.value = !pasteMode.value
  if (!pasteMode.value) {
    content.value = ''
  }
}

// Monotonic guard against out-of-order responses: a slow preview call for stale input must
// never clobber a newer one that resolved first.
let previewSeq = 0

const runPreviewNow = async () => {
  const src = effectiveSource.value
  if (!src) return

  const seq = ++previewSeq
  previewing.value = true
  previewErrorMessage.value = ''

  try {
    const result = await previewSubscription({ ...src, renameOptions: renameOptions.value })
    if (seq !== previewSeq) return
    preview.value = result
  } catch (error) {
    if (seq !== previewSeq) return
    preview.value = null
    previewErrorMessage.value = t('subscriptionPreviewFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    if (seq === previewSeq) previewing.value = false
  }
}

const debouncedPreview = debounce(runPreviewNow, 450)

watch(
  [effectiveSource, renameOptions],
  () => {
    if (!hasSource.value) {
      debouncedPreview.cancel()
      previewSeq += 1 // invalidate any in-flight response
      preview.value = null
      previewErrorMessage.value = ''
      previewing.value = false
      return
    }
    debouncedPreview()
  },
  { deep: true },
)

const resetForm = () => {
  debouncedPreview.cancel()
  previewSeq += 1
  name.value = ''
  url.value = ''
  content.value = ''
  pasteMode.value = false
  preview.value = null
  previewing.value = false
  previewErrorMessage.value = ''
  saving.value = false
  saveErrorMessage.value = ''
}

watch(isOpen, (open) => {
  if (open) resetForm()
})

onBeforeUnmount(() => {
  debouncedPreview.cancel()
})

const handleSave = async () => {
  if (saving.value || !canSave.value) return

  saving.value = true
  saveErrorMessage.value = ''

  try {
    await createSubscription({
      url: url.value.trim(),
      name: name.value.trim() || t('subscriptionDefaultName'),
      renameOptions: renameOptions.value,
    })
    emit('saved')
    isOpen.value = false
  } catch (error) {
    saveErrorMessage.value = t('subscriptionSaveFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    saving.value = false
  }
}
</script>
