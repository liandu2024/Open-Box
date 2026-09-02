// 挂在触发元素旁边、但渲染在弹层外面的下拉面板。
//
// 起因:daisyUI 的 dropdown 是绝对定位的兄弟节点,放在弹窗里会被 modal-box 的
// overflow-hidden 和内容区的 overflow-y-auto 裁掉——面板一长就只剩露在弹窗里的那截
// (真机上就是这个样子:搜索框看得见,列表被切掉)。
//
// 所以面板 Teleport 到 #app-content,用 fixed 定位对齐触发元素;开合自己管
// (focus-within 那套跨不过 Teleport,teleport 出去的节点不是触发元素的后代)。
import { onBeforeUnmount, ref, type Ref } from 'vue'

export interface AnchoredDropdown {
  open: Ref<boolean>
  triggerRef: Ref<HTMLElement | null>
  panelRef: Ref<HTMLElement | null>
  style: Ref<Record<string, string>>
  toggle: () => void
  close: () => void
}

export const useAnchoredDropdown = (
  options: { minWidth?: number; maxHeight?: number } = {},
): AnchoredDropdown => {
  const minWidth = options.minWidth ?? 288
  const maxHeight = options.maxHeight ?? 320

  const open = ref(false)
  const triggerRef = ref<HTMLElement | null>(null)
  const panelRef = ref<HTMLElement | null>(null)
  const style = ref<Record<string, string>>({})

  // 位置在每次开合、滚动、改窗口大小时重算:触发元素本身可能跟着页面滚走了。
  const place = () => {
    const el = triggerRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = Math.max(rect.width, minWidth)
    const gapBelow = window.innerHeight - rect.bottom - 8
    const gapAbove = rect.top - 8
    // 下面放不下、上面更宽敞时翻上去——总比给一个 100px 高的列表强
    const above = gapBelow < 200 && gapAbove > gapBelow
    const height = Math.max(160, Math.min(maxHeight, above ? gapAbove : gapBelow))
    style.value = {
      position: 'fixed',
      left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
      width: `${width}px`,
      maxHeight: `${height}px`,
      ...(above
        ? { bottom: `${window.innerHeight - rect.top + 4}px` }
        : { top: `${rect.bottom + 4}px` }),
    }
  }

  const onDocumentDown = (event: MouseEvent) => {
    const target = event.target as Node | null
    if (!target) return
    if (triggerRef.value?.contains(target) || panelRef.value?.contains(target)) return
    close()
  }
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
  }

  function close() {
    if (!open.value) return
    open.value = false
    document.removeEventListener('mousedown', onDocumentDown, true)
    document.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('resize', place, true)
    window.removeEventListener('scroll', place, true)
  }

  const toggle = () => {
    if (open.value) {
      close()
      return
    }
    place()
    open.value = true
    document.addEventListener('mousedown', onDocumentDown, true)
    document.addEventListener('keydown', onKeydown, true)
    // 捕获阶段:滚动的是弹窗内部那个容器,事件不会冒泡到 window
    window.addEventListener('resize', place, true)
    window.addEventListener('scroll', place, true)
  }

  onBeforeUnmount(close)

  return { open, triggerRef, panelRef, style, toggle, close }
}
