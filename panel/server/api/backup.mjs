import express from 'express'
import { reservedPolicyNames, validateProfilePatch } from './profile.mjs'
import { normalizeGroups } from '../engine/user-groups.mjs'

// 导出 / 导入:把这台路由器上「用户配出来的东西」打成一个 JSON——档案(目标分流、站点集、
// 终端分流、共享网络、DNS、更新计划……)、节点组,可选带上订阅和节点。新设备导入就能用,
// 不用重新配。不带面板密码、会话、clash 密钥、部署状态这些和机器绑定的东西;
// rulesetDir 是本机路径,导出时带着(看得见),导入时不写。
export const BACKUP_FORMAT = 'open-box-backup'
export const BACKUP_VERSION = 1

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

export const buildBackup = (store, { subscriptions = true, now = () => new Date(), openboxVersion = '' } = {}) => {
  const out = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now().toISOString(),
    openboxVersion,
    profile: store.getProfile(),
    groups: store.getGroups(),
  }
  if (subscriptions) {
    out.subscriptions = store.getSubscriptions()
    out.nodes = store.getNodes()
  }
  return out
}

// 校验并落库。返回 { error } 或 { imported: { profile, groups, subscriptions, nodes } }。
// 档案走和 PUT /profile 同一套校验;组名和站点集名不能撞(和 PUT /groups 同一条规则);
// 订阅 / 节点只做结构检查:都得是带 id 的对象,节点要挂在文件里存在的订阅上。
// 档案和组一律覆盖;订阅 / 节点按 subscriptionsMode:
//   replace(默认)整份换成文件里的;append 加到现有订阅后面,同一条订阅(id 相同)
//   以文件里的为准、它的节点也跟着换——同一份文件导两次不会出现两份。
export const SUBSCRIPTION_MODES = ['replace', 'append']
export const applyBackup = (store, data, { subscriptionsMode = 'replace' } = {}) => {
  if (!SUBSCRIPTION_MODES.includes(subscriptionsMode)) return { error: `subscriptions 应为 ${SUBSCRIPTION_MODES.join(' / ')}` }
  if (!isPlainObject(data) || data.format !== BACKUP_FORMAT) return { error: '不是 Open-Box 导出的文件' }
  if (!(Number.isInteger(data.version) && data.version >= 1 && data.version <= BACKUP_VERSION)) {
    return { error: `不认识的备份版本:${data.version}` }
  }
  if (!isPlainObject(data.profile)) return { error: '文件里没有档案(profile)' }
  if (data.groups !== undefined && !Array.isArray(data.groups)) return { error: 'groups 应为数组' }
  const groups = data.groups === undefined ? null : normalizeGroups(data.groups)
  const seen = new Set()
  for (const g of groups || []) {
    if (seen.has(g.name)) return { error: `分组名称重复:${g.name}` }
    seen.add(g.name)
  }
  const { rulesetDir, ...profilePatch } = data.profile
  void rulesetDir
  const profileError = validateProfilePatch(profilePatch, { reservedNames: reservedPolicyNames(groups || store.getGroups()) })
  if (profileError) return { error: `档案不合法:${profileError}` }

  let subscriptions = null
  let nodes = null
  if (data.subscriptions !== undefined || data.nodes !== undefined) {
    if (!Array.isArray(data.subscriptions) || !Array.isArray(data.nodes)) return { error: 'subscriptions / nodes 应为数组' }
    subscriptions = data.subscriptions.filter((s) => isPlainObject(s) && typeof s.id === 'string' && s.id)
    const ids = new Set(subscriptions.map((s) => s.id))
    nodes = data.nodes.filter((n) => isPlainObject(n) && typeof n.id === 'string' && n.id && ids.has(n.subscriptionId))
  }

  // 组先于档案落库:档案里的站点集名不能和组名撞,顺序反了校验就是拿旧组名比的
  if (groups) store.setGroups(groups)
  store.setProfile(profilePatch)
  if (subscriptions) {
    if (subscriptionsMode === 'append') {
      const incoming = new Set(subscriptions.map((s) => s.id))
      const keptSubs = store.getSubscriptions().filter((s) => !incoming.has(s.id))
      const keptNodes = store.getNodes().filter((n) => !incoming.has(n.subscriptionId))
      store.setSubscriptions([...keptSubs, ...subscriptions])
      store.setNodes([...keptNodes, ...nodes])
    } else {
      store.setSubscriptions(subscriptions)
      store.setNodes(nodes)
    }
  }
  return {
    imported: {
      profile: true,
      groups: groups ? groups.length : 0,
      subscriptions: subscriptions ? subscriptions.length : 0,
      nodes: nodes ? nodes.length : 0,
      subscriptionsMode: subscriptions ? subscriptionsMode : null,
    },
  }
}

export const registerBackupRoutes = (app, { store, readVersion = async () => '' } = {}) => {
  const router = express.Router({ caseSensitive: true })
  // 几百个节点的订阅一份就有几百 KB,给足
  router.use(express.json({ limit: '8mb' }))

  // GET /api/openbox/backup?subscriptions=1|0
  router.get('/backup', async (_req, res) => {
    const withSubscriptions = String(_req.query.subscriptions ?? '1') !== '0'
    let openboxVersion = ''
    try { openboxVersion = (await readVersion()) || '' } catch { /* 拿不到就空着 */ }
    res.json(buildBackup(store, { subscriptions: withSubscriptions, openboxVersion }))
  })

  // POST /api/openbox/backup/import?subscriptions=replace|append  body = 导出的那份 JSON。
  // 只写库,不重启内核——和订阅那边一个规矩:页面提示「导入成功,重启内核生效」
  router.post('/backup/import', (req, res) => {
    const subscriptionsMode = typeof req.query.subscriptions === 'string' && req.query.subscriptions ? req.query.subscriptions : 'replace'
    const r = applyBackup(store, req.body, { subscriptionsMode })
    if (r.error) return res.status(400).json({ error: r.error })
    res.json({ ok: true, ...r })
  })

  app.use('/api/openbox', router)
}
