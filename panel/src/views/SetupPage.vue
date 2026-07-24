<template>
  <div
    class="bg-base-200/50 h-full w-full items-center justify-center overflow-auto sm:flex"
    @keydown.enter="handleSubmit(form)"
  >
    <div class="absolute top-4 right-4 max-sm:hidden">
      <ImportSettings />
    </div>
    <div class="absolute right-4 bottom-4 max-sm:hidden">
      <LanguageSelect />
    </div>
    <div class="card mx-auto w-[min(90vw,48rem)] gap-4 px-6 py-4 max-sm:my-4">
      <h1 class="text-2xl font-semibold">{{ $t('setup') }}</h1>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <label class="text-sm">
            <span>{{ $t('label') }}</span>
          </label>
          <TextInput
            class="w-full"
            v-model="form.label"
            :placeholder="$t('label')"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm">
            <span>{{ $t('protocol') }}</span>
          </label>
          <select
            class="select select-sm w-full"
            v-model="form.protocol"
          >
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm">
            <span>{{ $t('host') }}</span>
          </label>
          <TextInput
            class="w-full"
            name="username"
            autocomplete="username"
            v-model="form.host"
            placeholder="127.0.0.1"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm">
            <span>{{ $t('port') }}</span>
          </label>
          <TextInput
            class="w-full"
            v-model="form.port"
            placeholder="9090"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="flex items-center gap-1 text-sm">
            <span>{{ $t('secondaryPath') }} ({{ $t('optional') }})</span>
            <span
              class="tooltip"
              :data-tip="$t('secondaryPathTip')"
            >
              <QuestionMarkCircleIcon class="h-4 w-4" />
            </span>
          </label>
          <TextInput
            class="w-full"
            v-model="form.secondaryPath"
            :placeholder="$t('optional')"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm">
            <span>{{ $t('password') }}</span>
          </label>
          <input
            type="password"
            class="input input-sm w-full"
            v-model="form.password"
          />
        </div>
      </div>

      <div class="border-base-content/10 flex flex-col gap-3 border-t pt-3">
        <div class="text-sm font-medium">{{ $t('ruleSourceSsh') }}</div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <label class="text-sm">{{ $t('ruleSourceSshPort') }}</label>
            <TextInput
              class="w-full"
              v-model="form.ruleSourceSshPort"
              placeholder="22"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm">{{ $t('ruleSourcePlugin') }}</label>
            <select
              class="select select-sm w-full"
              v-model="form.ruleSourcePlugin"
            >
              <option value="auto">{{ $t('autoDetect') }}</option>
              <option value="openclash">OpenClash</option>
              <option value="nikki">Nikki</option>
            </select>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm">{{ $t('ruleSourceSshUsername') }}</label>
            <TextInput
              class="w-full"
              v-model="form.ruleSourceSshUsername"
              placeholder="root"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm">{{ $t('ruleSourceSshPassword') }}</label>
            <input
              type="password"
              class="input input-sm w-full"
              v-model="form.ruleSourceSshPassword"
            />
          </div>
        </div>
        <div class="flex min-w-0 items-center gap-2">
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
            {{ $t('detectRuleSource') }}
          </button>
          <span
            v-if="ruleSourceSshStatus"
            class="text-base-content/70 min-w-0 flex-1 truncate text-xs whitespace-nowrap"
            :title="ruleSourceSshStatus"
          >
            {{ ruleSourceSshStatus }}
          </span>
        </div>
      </div>

      <button
        class="btn btn-primary btn-sm w-full"
        @click="handleSubmit(form)"
      >
        {{ $t('submit') }}
      </button>
      <Draggable
        class="flex flex-1 flex-col gap-2"
        v-model="backendList"
        group="list"
        :animation="150"
        handle=".backend-drag-handle"
        ghost-class="backend-drag-ghost"
        :item-key="'uuid'"
      >
        <template #item="{ element }">
          <div
            :key="element.uuid"
            class="flex items-center gap-2"
          >
            <button
              type="button"
              class="backend-drag-handle btn btn-circle btn-ghost btn-sm cursor-grab touch-none active:cursor-grabbing"
              :title="$t('dragToSort')"
              :aria-label="$t('dragToSort')"
              @click.stop
            >
              <ChevronUpDownIcon class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="btn btn-sm flex-1 touch-manipulation"
              @click="selectBackend(element.uuid)"
            >
              {{ getLabelFromBackend(element) }}
            </button>
            <button
              type="button"
              class="btn btn-circle btn-ghost btn-sm touch-manipulation"
              @click="editBackend(element)"
            >
              <PencilIcon class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="btn btn-circle btn-ghost btn-sm touch-manipulation"
              @click="() => removeBackend(element.uuid)"
            >
              <TrashIcon class="h-4 w-4" />
            </button>
          </div>
        </template>
      </Draggable>
      <div class="mt-4 sm:hidden">
        <LanguageSelect />
      </div>
      <div class="absolute top-2 right-2 sm:hidden">
        <ImportSettings />
      </div>
    </div>

    <!-- 编辑Backend Modal -->
    <EditBackendModal
      v-model="showEditModal"
      :default-backend-uuid="editingBackendUuid"
    />
  </div>
</template>

