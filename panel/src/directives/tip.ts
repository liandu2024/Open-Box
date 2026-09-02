import { useTooltip } from '@/helper/tooltip'
import type { Directive } from 'vue'

// v-tip="文字":鼠标悬停显示全局统一样式的提示(tippy),取代各处零散的 title=。
// 值为空时不显示。
const { showTip, hideTip } = useTooltip()
const KEY = '__tipText'
type TipEl = HTMLElement & { [KEY]?: string; __tipBound?: boolean }

const tip: Directive<TipEl, string | undefined> = {
  mounted(el, binding) {
    el[KEY] = binding.value
    if (el.__tipBound) return
    el.__tipBound = true
    el.addEventListener('mouseenter', (e) => {
      if (el[KEY]) showTip(e, el[KEY]!)
    })
    el.addEventListener('mouseleave', () => hideTip())
  },
  updated(el, binding) {
    el[KEY] = binding.value
  },
}

export default tip
