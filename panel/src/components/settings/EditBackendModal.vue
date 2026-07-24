<template>
  <DialogWrapper
    v-model="isVisible"
    :title="t('editBackendTitle')"
    box-class="max-w-3xl"
    @keydown.enter="!isSaving && handleSave()"
  >
    <div class="flex flex-col gap-4">
      <div
        class="flex flex-col gap-3"
        v-if="editForm"
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <label class="text-sm">{{ t('label') }}</label>
            <TextInput
              class="w-full"
              v-model="editForm.label"
              :placeholder="t('label')"
            />
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-sm">{{ t('protocol') }}</label>
            <select
              class="select select-sm w-full"
              v-model="editForm.protocol"
            >
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
            </select>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-sm">{{ t('host') }}</label>
            <TextInput
              class="w-full"
              name="username"
              v-model="editForm.host"
              placeholder="127.0.0.1"
            />
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-sm">{{ t('port') }}</label>
            <TextInput
              class="w-full"
              v-model="editForm.port"
              placeholder="9090"
            />
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-sm">{{ $t('secondaryPath') }} ({{ $t('optional') }})</label>
            <TextInput
              class="w-full"
              v-model="editForm.secondaryPath"
              :placeholder="t('optional')"
            />
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-sm">{{ t('password') }}</label>
            <input
              type="password"
              class="input input-sm w-full"
              v-model="editForm.password"
            />
          </div>
        </div>

        <div class="border-base-content/10 flex flex-col gap-3 border-t pt-3">
          <div class="text-sm font-medium">{{ t('ruleSourceSsh') }}</div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="flex flex-col gap-1">
              <label class="text-sm">{{ t('ruleSourceSshPort') }}</label>
              <TextInput
                class="w-full"
                v-model="editForm.ruleSourceSshPort"
                placeholder="22"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm">{{ t('ruleSourcePlugin') }}</label>
              <select
                class="select select-sm w-full"
                v-model="editForm.ruleSourcePlugin"
              >
                <option value="auto">{{ t('autoDetect') }}</option>
                <option value="openclash">OpenClash</option>
                <option value="nikki">Nikki</option>
              </select>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm">{{ t('ruleSourceSshUsername') }}</label>
              <TextInput
                class="w-full"
                v-model="editForm.ruleSourceSshUsername"
                placeholder="root"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm">{{ t('ruleSourceSshPassword') }}</label>
              <input
                type="password"
                class="input input-sm w-full"
                v-model="editForm.ruleSourceSshPassword"
              />
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn btn-sm"
              :disabled="isTestingRuleSourceSsh"
              @click="detectRuleSourceSsh"
            >
              <span
                v-if="isTestingRuleSourceSsh"
                class="loading loading-spinner loading-xs"
              ></span>
              {{ t('detectRuleSource') }}
            </button>
            <span
              v-if="ruleSourceSshStatus"
              class="text-base-content/70 text-xs"
            >
              {{ ruleSourceSshStatus }}
            </span>
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button
          class="btn btn-sm"
          @click="handleCancel"
          :disabled="isSaving"
        >
          {{ t('cancel') }}
        </button>
        <button
          class="btn btn-primary btn-sm"
          @click="handleSave"
          :disabled="isSaving"
        >
          <span
            v-if="isSaving"
            class="loading loading-spinner loading-xs"
          ></span>
          {{ isSaving ? t('checking') : t('save') }}
        </button>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import { isBackendAvailable } from '@/api'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import TextInput from '@/components/common/TextInput.vue'
import { showNotification } from '@/helper/notification'
import { fetchServerApi } from '@/store/auth'
import { activeBackend, backendList, updateBackend } from '@/store/setup'
import type { Backend } from '@/types'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
  modelValue: boolean
  defaultBackendUuid?: string
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { t } = useI18n()

const isVisible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const editForm = ref<Omit<Backend, 'uuid'> | null>(null)
const editingBackendUuid = ref<string>('')
const isSaving = ref(false)
const isTestingRuleSourceSsh = ref(false)
const ruleSourceSshStatus = ref('')

