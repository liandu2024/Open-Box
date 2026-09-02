import { fetchIsUIUpdateAvailable, upgradeUIAPI } from '@/api'
import { autoUpgrade } from '@/store/settings'
import type { MaybeRef } from 'vue'
import { computed, ref } from 'vue'

const isUIUpdateAvailable = ref(false)

// 「设置项显示控制」(隐藏/排序某些设置项)已经退役:所有面板设置一律显示。
// 三个判断函数保留签名,方便各卡片继续调用,但永远返回可见——浏览器里残留的
// config/hidden-settings-items 也就不再起作用。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isSettingVisible(_key: string): boolean {
  return true
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useIsSettingVisible(_key: MaybeRef<string>) {
  return computed(() => true)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useHasAnyVisibleSetting(_keys: MaybeRef<string[]>) {
  return computed(() => true)
}

export const useSettings = () => {
  const checkUIUpdate = async () => {
    isUIUpdateAvailable.value = await fetchIsUIUpdateAvailable()
    if (isUIUpdateAvailable.value && autoUpgrade.value) {
      upgradeUIAPI()
    }
  }

  return {
    isUIUpdateAvailable,
    checkUIUpdate,
  }
}
