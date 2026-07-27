import 'tippy.js/animations/scale.css'
import 'tippy.js/dist/tippy.css'
import './assets/main.css'
import './assets/theme.css'
import { initializePersistentStorage } from './helper/persistentStorage'
import { initializeServerAuthState } from './store/auth'
import { initializeWizardGateState } from './store/wizard'

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
  // Both only read config/openbox state (no UI depends on them yet), so they can run
  // concurrently rather than adding another serial round trip to bootstrap.
  await Promise.all([initializePersistentStorage(), initializeWizardGateState()])
  await import('@/helper/dayjs')

  const [{ createApp }, { default: App }, { loadFonts }, { i18n }, router] = await Promise.all([
    import('vue'),
    import('./App.vue'),
    import('./assets/load-fonts'),
    import('./i18n'),
    import('./router'),
  ])

  loadFonts()

  const app = createApp(App)

  app.use(router.default)
  app.use(i18n)
  app.mount('#app')
}

void bootstrap()
