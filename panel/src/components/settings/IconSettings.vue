<template>
  <div class="icon-settings-panel flex w-full max-w-[min(100%,var(--container-7xl))] min-w-0 flex-col gap-3 overflow-x-hidden">
    <div class="icon-settings-shell flex w-full min-w-0 flex-col gap-3 overflow-x-hidden">
      <div class="icon-settings-header flex items-center justify-between gap-3">
        <div class="settings-title icon-settings-title py-0">
          {{ $t('icon') }}
        </div>
        <div
          v-if="iconReflectList.length"
          class="icon-settings-trigger group flex items-center gap-2 select-none cursor-pointer"
          role="button"
          tabindex="0"
          @click="toggleDialogVisible"
          @keydown.enter.prevent="toggleDialogVisible"
          @keydown.space.prevent="toggleDialogVisible"
        >
          <span>{{ $t('customIcon') }}</span>
          <span>({{ iconReflectList.length }})</span>
          <span
            class="btn btn-sm btn-circle pointer-events-none shrink-0 transition-colors group-hover:bg-base-300"
            aria-hidden="true"
          >
            <ChevronUpIcon
              v-if="dialogVisible"
              class="h-4 w-4"
            />
            <ChevronDownIcon
              v-else
              class="h-4 w-4"
            />
          </span>
        </div>
        <div
          v-else
          class="icon-settings-trigger flex items-center gap-2"
        >
          {{ $t('customIcon') }}
        </div>
      </div>
      <div
        v-if="dialogVisible && iconReflectList.length"
        class="icon-settings-tabs bg-base-200 inline-flex h-10 items-center gap-1 rounded-field p-0.5"
      >
        <button
          class="btn btn-sm h-8 min-h-8 rounded-field border-none px-4 font-normal"
          :class="activeTab === 'policy' ? 'btn-primary' : 'btn-ghost bg-transparent'"
          @click="activeTab = 'policy'"
        >
          {{ $t('policyGroup') }} ({{ policyGroupIcons.length }})
        </button>
        <button
          class="btn btn-sm h-8 min-h-8 rounded-field border-none px-4 font-normal"
          :class="activeTab === 'node' ? 'btn-primary' : 'btn-ghost bg-transparent'"
          @click="activeTab = 'node'"
        >
          {{ $t('nodeGroup') }} ({{ nodeGroupIcons.length }})
        </button>
        <button
          class="btn btn-sm h-8 min-h-8 rounded-field border-none px-4 font-normal"
          :class="activeTab === 'other' ? 'btn-primary' : 'btn-ghost bg-transparent'"
          @click="activeTab = 'other'"
        >
          {{ $t('other') }} ({{ otherIcons.length }})
        </button>
      </div>
    </div>
    <div
      v-show="dialogVisible"
      class="icon-settings-content w-full min-w-0"
    >
      <div class="grid w-full min-w-0 max-w-full grid-cols-1 gap-2 overflow-x-hidden md:grid-cols-2">
        <div
          v-for="iconReflect in filteredIconReflectList"
          :key="iconReflect.uuid"
          class="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden"
        >
          <TextInput
            class="w-32"
            v-model="iconReflect.name"
            :placeholder="$t('groupName')"
          />
          <ArrowRightCircleIcon class="h-4 w-4 shrink-0" />
          <div
            class="bg-base-200 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden"
            :class="hasPreview(iconReflect.icon) ? '' : 'text-base-content/50 text-xs'"
          >
            <img
              v-if="hasPreview(iconReflect.icon)"
              :src="iconReflect.icon"
              alt="icon preview"
              class="h-5 w-5 object-contain"
            />
            <span v-else>?</span>
          </div>
          <div
            class="min-w-0 flex-1 overflow-hidden"
            :class="dragTargetKey === iconReflect.uuid ? 'ring-primary rounded-field ring-1' : ''"
            @dragenter.prevent="dragTargetKey = iconReflect.uuid"
            @dragover.prevent="dragTargetKey = iconReflect.uuid"
            @dragleave.prevent="clearDragTarget(iconReflect.uuid)"
            @drop.prevent="handleDrop(iconReflect.uuid, $event, iconReflect)"
          >
            <TextInput
              class="w-full min-w-0 max-w-full"
              :model-value="getIconDisplayValue(iconReflect.uuid, iconReflect.icon)"
              placeholder="Icon URL"
              @update:modelValue="
                updateIconFromInput(iconReflect.uuid, iconReflect, $event || '')
              "
            >
              <template #suffix>
                <button
                  v-if="iconReflect.icon"
                  class="btn btn-ghost btn-xs h-6 min-h-6 w-6 min-w-6 p-0"
                  @click="copyIcon(iconReflect.icon)"
                >
                  <DocumentDuplicateIcon class="h-3.5 w-3.5 shrink-0" />
                </button>
              </template>
            </TextInput>
          </div>
          <button
            class="btn btn-sm btn-circle"
            @click="selectIconFile(iconReflect)"
          >
            <ArrowUpTrayIcon class="h-4 w-4 shrink-0" />
          </button>
          <button
            class="btn btn-sm btn-circle"
            @click="removeIconReflect(iconReflect.uuid)"
          >
            <TrashIcon class="h-4 w-4 shrink-0" />
          </button>
        </div>
      </div>
    </div>
    <div class="flex w-full min-w-0 items-center gap-2 overflow-hidden">
      <TextInput
        class="w-32"
        v-model="newIconReflect.name"
        placeholder="Name"
        :menus="
          proxyGroupList.filter((group) => !iconReflectList.some((item) => item.name === group))
        "
        @keydown.enter="addIconReflect"
      />
      <ArrowRightCircleIcon class="h-4 w-4 shrink-0" />
      <div
        class="bg-base-200 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden"
        :class="hasPreview(newIconReflect.icon) ? '' : 'text-base-content/50 text-xs'"
      >
        <img
          v-if="hasPreview(newIconReflect.icon)"
          :src="newIconReflect.icon"
          alt="icon preview"
          class="h-5 w-5 object-contain"
        />
        <span v-else>?</span>
      </div>
      <div
        class="min-w-0 flex-1 overflow-hidden"
        :class="dragTargetKey === NEW_ICON_DRAG_KEY ? 'ring-primary rounded-field ring-1' : ''"
        @dragenter.prevent="dragTargetKey = NEW_ICON_DRAG_KEY"
        @dragover.prevent="dragTargetKey = NEW_ICON_DRAG_KEY"
        @dragleave.prevent="clearDragTarget(NEW_ICON_DRAG_KEY)"
        @drop.prevent="handleDrop(NEW_ICON_DRAG_KEY, $event, newIconReflect)"
      >
        <TextInput
          class="w-full min-w-0 max-w-full"
          :model-value="getIconDisplayValue(NEW_ICON_DRAG_KEY, newIconReflect.icon)"
          placeholder="Icon URL"
          @update:modelValue="updateIconFromInput(NEW_ICON_DRAG_KEY, newIconReflect, $event || '')"
          @keydown.enter="addIconReflect"
        >
          <template #suffix>
            <button
              v-if="newIconReflect.icon"
              class="btn btn-ghost btn-xs h-6 min-h-6 w-6 min-w-6 p-0"
              @click="copyIcon(newIconReflect.icon)"
            >
              <DocumentDuplicateIcon class="h-3.5 w-3.5 shrink-0" />
            </button>
          </template>
        </TextInput>
      </div>
      <button
        class="btn btn-sm btn-circle"
        @click="selectIconFile(newIconReflect)"
      >
        <ArrowUpTrayIcon class="h-4 w-4 shrink-0" />
      </button>
      <button
        class="btn btn-sm btn-circle"
        @click="addIconReflect"
      >
        <PlusIcon class="h-4 w-4 shrink-0" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nodeGroups, policyGroups } from '@/composables/proxies'
