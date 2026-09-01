import { ROUTE_NAME, SETTINGS_TAB } from '@/constant'
import { renderRoutes } from '@/helper'
import { i18n } from '@/i18n'
import {
  serverAccessPasswordEnabled,
  serverAuthenticated,
  serverAuthInitialized,
  serverPasswordSet,
} from '@/store/auth'
import { language } from '@/store/settings'
import ConnectionsPage from '@/views/ConnectionsPage.vue'
import HomePage from '@/views/HomePage.vue'
import LoginPage from '@/views/LoginPage.vue'
import LogsPage from '@/views/LogsPage.vue'
import OverviewPage from '@/views/OverviewPage.vue'
import ProxiesPage from '@/views/ProxiesPage.vue'
import RulesPage from '@/views/RulesPage.vue'
import SettingsPage from '@/views/SettingsPage.vue'
import SetupPasswordPage from '@/views/SetupPasswordPage.vue'
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
  // 订阅/分流/内核已并入「设置」页的一级页签。这里保留三条重定向而不是直接删掉:
  // 老书签、以及升级前存在 localStorage 里的"上次所在页面",都还会指过来,落到
  // 404 或空白比多三行路由糟得多。它们不带 name——带了就会重新出现在 renderRoutes
  // 里(那个列表是遍历 ROUTE_NAME 枚举生成的),侧边栏又会把它们冒出来。
  {
    path: 'subscriptions',
    redirect: { name: ROUTE_NAME.settings, query: { tab: SETTINGS_TAB.subscriptions } },
  },
  {
    path: 'routing',
    redirect: { name: ROUTE_NAME.settings, query: { tab: SETTINGS_TAB.routing } },
  },
  {
    path: 'kernel',
    redirect: { name: ROUTE_NAME.settings, query: { tab: SETTINGS_TAB.kernel } },
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
      path: '/login',
      name: ROUTE_NAME.login,
      component: LoginPage,
    },
    {
      path: '/setup',
      name: ROUTE_NAME.setup,
      component: SetupPasswordPage,
    },
    {
      path: '/:catchAll(.*)',
      redirect: () => ({ name: getLastRouteName() }),
    },
  ],
})

const title = useTitle('Open-Box')
const setTitleByName = (name: string | symbol | undefined) => {
  if (typeof name === 'string') {
    title.value = `Open-Box | ${i18n.global.t(name)}`
  } else {
    title.value = 'Open-Box'
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

  // No access password configured yet: every route (other than setup itself)
  // is forced into the setup flow, regardless of what was requested. This
  // takes priority over the login check below — until a password exists,
  // there is nothing to log in with.
  if (serverAuthInitialized.value && !serverPasswordSet.value && to.name !== ROUTE_NAME.setup) {
    return {
      name: ROUTE_NAME.setup,
      query: {
        redirect: to.fullPath,
      },
    }
  }

  if (to.name === ROUTE_NAME.setup && serverAuthInitialized.value && serverPasswordSet.value) {
    return {
      name: getLastRouteName(),
    }
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
      name: getLastRouteName(),
    }
  }
})

router.afterEach((to) => {
  if (typeof to.name === 'string' && to.name !== ROUTE_NAME.login && to.name !== ROUTE_NAME.setup) {
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
