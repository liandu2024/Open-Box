import { FALLBACK_TAG, normalizeRouting } from '../engine/routing-model.mjs'
import express from 'express'
import { normalizeGroups, emitUserGroups, GROUP_TYPES } from '../engine/user-groups.mjs'
import { DNSMASQ_OUTBOUND_TAG } from '../engine/config.mjs'

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
      // 内置的直连/拒绝不在候选里:它们不是可以当成员的组
      availableGroups: groups.filter((g) => !g.kind).map((g) => g.name),
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
    const routing = normalizeRouting(store.getProfile()?.routing)
    // 站点集(含停用的:一启用就撞)和 dnsmasq 回送出站也在同一个出站命名空间里
    const policyNames = new Set(routing.policies.map((p) => p.name))
    for (const g of normalized) {
      const fallbackName = routing.fallback.name
      if (g.name === FALLBACK_TAG || g.name === fallbackName) {
        res.status(400).json({ error: `「${g.name}」是兜底站点集占着的名字,分组不能叫这个` })
        return
      }
      if (policyNames.has(g.name) || g.name === DNSMASQ_OUTBOUND_TAG) {
        res.status(400).json({ error: `「${g.name}」已经是一个站点集的名字,分组不能和站点集同名` })
        return
      }
      if (seen.has(g.name)) {
        res.status(400).json({ error: `分组名称重复:${g.name}` })
        return
      }
      seen.add(g.name)
    }

    // 组之间、站点集的默认出口、终端分流都是按组名引用的,组名一改这些引用就悬空:
    // 以前只改当前这一条,引用它的组静默丢掉这个成员(空了就填直连占位),站点集的默认出口
    // 落到成员表第一项——保存返回 200、dropped 也是空的,用户完全不知道。
    // 现在按 id 认出改名,把所有引用一并原子迁移(整份 PUT 本来就是原子的)。
    const previous = new Map(store.getGroups().map((g) => [g.id, g]))
    const renames = new Map()
    for (const g of normalized) {
      const old = previous.get(g.id)
      if (old && old.name !== g.name) renames.set(old.name, g.name)
    }
    const rename = (name) => (renames.has(name) ? renames.get(name) : name)
    const migrated = renames.size
      ? normalized.map((g) => ({ ...g, members: g.members.map(rename) }))
      : normalized

    store.setGroups(migrated)

    if (renames.size) {
      const profile = store.getProfile() || {}
      const routing = profile.routing && typeof profile.routing === 'object' ? profile.routing : {}
      const patch = {}
      if (Array.isArray(routing.policies)) {
        patch.routing = { policies: routing.policies.map((p) => (p && typeof p === 'object' && renames.has(p.default) ? { ...p, default: rename(p.default) } : p)) }
      }
      if (renames.has(routing.fallbackDefault)) patch.routing = { ...(patch.routing || {}), fallbackDefault: rename(routing.fallbackDefault) }
      if (Array.isArray(profile.clientRoutes)) {
        patch.clientRoutes = profile.clientRoutes.map((r) => (r && typeof r === 'object' && renames.has(r.outbound) ? { ...r, outbound: rename(r.outbound) } : r))
      }
      if (Object.keys(patch).length) store.setProfile(patch)
    }

    // 把这份定义按当前节点跑一遍,如实告诉调用方哪些组落地不了(成员为空/成环)。
    // 保存本身仍然成功——用户可能只是还没来得及挑成员。
    const nodes = store.getNodes()
    const { dropped } = emitUserGroups(migrated, nodes)
    // 悬空引用(既不是节点也不是组的成员名)也要说出来:生成配置时它会被静默忽略,组没空
    // 的话连 dropped 都不会提到它
    const nodeTags = new Set(nodes.map((n) => n && n.tag).filter(Boolean))
    const groupNames = new Set(migrated.map((g) => g.name))
    const dangling = migrated
      .filter((g) => !g.kind && g.mode !== 'dynamic')
      .map((g) => ({ name: g.name, members: g.members.filter((m) => m !== g.name && !nodeTags.has(m) && !groupNames.has(m)) }))
      .filter((d) => d.members.length)
    res.json({ ok: true, groups: store.getGroups(), dropped, dangling, renamed: [...renames].map(([from, to]) => ({ from, to })) })
  })

  app.use('/api/openbox', router)
}
