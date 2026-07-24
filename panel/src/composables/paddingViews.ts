import { isMiddleScreen } from '@/helper/utils'
import { computed, ref } from 'vue'

export const ctrlsBottom = ref(0)
export const dockTop = ref(0)
export const usePaddingForViews = (
  config = {
    offsetTop: 8,
    offsetBottom: 8,
  },
) => {
  const { offsetTop, offsetBottom } = config
  const paddingTop = computed(() => {
    if (isMiddleScreen.value) {
      return ctrlsBottom.value + offsetTop
    }
    return 0
  })
  const paddingBottom = computed(() => {
    if (isMiddleScreen.value) {
      return dockTop.value + offsetBottom
    }
    return 0
  })

  const padding = computed(() => {
    if (isMiddleScreen.value) {
      return {
        paddingTop: `${paddingTop.value}px`,
        paddingBottom: `${paddingBottom.value}px`,
      }
    }
    return {}
  })

  return {
    padding,
    paddingTop,
    paddingBottom,
  }
}