import { fetchProxies, proxyGroupList, proxyMap } from '@/store/proxies'
import { iconReflectList } from '@/store/settings'
import {
  ArrowRightCircleIcon,
  ArrowUpTrayIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentDuplicateIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/vue/24/outline'
import { useSessionStorage } from '@vueuse/core'
import { v4 as uuid } from 'uuid'
import { computed, onMounted, reactive, ref } from 'vue'
import TextInput from '../common/TextInput.vue'

const dialogVisible = useSessionStorage('cache/icon-dialog-visible', false)
const NEW_ICON_DRAG_KEY = '__new-icon__'
const dragTargetKey = ref<string | null>(null)
const activeTab = ref<'policy' | 'node' | 'other'>('policy')
const uploadedIconNames = reactive<Record<string, string>>({})
const newIconReflect = reactive({
  name: '',
  icon: '',
})

const availableGroupNames = computed(() => {
  if (proxyGroupList.value.length) {
    return proxyGroupList.value
  }

  return Object.values(proxyMap.value)
    .filter((proxy) => Array.isArray(proxy.all) && proxy.all.length > 0)
    .map((proxy) => proxy.name)
})

const currentGroupNameSet = computed(() => new Set(availableGroupNames.value))

const policyGroupNames = computed(() => {
  return policyGroups.value.filter((name) => currentGroupNameSet.value.has(name))
})

const nodeGroupNames = computed(() => {
  return nodeGroups.value.filter((name) => currentGroupNameSet.value.has(name))
})

const getIconsByNames = (names: string[]) => {
  const iconMap = new Map(iconReflectList.value.map((item) => [item.name, item]))

  return names
    .map((name) => iconMap.get(name))
    .filter((item): item is (typeof iconReflectList.value)[number] => Boolean(item))
}

const policyGroupIcons = computed(() => getIconsByNames(policyGroupNames.value))
const nodeGroupIcons = computed(() => getIconsByNames(nodeGroupNames.value))

const otherIcons = computed(() => {
  return iconReflectList.value.filter((item) => !currentGroupNameSet.value.has(item.name))
})

const filteredIconReflectList = computed(() => {
  if (activeTab.value === 'policy') {
    return policyGroupIcons.value
  }

  if (activeTab.value === 'node') {
    return nodeGroupIcons.value
  }

  return otherIcons.value
})

const toggleDialogVisible = () => {
  if (!iconReflectList.value.length) return
  dialogVisible.value = !dialogVisible.value
}

const hasPreview = (icon: string) => {
  return Boolean(icon?.trim())
}

const isDataImage = (icon: string) => {
  return icon.trim().startsWith('data:image/')
}

const getIconDisplayValue = (key: string, icon: string) => {
  if (!icon) return ''
  return uploadedIconNames[key] || icon
}

const readIconFile = (file: File) => {
  return new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Only image files are supported'))
      return
    }

    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read icon file'))
    reader.readAsDataURL(file)
  })
}

