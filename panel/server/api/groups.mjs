import { FALLBACK_TAG, normalizeRouting } from '../engine/routing-model.mjs'
import express from 'express'
import { normalizeGroups, emitUserGroups, GROUP_TYPES, GROUP_MODES, FAILOVER_INTERNAL_PREFIX, FAILOVER_LIMITS, FAILOVER_MAX_LANES, isInternalTag } from '../engine/user-groups.mjs'
import { parseDuration } from '../engine/duration.mjs'
import { DNSMASQ_OUTBOUND_TAG } from '../engine/config.mjs'

const isStr = (v) => typeof v === 'string' && v.trim().length > 0
const numIn = (v, [lo, hi]) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= lo && n <= hi
}

// 故障转移组的写入校验。归一化(normalizeGroup)对老记录是宽容的——缺字段回默认;但新提交的定义
// 不能靠这份宽容蒙混过去:动态模式、页签 id 重复、成员引用了组 / 站点集 / 内置出站、参数越界、
// 时长写法不对,都要明确拒绝,而不是归一化成一个看起来能用的 selector。
// 返回错误文案;合法返回 ''。previous 是这条组上次保存的版本:订阅变化让旧引用失效是正常的
// (第 6 节),那些成员只要上次就在这个页签里就放行,只报告不拒绝;新加的成员必须是当前真实节点。
export const validateFailoverGroup = (raw, { nodeTags, otherNames, previous }) => {
  const name = isStr(raw?.name) ? raw.name.trim() : ''
  if (raw.mode !== undefined && raw.mode !== null && raw.mode !== 'static') {
    return `故障转移「${name}」只支持静态成员,mode 必须是 static`
  }
  if (!Array.isArray(raw.lanes)) return `故障转移「${name}」缺少主备页签(lanes)`
  if (raw.lanes.length > FAILOVER_MAX_LANES) return `故障转移「${name}」最多 ${FAILOVER_MAX_LANES} 个页签`
  const ids = new Set()
  const prevLaneMembers = new Map((previous?.lanes || []).map((l) => [l.id, new Set(l.members)]))
  for (let i = 0; i < raw.lanes.length; i++) {
    const lane = raw.lanes[i]
    if (!lane || typeof lane !== 'object') return `故障转移「${name}」第 ${i + 1} 个页签不是对象`
    if (lane.id !== undefined && lane.id !== null && !isStr(lane.id)) return `故障转移「${name}」第 ${i + 1} 个页签的 id 不合法`
    if (lane.icon !== undefined && lane.icon !== null && typeof lane.icon !== 'string') return `故障转移「${name}」第 ${i + 1} 个页签的图标不合法`
    const id = isStr(lane.id) ? lane.id.trim() : ''
    if (id) {
      if (ids.has(id)) return `故障转移「${name}」的页签 id 重复:${id}`
      ids.add(id)
    }
    if (lane.members !== undefined && !Array.isArray(lane.members)) return `故障转移「${name}」第 ${i + 1} 个页签的 members 必须是数组`
    for (const m of lane.members || []) {
      if (!isStr(m)) return `故障转移「${name}」第 ${i + 1} 个页签里有不合法的成员`
      const member = m.trim()
      if (nodeTags.has(member)) continue
      if (otherNames.has(member) || isInternalTag(member)) return `故障转移「${name}」的页签只能放真实节点,「${member}」不是节点`
      // 上次就在这个页签里的旧引用:订阅更新把节点删了,保留着给界面显示(不进配置)
      if (id && prevLaneMembers.get(id)?.has(member)) continue
      return `故障转移「${name}」的页签成员「${member}」不是当前订阅里的节点`
    }
  }
  if (raw.interval !== undefined && raw.interval !== null && raw.interval !== '') {
    if (!isStr(raw.interval) || !numIn(parseDuration(raw.interval), FAILOVER_LIMITS.intervalMs)) {
      return `故障转移「${name}」的检测间隔要写成 30s / 5m 这样,范围 5s 到 24h`
    }
  }
  if (raw.tolerance !== undefined && raw.tolerance !== null && raw.tolerance !== '' && !numIn(raw.tolerance, FAILOVER_LIMITS.tolerance)) {
    return `故障转移「${name}」的延迟容差要在 ${FAILOVER_LIMITS.tolerance[0]} 到 ${FAILOVER_LIMITS.tolerance[1]} 毫秒之间`
  }
  const fo = raw.failover
  if (fo !== undefined && fo !== null) {
    if (typeof fo !== 'object' || Array.isArray(fo)) return `故障转移「${name}」的 failover 参数不是对象`
    const check = (key, limits, label, unit) => {
      const v = fo[key]
      if (v === undefined || v === null || v === '') return ''
      return numIn(v, limits) ? '' : `故障转移「${name}」的${label}要在 ${limits[0]} 到 ${limits[1]}${unit}之间`
    }
    const err = check('timeoutMs', FAILOVER_LIMITS.timeoutMs, '单次检测超时', ' 毫秒')
      || check('failureThreshold', FAILOVER_LIMITS.failureThreshold, '连续失败轮数', ' 轮')
      || check('recoveryHoldMs', FAILOVER_LIMITS.recoveryHoldMs, '恢复等待', ' 毫秒')
    if (err) return err
    if (fo.restorePrimary !== undefined && fo.restorePrimary !== null && typeof fo.restorePrimary !== 'boolean') {
      return `故障转移「${name}」的「主用恢复后切回」必须是开 / 关`
    }
  }
  return ''
}

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
    // 类型 / 模式写错了要说出来,不能归一化成默认值蒙混过去(老记录缺字段走的是同一个归一化,但那是读取)
    for (const raw of body.groups) {
      if (!raw || typeof raw !== 'object') { res.status(400).json({ error: '分组定义不是对象' }); return }
      if (raw.type !== undefined && raw.type !== null && !GROUP_TYPES.includes(raw.type)) {
        res.status(400).json({ error: `分组「${raw.name ?? ''}」的类型不合法:${String(raw.type)}` })
        return
      }
      if (raw.mode !== undefined && raw.mode !== null && !GROUP_MODES.includes(raw.mode)) {
        res.status(400).json({ error: `分组「${raw.name ?? ''}」的成员模式不合法:${String(raw.mode)}` })
        return
      }
      if (typeof raw.name === 'string' && raw.name.trim().startsWith(FAILOVER_INTERNAL_PREFIX)) {
        res.status(400).json({ error: `分组名不能以「${FAILOVER_INTERNAL_PREFIX}」开头,这个前缀留给内部出站` })
        return
      }
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

    // 故障转移组按原始提交做严格校验(见 validateFailoverGroup)
    {
      const nodeTags = new Set(store.getNodes().map((n) => n && n.tag).filter(Boolean))
      const previous = new Map(store.getGroups().map((g) => [g.id, g]))
      const submittedNames = new Set(body.groups.map((g) => (typeof g?.name === 'string' ? g.name.trim() : '')))
      for (const raw of body.groups) {
        if (raw.type !== 'failover') continue
        const otherNames = new Set([...submittedNames, ...previous.values()].map((x) => (typeof x === 'string' ? x : x.name)))
        for (const p of policyNames) otherNames.add(p)
        otherNames.add(FALLBACK_TAG); otherNames.add(routing.fallback.name); otherNames.add(DNSMASQ_OUTBOUND_TAG)
        const prevSelf = isStr(raw.id) ? previous.get(raw.id.trim()) : undefined
        const err = validateFailoverGroup(raw, { nodeTags, otherNames, previous: prevSelf?.type === 'failover' ? prevSelf : undefined })
        if (err) { res.status(400).json({ error: err }); return }
      }
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
      .map((g) => (g.type === 'failover'
        // 故障转移:失效的是页签里已经不存在的节点(订阅更新删掉的),按页签报
        ? { name: g.name, members: g.lanes.flatMap((l) => l.members.filter((m) => !nodeTags.has(m))) }
        : { name: g.name, members: g.members.filter((m) => m !== g.name && !nodeTags.has(m) && !groupNames.has(m)) }))
      .filter((d) => d.members.length)
    res.json({ ok: true, groups: store.getGroups(), dropped, dangling, renamed: [...renames].map(([from, to]) => ({ from, to })) })
  })

  app.use('/api/openbox', router)
}
