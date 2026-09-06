import express from 'express'
import { buildCurrentConfig, cancelPendingDeploys, runDeploy, runExclusive, STATUS_BY_STAGE } from './deploy-runner.mjs'
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
  // rollbackToDirect 内部每一步都是"尽力而为"(各自 try/catch)并把失败汇总在 failures 里,
  // 关自启的结果也并进去:任何一步没成,ok 就是 false,界面不能再说"已恢复直连"。
  // handler 级 try/catch 兜底 disableService 抛错的情况,避免整个请求变成带调用栈的默认 HTML 错误页。
  router.post('/rollback', async (_req, res) => {
    try {
      // 和停止一样:进部署队列、拿锁,并把正在跑 / 排队中的部署标成取消,免得回滚完又被旧部署顶掉
      cancelPendingDeploys()
      const { result, disabled } = await runExclusive(store, async () => ({
        result: await rollbackToDirect(ctx, paths),
        disabled: await disableService(ctx, paths.initd.core),
      }))
      const failures = [...result.failures]
      if (!disabled.ok) failures.push({ step: 'disable-autostart', message: String(disabled.stderr || disabled.stdout || '').trim() || `code ${disabled.code}` })
      res.json({ ok: result.ok && disabled.ok, actions: result.actions, failures })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ ok: false, message })
    }
  })

  app.use('/api/openbox', router)
}
