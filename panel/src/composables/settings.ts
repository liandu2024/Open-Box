import { fetchIsUIUpdateAvailable, upgradeUIAPI } from '@/api'
import { autoUpgrade, hiddenSettingsItems } from '@/store/settings'
import type { MaybeRef } from 'vue'
import { computed, ref, unref } from 'vue'

const isUIUpdateAvailable = ref(false)

/**
 * Returns true when the setting item with the given key is visible.
 * Use inside computed() for reactivity. For templates, use useIsSettingVisible(key) instead.
 */
export function isSettingVisible(key: string): boolean {
  return !hiddenSettingsItems.value[key]
}

/**
 * Returns a computed that is true when the setting item with the given key is visible.
 * Use in templates for reactive visibility checks.
 */
export function useIsSettingVisible(key: MaybeRef<string>) {
  return computed(() => !hiddenSettingsItems.value[unref(key)])
}

/**
 * Returns a computed that is true when at least one of the given setting keys is visible.
 * Use for "has any visible item" in a settings section.
 */
export function useHasAnyVisibleSetting(keys: MaybeRef<string[]>) {
  return computed(() => unref(keys).some((k) => !hiddenSettingsItems.value[k]))
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
