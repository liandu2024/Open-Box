import express from 'express'

// 延迟历史(每个节点最近 10 次测速结果,服务端记、所有浏览器共享;见 system/latency-history.mjs)
//   GET  /latency-history           整份
//   POST /latency-history/samples   面板手动测出来的超时:内核那边超时只是把记录删掉,面板自己知道
//                                   是超时,直接报上来(成功的结果内核有记录,sync 就能看到)
//   POST /latency-history/sync      让服务端立刻读一次 /proxies 把变化记下来,然后返回整份——
//                                   面板手动测完后调,不用等下一个 tick
export const registerLatencyHistoryRoutes = (app, { history, scheduler } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '256kb' }))

  router.get('/latency-history', (_req, res) => {
    res.json({ history: history.get(), updatedAt: history.updatedAt() })
  })

  // 只回最近一次写入的时刻:前端每 15 秒轮询它,变了才拉整份
  router.get('/latency-history/version', (_req, res) => {
    res.json({ updatedAt: history.updatedAt() })
  })

  router.post('/latency-history/samples', (req, res) => {
    const list = req.body && Array.isArray(req.body.samples) ? req.body.samples : null
    if (!list) return res.status(400).json({ message: 'samples must be an array' })
    if (list.length > 500) return res.status(400).json({ message: 'too many samples' })
    for (const s of list) {
      if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !s.name || typeof s.time !== 'string' || !Number.isFinite(Date.parse(s.time)) || typeof s.delay !== 'number' || !Number.isFinite(s.delay) || s.delay < 0 || (s.node !== undefined && typeof s.node !== 'string')) {
        return res.status(400).json({ message: 'samples[] must be { name, time (ISO), delay >= 0, node? }' })
      }
    }
    history.recordSamples(list)
    res.json({ ok: true, history: history.get() })
  })

  router.post('/latency-history/sync', async (_req, res) => {
    if (scheduler) await scheduler.sync()
    res.json({ history: history.get() })
  })

  app.use('/api/openbox', router)
}