const applyIconFile = async (target: { icon: string }, file?: File | null) => {
  if (!file) return

  try {
    target.icon = await readIconFile(file)
    uploadedIconNames[getTargetKey(target)] = file.name
  } catch (error) {
    console.warn('Failed to load icon file', error)
  }
}

const getTargetKey = (target: { icon: string; uuid?: string }) => {
  return target.uuid || NEW_ICON_DRAG_KEY
}

const selectIconFile = (target: { icon: string }) => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    await applyIconFile(target, file)
    input.value = ''
  }
  input.click()
}

const clearDragTarget = (key: string) => {
  if (dragTargetKey.value === key) {
    dragTargetKey.value = null
  }
}

const handleDrop = async (key: string, event: DragEvent, target: { icon: string }) => {
  clearDragTarget(key)
  const file = event.dataTransfer?.files?.[0]
  await applyIconFile(target, file)
}

const copyIcon = async (icon: string) => {
  if (!icon) return

  try {
    await navigator.clipboard.writeText(icon)
  } catch (error) {
    console.warn('Failed to copy icon data', error)
  }
}

const updateIconFromInput = (key: string, target: { icon: string }, value: string) => {
  if (uploadedIconNames[key] && value === uploadedIconNames[key]) {
    return
  }

  target.icon = value

  if (!isDataImage(value)) {
    delete uploadedIconNames[key]
  }
}

const addIconReflect = () => {
  if (!newIconReflect.name || !newIconReflect.icon) return
  dialogVisible.value = true
  iconReflectList.value.push({ ...newIconReflect, uuid: uuid() })
  delete uploadedIconNames[NEW_ICON_DRAG_KEY]
  newIconReflect.name = ''
  newIconReflect.icon = ''
}

const removeIconReflect = (uuid: string) => {
  const index = iconReflectList.value.findIndex((item) => item.uuid === uuid)
  iconReflectList.value.splice(index, 1)
}

onMounted(() => {
  if (availableGroupNames.value.length) return

  fetchProxies().catch((error) => {
    console.warn('Failed to load proxy groups for icon settings', error)
  })
})
</script>
