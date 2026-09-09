<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4">
      <div>
        <h2 class="text-base font-semibold">{{ $t('testUrlTitle') }}</h2>
        <p class="text-base-content/60 text-xs">{{ $t('testUrlDescription') }}</p>
      </div>

      <div class="flex flex-col gap-3 sm:flex-row">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('testUrlLabel') }}</label>
          <input
            v-model="testUrl"
            type="url"
            class="input input-sm w-full font-mono text-xs"
            :placeholder="TEST_URL"
            @change="save('testUrl', testUrl)"
          />
          <p class="text-base-content/50 text-xs">{{ $t('testUrlHint') }}</p>
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('directTestUrl') }}</label>
          <input
            v-model="directUrl"
            type="url"
            class="input input-sm w-full font-mono text-xs"
            :placeholder="DIRECT_TEST_URL"
            @change="save('directTestUrl', directUrl)"
          />
          <p class="text-base-content/50 text-xs">{{ $t('directTestUrlHint') }}</p>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { showNotification } from '@/helper/notification'
import type { OpenboxProfile } from '@/api/openbox'
import { DIRECT_TEST_URL, TEST_URL } from '@/constant'
import { kernelTestUrl } from '@/helper/testUrl'
import { directTestUrl, speedtestUrl } from '@/store/settings'
import { ref, watch } from 'vue'

const props = defineProps<{
  profile: OpenboxProfile
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const testUrl = ref(props.profile.testUrl || '')
const directUrl = ref(props.profile.directTestUrl || '')
watch(
  () => props.profile,
  (p) => {
    testUrl.value = p.testUrl || ''
    directUrl.value = p.directTestUrl || ''
  },
)

// 空就回落到默认;http:// 升成 https://(内核的延迟测试不认 http,见 helper/testUrl.ts);存进档案的同时
// 更新面板那份,延迟测试立刻按新地址走,不用刷新
const save = async (key: 'testUrl' | 'directTestUrl', raw: string) => {
  const value = kernelTestUrl(raw) || (key === 'testUrl' ? TEST_URL : DIRECT_TEST_URL)
  try {
    await props.patchProfile({ [key]: value })
    if (key === 'testUrl') { speedtestUrl.value = value; testUrl.value = value }
    else { directTestUrl.value = value; directUrl.value = value }
  } catch (err) {
    showNotification({ content: 'routingSaveFailed', params: { message: err instanceof Error ? err.message : String(err) }, type: 'alert-error' })
  }
}
</script>
