import express from 'express'

// 故障转移组的运行状态(system/failover-manager.mjs 维护;代理页展示当前主备页签、实际节点、最近切换)
//   GET  /failover/status   所有故障转移组的运行状态
//   POST /failover/refresh  让管理器下一 tick 立刻重载映射并重测(部署 / 保存分组后前端可调,不等 interval)
export const registerFailoverRoutes = (app, { manager } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.get('/failover/status', (_req, res) => {
    res.json(manager ? manager.status() : { version: null, paused: 'none', groups: [] })
  })
  router.post('/failover/refresh', (_req, res) => {
    if (manager) manager.refresh()
    res.json({ ok: true })
  })
  app.use('/api/openbox', router)
}
