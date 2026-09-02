import express from 'express'
import { buildCurrentConfig, runDeploy, STATUS_BY_STAGE } from './deploy-runner.mjs'
import { rollbackToDirect } from '../system/deploy.mjs'
import { disableService } from '../system/service.mjs'

export const registerDeployRoutes = (app, { store, ctx, paths } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '1mb' }))

  // 预览:仅组装并返回,不落盘、不触碰系统。
  router.get('/config/preview', (_req, res) => {
    const { config } = buildCurrentConfig(store)
    res.json({ config })
  })

  // 生成并应用配置。界面上没有单独的「部署」按钮了——启动/重启内核会走同一条路径
  // (见 api/service.mjs);这个端点保留给命令行和外部脚本单独触发用。
  router.post('/deploy', async (_req, res) => {
    const result = await runDeploy({ store, ctx, paths })
    const status = result.ok ? 200 : (STATUS_BY_STAGE[result.stage] || 500)
    res.status(status).json(result)
  })

  // 最近一次应用结果(供面板轮询/展示)。
  router.get('/deploy/state', (_req, res) => {
    res.json({ state: store.getDeployState() })
  })

  // 手动回滚到直连:与部署内部触发的回滚一样,也要 disable 开机自启,
  // 否则重启设备后 procd 会重新拉起一个已被撤销接管的内核。
  // rollbackToDirect 内部每一步都已经是"尽力而为"(各自 try/catch),实际上只有
  // disableService 还可能抛错——handler 级 try/catch 兜底,避免一次开机自启命令失败
  // 就让整个请求变成带调用栈的默认 HTML 错误页。
  router.post('/rollback', async (_req, res) => {
    try {
      const result = await rollbackToDirect(ctx, paths)
      await disableService(ctx, paths.initd.core)
      res.json({ ok: result.ok, actions: result.actions })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ ok: false, message })
    }
  })

  app.use('/api/openbox', router)
}
