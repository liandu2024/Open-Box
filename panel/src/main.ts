import 'tippy.js/animations/scale.css'
import 'tippy.js/dist/tippy.css'
import './assets/main.css'
import './assets/theme.css'
import { initializePersistentStorage } from './helper/persistentStorage'
import { initializeServerAuthState } from './store/auth'

const cleanupLegacyServiceWorkers = async () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()

    await Promise.allSettled(registrations.map((registration) => registration.unregister()))

    if ('caches' in window) {
      const cacheKeys = await caches.keys()
      await Promise.allSettled(cacheKeys.map((cacheKey) => caches.delete(cacheKey)))
    }
  } catch {
    // Ignore cleanup failures and continue bootstrapping the app.
  }
}

const bootstrap = async () => {
  await cleanupLegacyServiceWorkers()
  await initializeServerAuthState()
  await initializePersistentStorage()
  await import('@/helper/dayjs')

  const [{ createApp }, { default: App }, { loadFonts }, { applyCustomThemes }, { i18n }, router] =
    await Promise.all([
      import('vue'),
      import('./App.vue'),
      import('./assets/load-fonts'),
      import('./helper'),
      import('./i18n'),
      import('./router'),
    ])

  // 自定义主题是一段注入 <head> 的样式,启动时先挂上,data-theme 切过去才有东西
  applyCustomThemes()

  loadFonts()

  const app = createApp(App)

  app.use(router.default)
  app.use(i18n)
  app.mount('#app')
}

void bootstrap()
