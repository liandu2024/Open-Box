import { ref } from 'vue'

export const isWindowResizing = ref(false)

let initialized = false
let resizeTimer: number | undefined

const handleWindowResize = () => {
  isWindowResizing.value = true

  if (resizeTimer) {
    window.clearTimeout(resizeTimer)
  }

  resizeTimer = window.setTimeout(() => {
    isWindowResizing.value = false
    resizeTimer = undefined
  }, 220)
}

export const initializeWindowResizeState = () => {
  if (initialized) {
    return () => undefined
  }

  initialized = true
  window.addEventListener('resize', handleWindowResize, { passive: true })

  return () => {
    window.removeEventListener('resize', handleWindowResize)

    if (resizeTimer) {
      window.clearTimeout(resizeTimer)
      resizeTimer = undefined
    }

    initialized = false
    isWindowResizing.value = false
  }
}
