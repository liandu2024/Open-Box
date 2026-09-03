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
  // 手机端底部导航是悬浮的:内容要垫到它上面,再留一段和全局间距一致的 8px 安全边距,
  // 不然最后一张卡片贴着导航条
  const MOBILE_SAFE_GAP = 8
  const paddingBottom = computed(() => {
    if (isMiddleScreen.value) {
      return dockTop.value + offsetBottom + MOBILE_SAFE_GAP
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
