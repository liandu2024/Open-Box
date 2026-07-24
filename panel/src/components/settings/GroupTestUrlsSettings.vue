<template>
  <div class="mb-2 flex items-center gap-2">
    {{ $t('groupTestUrls') }}
    <template v-if="groupTestUrls.length"> ({{ groupTestUrls.length }}) </template>
    <button
      v-if="groupTestUrls.length"
      class="btn btn-sm btn-circle"
      @click="dialogVisible = !dialogVisible"
    >
      <ChevronUpIcon
        v-if="dialogVisible"
        class="h-4 w-4"
      />
      <ChevronDownIcon
        v-else
        class="h-4 w-4"
      />
    </button>
    <QuestionMarkCircleIcon
      class="h-4 w-4"
      @mouseenter="groupTestUrlsTip"
    />
  </div>
  <div
    class="transparent-collapse collapse rounded-none shadow-none"
    :class="dialogVisible ? 'collapse-open' : ''"
  >
    <div class="collapse-content p-0">
      <div class="grid grid-cols-1 gap-2">
        <template v-if="dialogVisible">
          <div
            v-for="groupTestUrl in groupTestUrls"
            :key="groupTestUrl.uuid"
            class="flex items-center gap-2"
          >
            <TextInput
              class="w-32"
              v-model="groupTestUrl.name"
              :clearable="true"
              :placeholder="$t('groupName')"
            />
            <ArrowRightCircleIcon class="h-4 w-4 shrink-0" />
            <TextInput
              class="max-w-96 flex-1"
              v-model="groupTestUrl.url"
              :clearable="true"
              :placeholder="$t('speedtestUrl')"
            />
            <button
              class="btn btn-sm btn-circle"
              @click="removeGroupTestUrl(groupTestUrl.uuid)"
            >
              <TrashIcon class="h-4 w-4 shrink-0" />
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
  <div class="flex items-center gap-2">
    <TextInput
      class="w-32"
      v-model="newGroupTestUrl.name"
      :placeholder="$t('groupName')"
      :menus="proxyGroupList.filter((group) => !groupTestUrls.some((item) => item.name === group))"
      @keydown.enter="addGroupTestUrl"
    />
    <ArrowRightCircleIcon class="h-4 w-4 shrink-0" />
    <TextInput
      class="max-w-96 flex-1"
      v-model="newGroupTestUrl.url"
      :clearable="true"
      :placeholder="$t('speedtestUrl')"
      @keydown.enter="addGroupTestUrl"
    />
    <button
      class="btn btn-sm btn-circle"
      @click="addGroupTestUrl"
    >
      <PlusIcon class="h-4 w-4 shrink-0" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { useTooltip } from '@/helper/tooltip'
import { proxyGroupList } from '@/store/proxies'
import { groupTestUrls } from '@/store/settings'
import {
  ArrowRightCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  QuestionMarkCircleIcon,
  TrashIcon,
} from '@heroicons/vue/24/outline'
import { useSessionStorage } from '@vueuse/core'
import { v4 as uuid } from 'uuid'
import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import TextInput from '../common/TextInput.vue'

const { showTip } = useTooltip()
const { t } = useI18n()

const dialogVisible = useSessionStorage('cache/group-test-urls-dialog-visible', false)
const newGroupTestUrl = reactive({
  name: '',
  url: '',
})

const groupTestUrlsTip = (e: Event) => {
  return showTip(e, t('groupTestUrlsTip'))
}

const addGroupTestUrl = () => {
  if (!newGroupTestUrl.name || !newGroupTestUrl.url) return
  dialogVisible.value = true
  groupTestUrls.value.push({ ...newGroupTestUrl, uuid: uuid() })
  newGroupTestUrl.name = ''
  newGroupTestUrl.url = ''
}

const removeGroupTestUrl = (uuid: string) => {
  groupTestUrls.value = groupTestUrls.value.filter((item) => item.uuid !== uuid)
}
</script>
