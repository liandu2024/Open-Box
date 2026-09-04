// 新装面板的默认外观与偏好:随包发布一份「面板设置」快照(server/defaults/storage-defaults.json)
// 和一张背景图(server/defaults/background-image.txt,data URL)。面板第一次启动、app_storage
// 里还没有任何 config/* 时把它们写进去,新装用户打开面板就是这套主题、圆角、透明度和背景。
// 已经在用的安装(有 config/*)一律不动。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BACKGROUND_IMAGE_KEY = '__background_image__'
const DEFAULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'defaults')

export const loadStorageDefaults = (dir = DEFAULTS_DIR) => {
  let entries = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'storage-defaults.json'), 'utf8'))
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof k === 'string' && k.startsWith('config/') && !k.startsWith('config/access-') && typeof v === 'string') entries[k] = v
      }
    }
  } catch {
    entries = {}
  }
  let background = ''
  try {
    background = fs.readFileSync(path.join(dir, 'background-image.txt'), 'utf8').trim()
    if (!background.startsWith('data:image/')) background = ''
  } catch {
    background = ''
  }
  return { entries, background }
}

// 随包的默认档案(server/defaults/profile-defaults.json):目前只带 routing——一套现成的
// 目标分流(AI / Youtube / TikTok / Netflix / Github / Google / Microsoft / Apple / Games /
// 国外 / 国内 + 兜底「其他」),取自正式路由器上长期在用的那份。兜底走直连、「国外」带
// gfw 被墙域名表:没被站点集挑走的默认不占节点流量。各站点集的出口存的是占位符
// 'proxy'(= 成员表里的第一个节点组)或 'direct',新装机器上没有作者那些节点组也能用。
// 只在全新安装时写入(还没有任何 config/*,也没有 openbox/profile),已经在用的安装一律不动。
export const PROFILE_KEY = 'openbox/profile'

export const loadProfileDefaults = (dir = DEFAULTS_DIR) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'profile-defaults.json'), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (!parsed.routing || typeof parsed.routing !== 'object' || !Array.isArray(parsed.routing.policies)) return null
    return parsed
  } catch {
    return null
  }
}

export const seedDefaultStorage = ({ countConfigEntries, insert, hasKey = () => false, log = () => {}, dir = DEFAULTS_DIR }) => {
  if (countConfigEntries() > 0) return { seeded: 0, profile: false }
  const { entries, background } = loadStorageDefaults(dir)
  let seeded = 0
  for (const [k, v] of Object.entries(entries)) {
    insert(k, v)
    seeded += 1
  }
  if (background) {
    insert(BACKGROUND_IMAGE_KEY, background)
    seeded += 1
  }
  let profile = false
  const profileDefaults = loadProfileDefaults(dir)
  if (profileDefaults && !hasKey(PROFILE_KEY)) {
    insert(PROFILE_KEY, JSON.stringify(profileDefaults))
    profile = true
  }
  if (seeded || profile) log(`[defaults] 全新安装:写入 ${seeded} 项默认面板设置${background ? '(含背景图)' : ''}${profile ? `,以及默认目标分流(${profileDefaults.routing.policies.length} 个站点集)` : ''}`)
  return { seeded, profile }
}
