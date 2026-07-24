import { renderRoutes } from '@/helper'
import { activeBackend } from '@/store/setup'
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

export const useKeyboard = () => {
  const router = useRouter()

  const routeShortcuts = computed(() => {
    return renderRoutes.value.map((route, index) => ({
      key: (index + 1).toString(),
      route,
    }))
  })

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return
    }

    if (!activeBackend.value || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return
    }

    const key = event.key
    const route = routeShortcuts.value.find((s) => s.key === key)
    if (route) {
      event.preventDefault()
      router.push({ name: route.route })
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
  })

  return {
    routeShortcuts,
  }
}
