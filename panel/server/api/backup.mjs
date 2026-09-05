import express from 'express'
import { reservedPolicyNames, validateProfilePatch } from './profile.mjs'
import { normalizeGroups } from '../engine/user-groups.mjs'

// 导出 / 导入:把这台路由器上「用户配出来的东西」打成一个 JSON——档案(目标分流、站点集、
// DNS、更新计划……)、节点组,可选带上 订阅和节点 / 终端分流 / 共享网络。新设备导入就能用,
// 不用重新配。不带面板密码、会话、clash 密钥、部署状态这些和机器绑定的东西;
// rulesetDir 是本机路径,导出时带着(看得见),导入时不写。
// 不勾的部分直接不出现在文件里(终端分流 / 共享网络是档案里的两个键,删掉即可);
// 导入时档案是合并写入,文件里没有的键不动现有的——所以「没导出」等于「导入时不碰」。
export const BACKUP_FORMAT = 'open-box-backup'
export const BACKUP_VERSION = 1

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

// 面板设置(语言、主题、圆角、延迟阈值……)和背景图存在同一张 KV 表里、由浏览器同步
// (index.mjs 的 /api/storage 和 /api/background-image),不在 store 对象上;由 index.mjs 把
// 读写函数作为 panelStorage 传进来。密码(config/access-*)和 openbox/* 不在其中。
const PANEL_KEY_PREFIX = 'config/'
const PANEL_SECRET_PREFIX = 'config/access-'
const isPanelKey = (k) => typeof k === 'string' && k.startsWith(PANEL_KEY_PREFIX) && !k.startsWith(PANEL_SECRET_PREFIX)

export const buildBackup = (store, {
  subscriptions = true, clientRoutes = true, servers = true, now = () => new Date(), openboxVersion = '', panelStorage = null,
} = {}) => {
  const profile = store.getProfile()
  if (!clientRoutes) delete profile.clientRoutes
  if (!servers) delete profile.servers
  const out = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now().toISOString(),
    openboxVersion,
    includes: { subscriptions, clientRoutes, servers },
    profile,
    groups: store.getGroups(),
  }
  if (subscriptions) {
    out.subscriptions = store.getSubscriptions()
    out.nodes = store.getNodes()
  }
  if (panelStorage) {
    const entries = panelStorage.readEntries() || {}
    out.panelSettings = Object.fromEntries(Object.entries(entries).filter(([k, v]) => isPanelKey(k) && typeof v === 'string'))
    out.backgroundImage = panelStorage.getBackground() || ''
  }
  return out
}

// 校验并落库。返回 { error } 或 { imported: { profile, groups, subscriptions, nodes } }。
// 档案走和 PUT /profile 同一套校验;组名和站点集名不能撞(和 PUT /groups 同一条规则);
// 订阅 / 节点只做结构检查:订阅得是带 id 的对象;节点记录没有 id,靠 tag 认(见
// subscriptions.mjs 的 resolveNodes:tag / type / server / subscriptionId……),要挂在文件里
// 存在的订阅上。以前按「必须有 id」过滤,把所有节点都丢了——导入后重启内核也没有节点。
// 档案和组一律覆盖;订阅 / 节点按 subscriptionsMode:
//   replace(默认)整份换成文件里的;append 加到现有订阅后面,同一条订阅(id 相同)
//   以文件里的为准、它的节点也跟着换——同一份文件导两次不会出现两份。
export const SUBSCRIPTION_MODES = ['replace', 'append']
export const applyBackup = (store, data, { subscriptionsMode = 'replace', panelStorage = null } = {}) => {
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

  // 面板设置:只收 config/ 开头、不是密码的键,值必须是字符串;背景图给了空串就是清掉
  let panelSettings = null
  if (data.panelSettings !== undefined) {
    if (!isPlainObject(data.panelSettings)) return { error: 'panelSettings 应为对象' }
    panelSettings = Object.fromEntries(Object.entries(data.panelSettings).filter(([k, v]) => isPanelKey(k) && typeof v === 'string'))
  }
  if (data.backgroundImage !== undefined && typeof data.backgroundImage !== 'string') return { error: 'backgroundImage 应为字符串' }

  let subscriptions = null
  let nodes = null
  if (data.subscriptions !== undefined || data.nodes !== undefined) {
    if (!Array.isArray(data.subscriptions) || !Array.isArray(data.nodes)) return { error: 'subscriptions / nodes 应为数组' }
    subscriptions = data.subscriptions.filter((s) => isPlainObject(s) && typeof s.id === 'string' && s.id)
    const ids = new Set(subscriptions.map((s) => s.id))
    nodes = data.nodes.filter((n) => isPlainObject(n) && typeof n.tag === 'string' && n.tag && ids.has(n.subscriptionId))
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
  let panelWritten = false
  let backgroundWritten = false
  if (panelStorage) {
    if (panelSettings) {
      panelStorage.writeEntries(panelSettings)
      panelWritten = true
    }
    if (typeof data.backgroundImage === 'string') {
      panelStorage.setBackground(data.backgroundImage)
      backgroundWritten = true
    }
  }
  return {
    imported: {
      profile: true,
      groups: groups ? groups.length : 0,
      subscriptions: subscriptions ? subscriptions.length : 0,
      nodes: nodes ? nodes.length : 0,
      subscriptionsMode: subscriptions ? subscriptionsMode : null,
      panelSettings: panelWritten ? Object.keys(panelSettings).length : 0,
      backgroundImage: backgroundWritten,
    },
  }
}

export const registerBackupRoutes = (app, { store, readVersion = async () => '', panelStorage = null } = {}) => {
  const router = express.Router({ caseSensitive: true })
  // 几百个节点的订阅一份就有几百 KB;背景图是 base64,一张照片就是几 MB,给足
  router.use(express.json({ limit: '32mb' }))

  // GET /api/openbox/backup?subscriptions=1|0&clientRoutes=1|0&servers=1|0(都默认 1)
  router.get('/backup', async (req, res) => {
    const flag = (name) => String(req.query[name] ?? '1') !== '0'
    let openboxVersion = ''
    try { openboxVersion = (await readVersion()) || '' } catch { /* 拿不到就空着 */ }
    res.json(buildBackup(store, {
      subscriptions: flag('subscriptions'),
      clientRoutes: flag('clientRoutes'),
      servers: flag('servers'),
      openboxVersion,
      panelStorage,
    }))
  })

  // POST /api/openbox/backup/import?subscriptions=replace|append  body = 导出的那份 JSON。
  // 只写库,不重启内核——和订阅那边一个规矩:页面提示「导入成功,重启内核生效」
  router.post('/backup/import', (req, res) => {
    const subscriptionsMode = typeof req.query.subscriptions === 'string' && req.query.subscriptions ? req.query.subscriptions : 'replace'
    const r = applyBackup(store, req.body, { subscriptionsMode, panelStorage })
    if (r.error) return res.status(400).json({ error: r.error })
    res.json({ ok: true, ...r })
  })

  app.use('/api/openbox', router)
}
