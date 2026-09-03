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
  // 手机端顶部工具栏和底部导航都是悬浮的:内容要垫到它们外面,再各留一段和全局间距
  // 一致的 8px 安全边距,不然第一张 / 最后一张卡片贴着条
  const MOBILE_SAFE_GAP = 8
  const paddingTop = computed(() => {
    if (isMiddleScreen.value) {
      return ctrlsBottom.value + offsetTop + MOBILE_SAFE_GAP
    }
    return 0
  })
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
