// 全局统一的「复制到剪贴板」:面板多半是 http://路由器IP 打开的,这种非安全上下文里
// navigator.clipboard 根本不存在(或调用即拒绝)。先试它,不行就退回老办法:塞一个
// 看不见的输入框选中再 execCommand('copy')。返回是否成功,提示交给调用方。
export const copyText = async (text: string): Promise<boolean> => {
  if (!text) return false
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 落到下面的兜底
    }
  }
  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', 'readonly')
  textArea.style.position = 'fixed'
  textArea.style.top = '0'
  textArea.style.left = '0'
  textArea.style.opacity = '0'
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  textArea.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.body.removeChild(textArea)
  }
  return ok
}
