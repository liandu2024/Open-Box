import { ROUTE_NAME } from '@/constant'
import { renderRoutes } from '@/helper'
import { i18n } from '@/i18n'
import {
  serverAccessPasswordEnabled,
  serverAuthenticated,
  serverAuthInitialized,
} from '@/store/auth'
import { language } from '@/store/settings'
import { activeBackend } from '@/store/setup'
import ConnectionsPage from '@/views/ConnectionsPage.vue'
import HomePage from '@/views/HomePage.vue'
import LoginPage from '@/views/LoginPage.vue'
import LogsPage from '@/views/LogsPage.vue'
import OverviewPage from '@/views/OverviewPage.vue'
import ProxiesPage from '@/views/ProxiesPage.vue'
import RulesPage from '@/views/RulesPage.vue'
import SettingsPage from '@/views/SettingsPage.vue'
import SetupPage from '@/views/SetupPage.vue'
import { useTitle } from '@vueuse/core'
import { watch } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'

const LAST_ROUTE_NAME_KEY = 'cache/last-route-name'

const getLastRouteName = () => {
  const lastRouteName = window.localStorage.getItem(LAST_ROUTE_NAME_KEY)

  if (lastRouteName && renderRoutes.value.includes(lastRouteName as ROUTE_NAME)) {
    return lastRouteName as ROUTE_NAME
  }

  return ROUTE_NAME.proxies
}

const childrenRouter = [
  {
    path: 'proxies',
    name: ROUTE_NAME.proxies,
    component: ProxiesPage,
  },
  {
    path: 'overview',
    name: ROUTE_NAME.overview,
    component: OverviewPage,
  },
  {
    path: 'connections',
    name: ROUTE_NAME.connections,
    component: ConnectionsPage,
  },
  {
    path: 'logs',
    name: ROUTE_NAME.logs,
    component: LogsPage,
  },
  {
    path: 'rules',
    name: ROUTE_NAME.rules,
    component: RulesPage,
  },
  {
    path: 'settings',
    name: ROUTE_NAME.settings,
    component: SettingsPage,
  },
]

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: () => ({ name: getLastRouteName() }),
      component: HomePage,
      children: childrenRouter,
    },
    {
      path: '/setup',
      name: ROUTE_NAME.setup,
      component: SetupPage,
    },
    {
      path: '/login',
      name: ROUTE_NAME.login,
      component: LoginPage,
    },
    {
      path: '/:catchAll(.*)',
      redirect: () => ({ name: getLastRouteName() }),
    },
  ],
})

const title = useTitle('AnGe-ClashBoard')
const setTitleByName = (name: string | symbol | undefined) => {
  if (typeof name === 'string' && activeBackend.value) {
    title.value = `AnGe-ClashBoard | ${i18n.global.t(name)}`
  } else {
    title.value = 'AnGe-ClashBoard'
  }
}

router.beforeEach((to, from) => {
  const toIndex = renderRoutes.value.findIndex((item) => item === to.name)
  const fromIndex = renderRoutes.value.findIndex((item) => item === from.name)

  if (toIndex === 0 && fromIndex === renderRoutes.value.length - 1) {
    to.meta.transition = 'slide-left'
  } else if (toIndex === renderRoutes.value.length - 1 && fromIndex === 0) {
    to.meta.transition = 'slide-right'
  } else if (toIndex !== fromIndex) {
    to.meta.transition = toIndex < fromIndex ? 'slide-right' : 'slide-left'
  }

  if (
    serverAuthInitialized.value &&
    serverAccessPasswordEnabled.value &&
    !serverAuthenticated.value &&
    to.name !== ROUTE_NAME.login
  ) {
    return {
      name: ROUTE_NAME.login,
      query: {
        redirect: to.fullPath,
      },
    }
  }

  if (
    to.name === ROUTE_NAME.login &&
    (!serverAccessPasswordEnabled.value || serverAuthenticated.value)
  ) {
    return {
      name: activeBackend.value ? getLastRouteName() : ROUTE_NAME.setup,
    }
  }

  if (!activeBackend.value && ![ROUTE_NAME.setup, ROUTE_NAME.login].includes(to.name as ROUTE_NAME)) {
    return { name: ROUTE_NAME.setup }
  }
})

router.afterEach((to) => {
  if (
    typeof to.name === 'string' &&
    ![ROUTE_NAME.setup, ROUTE_NAME.login].includes(to.name as ROUTE_NAME)
  ) {
    window.localStorage.setItem(LAST_ROUTE_NAME_KEY, to.name)
  }

  setTitleByName(to.name)
})

watch(language, () => {
  setTimeout(() => {
    setTitleByName(router.currentRoute.value.name)
  })
})

export default router
