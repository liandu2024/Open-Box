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

export const seedDefaultStorage = ({ countConfigEntries, insert, log = () => {}, dir = DEFAULTS_DIR }) => {
  if (countConfigEntries() > 0) return { seeded: 0 }
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
  if (seeded) log(`[defaults] 全新安装:写入 ${seeded} 项默认面板设置${background ? '(含背景图)' : ''}`)
  return { seeded }
}
