import tippy, { type Instance, type Props } from 'tippy.js'

let appContent: HTMLElement
let tippyInstance: Instance | null = null
let currentTarget: HTMLElement | null = null

export const useTooltip = () => {
  if (!appContent) {
    appContent = document.getElementById('app-content')!
  }

  const showTip = (event: Event, content: string | HTMLElement, config: Partial<Props> = {}) => {
    if (currentTarget === event.currentTarget) {
      return
    }

    tippyInstance?.destroy()
    tippyInstance = tippy(event.currentTarget as HTMLElement, {
      content,
      placement: 'top',
      animation: 'scale',
      appendTo: appContent,
      allowHTML: true,
      showOnCreate: true,
      onHidden: () => {
        tippyInstance?.destroy()
        tippyInstance = null
        currentTarget = null
      },
      popperOptions: {
        modifiers: [
          {
            name: 'preventOverflow',
            options: {
              boundary: 'clippingParents',
              padding: 8,
            },
          },
          {
            name: 'flip',
            options: {
              fallbackPlacements: ['top', 'bottom', 'right', 'left'],
            },
          },
        ],
      },
      ...config,
    })

    currentTarget = event.currentTarget as HTMLElement
  }

  const hideTip = () => {
    tippyInstance?.hide()
  }

  const updateTip = (content: string | HTMLElement) => {
    tippyInstance?.setContent(content)
  }

  return {
    showTip,
    hideTip,
    updateTip,
  }
}

const { showTip } = useTooltip()

export const checkTruncation = (e: Event) => {
  const target = e.target as HTMLElement
  const { scrollWidth, clientWidth } = target

  if (scrollWidth > clientWidth) {
    showTip(e, target.innerText, {
      delay: [700, 0],
      trigger: 'mouseenter',
      touch: ['hold', 500],
    })
  }
}
