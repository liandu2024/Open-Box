import express from 'express'
import { normalizeGroups, emitUserGroups, GROUP_TYPES } from '../engine/user-groups.mjs'

// 用户自定义节点组的读写。整份列表一次性存取(PUT 全量覆盖),不做逐条 CRUD:
// 组之间可以互相引用,逐条改会让"中间状态"出现悬空引用或环,而整份写入天然是原子的。
export const registerGroupRoutes = (app, { store } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '1mb' }))

  // 列表 + 可选成员清单(节点与其它组),供前端的成员选择器直接用,免得它自己再去
  // 拼一次"节点从哪来、组从哪来"。
  router.get('/groups', (_req, res) => {
    const groups = store.getGroups()
    const nodes = store.getNodes()
    // 每个节点带上它来自哪条订阅:成员选择器要按订阅筛选。用 subscriptionId 查名字,
    // 而不是从节点名里猜——节点名前缀是可选的,关掉前缀就什么都猜不出来了。
    const subscriptionName = new Map(store.getSubscriptions().map((s) => [s.id, s.name]))
    res.json({
      groups,
      types: [...GROUP_TYPES],
      availableNodes: nodes.map((n) => ({
        name: n.tag,
        subscription: subscriptionName.get(n.subscriptionId) || '',
      })),
      availableGroups: groups.map((g) => g.name),
    })
  })

  router.put('/groups', (req, res) => {
    const body = req.body || {}
    if (!Array.isArray(body.groups)) {
      res.status(400).json({ error: 'groups must be an array' })
      return
    }
    const normalized = normalizeGroups(body.groups)

    // 组名即 sing-box 的出站 tag,重名会让配置里出现两个同名出站(内核行为未定义),
    // 所以在写入前就拦住,而不是等部署时才炸。
    const seen = new Set()
    for (const g of normalized) {
      if (seen.has(g.name)) {
        res.status(400).json({ error: `分组名称重复:${g.name}` })
        return
      }
      seen.add(g.name)
    }

    store.setGroups(normalized)

    // 把这份定义按当前节点跑一遍,如实告诉调用方哪些组落地不了(成员为空/成环)。
    // 保存本身仍然成功——用户可能只是还没来得及挑成员。
    const { dropped } = emitUserGroups(normalized, store.getNodes())
    res.json({ ok: true, groups: store.getGroups(), dropped })
  })

  app.use('/api/openbox', router)
}
