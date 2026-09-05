import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import { execSync } from 'child_process'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { version } from './package.json'

const devProxyPort = Number.parseInt(
  process.env.ZASHBOARD_DEV_PROXY_PORT || process.env.PORT || '2026',
  10,
)
const resolvedDevProxyPort = Number.isFinite(devProxyPort) ? devProxyPort : 2026

const getGitCommitId = (): string => {
  try {
    const commitMessage = execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim()

    if (commitMessage.includes('chore(main): release')) {
      return ''
    }

    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch (error) {
    console.warn('无法获取git commit ID:', error)
    return ''
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __COMMIT_ID__: JSON.stringify(getGitCommitId()),
  },
  base: './',
  build: {
    // 国旗/通用图标默认会被当成小资源内联成 data URI,150 多个全塞进主 chunk 就是白白
    // 多背 400KB——而一次界面上只会显示到其中几个。让这两个目录下的文件一律走独立文件,
    // 浏览器按需去取;其余资源保持 Vite 的默认阈值不变。
    // globes/ 也不能内联:内联出来是 data:image/svg+xml,%3csvg…(URL 编码),而代理页的
    // ProxyIcon 把这个前缀当成"后面是原始 svg 标记"直接 v-html,页面上就成了一串乱码。
    assetsInlineLimit: (filePath: string) =>
      filePath.includes('/assets/flags/') || filePath.includes('/assets/misc/') || filePath.includes('/assets/globes/')
        ? false
        : undefined,
  },
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${resolvedDevProxyPort}`,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    vue(),
    vueJsx(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon-dark.svg'],
      manifest: {
        name: 'Open-Box',
        short_name: 'Open-Box',
        description: 'Open-Box - integrated sing-box management for OpenWrt',
        // 装成 PWA 时状态栏的兜底色;真正生效的是 App.vue 里按主题动态写的 <meta theme-color>
        theme_color: '#FFFFFF',
        background_color: '#FFFFFF',
        icons: [
          {
            src: './pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: './pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: './pwa-maskable-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: './pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
