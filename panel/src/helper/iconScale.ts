import { proxyGroupIconSize } from '@/store/settings'

// 图标缩放的像素偏移(policies[].iconScale 这些)是按代理页卡片标题那个大图标定义的:
// +1 就是大图标加大 1px。其他地方的小图标(16 / 18 / 20px)按同一个比例等比缩放,
// 不能把像素偏移直接加在小图标上——16px 的图加 8px 是 1.5 倍,早就失真了。
// 大图标的尺寸和 ProxyGroup.vue 的 titleIconSize 一致:max(策略图标大小设置, 46)
export const ICON_SCALE_MIN_REFERENCE = 46
export const iconScaleReference = () => Math.max(proxyGroupIconSize.value, ICON_SCALE_MIN_REFERENCE)
export const iconScaleFactor = (scale?: number) => {
  const ref = iconScaleReference()
  const delta = scale || 0
  return ref > 0 && delta ? (ref + delta) / ref : 1
}