const selectedBackend = computed(() => {
  return backendList.value.find((b) => b.uuid === editingBackendUuid.value) || null
})

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      if (props.defaultBackendUuid) {
        editingBackendUuid.value = props.defaultBackendUuid
      } else if (activeBackend.value) {
        editingBackendUuid.value = activeBackend.value.uuid
      }
    }
  },
)

watch(
  selectedBackend,
  (backend) => {
    if (backend) {
      editForm.value = {
        protocol: backend.protocol,
        host: backend.host,
        port: backend.port,
        secondaryPath: backend.secondaryPath,
        password: backend.password,
        label: backend.label || '',
        disableUpgradeCore: backend.disableUpgradeCore || false,
        ruleSourcePlugin: backend.ruleSourcePlugin || 'auto',
        ruleSourceSshPort: backend.ruleSourceSshPort || '22',
        ruleSourceSshUsername: backend.ruleSourceSshUsername || 'root',
        ruleSourceSshPassword: backend.ruleSourceSshPassword || '',
      }
      ruleSourceSshStatus.value = ''
    }
  },
  { immediate: true },
)

const handleCancel = () => {
  isVisible.value = false
  editForm.value = null
  editingBackendUuid.value = ''
  ruleSourceSshStatus.value = ''
}

const getRuleSourceSshConfigFromForm = () => ({
  host: editForm.value?.host?.trim() || '',
  port: editForm.value?.ruleSourceSshPort || '22',
  username: editForm.value?.ruleSourceSshUsername?.trim() || 'root',
  password: editForm.value?.ruleSourceSshPassword || '',
  plugin: editForm.value?.ruleSourcePlugin || 'auto',
})

const detectRuleSourceSsh = async () => {
  if (!editForm.value || isTestingRuleSourceSsh.value) return

  isTestingRuleSourceSsh.value = true
  ruleSourceSshStatus.value = ''

  try {
    const response = await fetchServerApi('/api/openwrt-rule-source/detect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        config: getRuleSourceSshConfigFromForm(),
      }),
    })
    const data = (await response.json().catch(() => null)) as {
      plugin?: string
      availablePlugins?: string[]
      configPath?: string
      providerCount?: number
      message?: string
    } | null

    if (!response.ok) {
      throw new Error(data?.message || t('detectRuleSourceFailed', { status: response.status }))
    }

    const availablePlugins = data?.availablePlugins?.length
      ? t('ruleSourceDetectedAvailable', {
          plugins: data.availablePlugins.join(' / '),
        })
      : ''
    ruleSourceSshStatus.value = t('ruleSourceDetected', {
      plugin: data?.plugin || '-',
      path: data?.configPath || '-',
      count: `${data?.providerCount || 0}`,
      availablePlugins,
    })
    showNotification({
      content: ruleSourceSshStatus.value,
      type: 'alert-success',
      timeout: 3000,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ruleSourceSshStatus.value = message
    showNotification({
      content: message,
      type: 'alert-error',
      timeout: 5000,
    })
  } finally {
    isTestingRuleSourceSsh.value = false
  }
}

const handleSave = async () => {
  if (!editForm.value || !selectedBackend.value) return

  isSaving.value = true

  try {
    const testBackend: Backend = {
      uuid: selectedBackend.value.uuid,
      ...editForm.value,
    }

    const isAvailable = await isBackendAvailable(testBackend, 10000)

    if (!isAvailable) {
      showNotification({
        content: t('backendConnectionFailed'),
        type: 'alert-error',
      })
      return
    }

    updateBackend(selectedBackend.value.uuid, editForm.value)
    showNotification({
      content: t('backendConfigSaved'),
      type: 'alert-success',
    })

    isVisible.value = false
    editForm.value = null
    editingBackendUuid.value = ''
    ruleSourceSshStatus.value = ''
    emit('saved')
  } catch (error) {
    showNotification({
      content: `${t('saveFailed')}: ${error}`,
      type: 'alert-error',
    })
  } finally {
    isSaving.value = false
  }
}
</script>
