// 共享网络的订阅接口:GET /api/openbox/share/:id/:token
// 免登录(index.mjs 的守卫按前缀放行),靠 token 保护;返回主流客户端都认的
// base64 订阅内容(一行一个节点链接)。?raw=1 直接给明文链接。
import express from 'express'
import { buildShareLink, shareTokenMatches } from '../engine/share-link.mjs'

export const registerShareRoutes = (app, { store }) => {
  const router = express.Router()

  router.get('/share/:id/:token', (req, res) => {
    const { id, token } = req.params
    const servers = Array.isArray(store.getProfile().servers) ? store.getProfile().servers : []
    const server = servers.find((s) => s && s.id === id)
    if (!server || !shareTokenMatches(store.getClashSecret(), server, token)) {
      res.status(404).type('text/plain').send('not found')
      return
    }
    const link = buildShareLink(server)
    if (!link) {
      res.status(409).type('text/plain').send('server has no address')
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    res.type('text/plain')
    res.send(req.query.raw ? `${link}\n` : Buffer.from(`${link}\n`, 'utf8').toString('base64'))
  })

  app.use('/api/openbox', router)
}