<script setup lang="ts">
import ImportSettings from '@/components/common/ImportSettings.vue'
import TextInput from '@/components/common/TextInput.vue'
import EditBackendModal from '@/components/settings/EditBackendModal.vue'
import LanguageSelect from '@/components/settings/LanguageSelect.vue'
import { ROUTE_NAME } from '@/constant'
import { showNotification } from '@/helper/notification'
import { getBackendFromUrl, getLabelFromBackend, getUrlFromBackend } from '@/helper/utils'
import router from '@/router'
import { fetchServerApi } from '@/store/auth'
import { activeUuid, addBackend, backendList, removeBackend } from '@/store/setup'
import type { Backend } from '@/types'
import {
  ChevronUpDownIcon,
  PencilIcon,
  QuestionMarkCircleIcon,
  TrashIcon,
} from '@heroicons/vue/24/outline'
import { reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Draggable from 'vuedraggable'

type BackendForm = Omit<Backend, 'uuid'>

const { t } = useI18n()

const createDefaultBackendForm = (): BackendForm => ({
  protocol: 'http',
  host: '127.0.0.1',
  port: '9090',
  secondaryPath: '',
  password: '',
  label: '',
  disableUpgradeCore: false,
  ruleSourcePlugin: 'auto',
  ruleSourceSshPort: '22',
  ruleSourceSshUsername: 'root',
  ruleSourceSshPassword: '',
})

const normalizeBackendForm = (backend: Partial<BackendForm>): BackendForm => ({
  ...createDefaultBackendForm(),
  ...backend,
  protocol: backend.protocol || 'http',
  host: backend.host || '127.0.0.1',
  port: backend.port || '9090',
  secondaryPath: backend.secondaryPath || '',
  password: backend.password || '',
  label: backend.label || '',
  disableUpgradeCore: backend.disableUpgradeCore || false,
  ruleSourcePlugin: backend.ruleSourcePlugin || 'auto',
  ruleSourceSshPort: backend.ruleSourceSshPort || '22',
  ruleSourceSshUsername: backend.ruleSourceSshUsername || 'root',
  ruleSourceSshPassword: backend.ruleSourceSshPassword || '',
})

const form = reactive<BackendForm>(createDefaultBackendForm())
const showEditModal = ref(false)
const editingBackendUuid = ref<string>('')
const isTestingRuleSourceSsh = ref(false)
const ruleSourceSshStatus = ref('')

const getBackendPayload = (backend: Partial<BackendForm>): BackendForm =>
  ((normalized) => ({
    ...normalized,
    host: backend.host === undefined ? normalized.host : backend.host.trim(),
    port: backend.port === undefined ? normalized.port : backend.port.trim(),
    secondaryPath:
      backend.secondaryPath === undefined ? normalized.secondaryPath : backend.secondaryPath.trim(),
    label: backend.label === undefined ? normalized.label : backend.label.trim(),
    ruleSourceSshPort:
      backend.ruleSourceSshPort === undefined
        ? normalized.ruleSourceSshPort
        : backend.ruleSourceSshPort.trim(),
    ruleSourceSshUsername:
      backend.ruleSourceSshUsername === undefined
        ? normalized.ruleSourceSshUsername
        : backend.ruleSourceSshUsername.trim(),
  }))(normalizeBackendForm(backend))

// 监听路由参数，自动打开编辑模态框
watch(
  () => router.currentRoute.value.query.editBackend,
  (backendUuid) => {
    if (backendUuid && typeof backendUuid === 'string') {
      editingBackendUuid.value = backendUuid
      showEditModal.value = true
      // 清除路由参数以避免重复触发
      router.replace({ query: {} })
    }
  },
  { immediate: true },
)

const selectBackend = (uuid: string) => {
  activeUuid.value = uuid
  router.push({ name: ROUTE_NAME.proxies })
}

const editBackend = (backend: Backend) => {
  editingBackendUuid.value = backend.uuid
  showEditModal.value = true
}

const getRuleSourceSshConfigFromForm = () => {
  const payload = getBackendPayload(form)

  return {
    host: payload.host,
    port: payload.ruleSourceSshPort || '22',
    username: payload.ruleSourceSshUsername || 'root',
    password: payload.ruleSourceSshPassword || '',
    plugin: payload.ruleSourcePlugin || 'auto',
  }
}

const detectRuleSourceSsh = async () => {
  if (isTestingRuleSourceSsh.value) return

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
    ruleSourceSshStatus.value = t('ruleSourceDetectedShort', {
      plugin: data?.plugin || '-',
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

const handleSubmit = async (backendForm: Omit<Backend, 'uuid'>, quiet = false) => {
  const payload = getBackendPayload(backendForm)
  const { protocol, host, port, password } = payload

  if (!protocol || !host || !port) {
    alert('Please fill in all the fields.')
    return
  }

  if (
    window.location.protocol === 'https:' &&
    protocol === 'http' &&
    !['::1', '0.0.0.0', '127.0.0.1', 'localhost'].includes(host) &&
    !quiet
  ) {
    showNotification({
      content: 'protocolTips',
    })
  }

  try {
    const headers: Record<string, string> = {}
    const versionUrl = '/api/controller/version'
    headers['x-zashboard-target-base'] = getUrlFromBackend(payload)
    headers['x-zashboard-target-secret'] = password

    const data = await fetchServerApi(versionUrl, {
      method: 'GET',
      headers,
    })

    if (data.status !== 200) {
      if (!quiet) {
        alert(data.statusText)
      }
      return
    }

    const { version, message } = await data.json()

    if (!version) {
      if (!quiet) {
        alert(message)
      }
      return
    }

    addBackend(payload)

    router.push({ name: ROUTE_NAME.proxies })
  } catch (e) {
    if (!quiet) {
      alert(e)
    }
  }
}

const backend = getBackendFromUrl()

if (backend) {
  handleSubmit(normalizeBackendForm(backend))
} else if (backendList.value.length === 0) {
  handleSubmit(form, true)
}
</script>

<style scoped>
.backend-drag-ghost {
  opacity: 0.45;
}
</style>
