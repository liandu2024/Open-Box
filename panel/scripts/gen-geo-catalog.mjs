// 重新生成 src/constant/geo-catalog.ts(geosite/geoip 的可选值目录)。
//
//   node scripts/gen-geo-catalog.mjs
//
// 两份数据拼起来:
//   1. **可选值名单** —— 从 Open-Box 真正会去下载的那两个仓库拉(SagerNet/sing-geosite、
//      SagerNet/sing-geoip 的 rule-set 分支,见 server/system/rulesets.mjs)。名单里有的
//      部署时一定拉得到;上游加了新分类,重跑一次这个脚本就有了。
//   2. **中文/英文说明** —— 优先沿用现有 geo-catalog.ts 里已有的那份(它来自
//      Wan.Family.OS 的 vpn_geo_category_notes,1500+ 条 AI 生成后校对过的分类说明);
//      设了 GEO_NOTES_JSON 环境变量时改从那个文件读,格式是
//      [{ kind, name, note: { 'zh-CN', 'zh-TW', 'en-US' } }, ...]。
//      从那边导出的 SQL:
//        select json_agg(json_build_object('kind',kind,'name',name,'note',note_i18n))
//        from vpn_geo_category_notes;
//   geoip 在 sing-box 侧只有国家代码,说明用国名(同样沿用现有文件里的)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = path.resolve(here, '../src/constant/geo-catalog.ts')

const fetchTags = async (repo, prefix) => {
  const res = await fetch(`https://api.github.com/repos/SagerNet/${repo}/git/trees/rule-set`)
  if (!res.ok) throw new Error(`${repo}: HTTP ${res.status}`)
  const data = await res.json()
  if (data.truncated) throw new Error(`${repo}: 目录被截断了,得换分页方式再抓一次`)
  return data.tree
    .filter((t) => t.path.endsWith('.srs'))
    .map((t) => t.path.replace(/\.srs$/, '').replace(new RegExp(`^${prefix}-`), ''))
}

// 现有文件里的说明:[名称, 中文, 英文, 繁体?]
const readExisting = () => {
  const notes = { geosite: new Map(), geoip: new Map() }
  if (!fs.existsSync(target)) return notes
  const text = fs.readFileSync(target, 'utf8')
  let kind = null
  for (const line of text.split('\n')) {
    if (line.includes('GEOSITE_CATEGORIES')) kind = 'geosite'
    else if (line.includes('GEOIP_CATEGORIES')) kind = 'geoip'
    const m = kind && /^\s*\[(.+)\],\s*$/.exec(line)
    if (!m) continue
    const cells = m[1].split("','").map((c) => c.replace(/^'|'$/g, '').replace(/\\'/g, "'"))
    // 只登记真有文字的:没说明的条目要能在下面被数出来
    if (cells.length > 1) {
      notes[kind].set(cells[0], { 'zh-CN': cells[1] || '', 'en-US': cells[2] || '', 'zh-TW': cells[3] || '' })
    }
  }
  return notes
}

const fromJson = () => {
  const file = process.env.GEO_NOTES_JSON
  if (!file) return null
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
  const notes = { geosite: new Map(), geoip: new Map() }
  for (const r of rows) notes[r.kind]?.set(r.name, r.note || {})
  return notes
}

const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const row = (name, note) => {
  const zh = note?.['zh-CN'] || ''
  const tw = note?.['zh-TW'] || ''
  const en = note?.['en-US'] || ''
  const cells = [name, zh, en]
  if (tw && tw !== zh) cells.push(tw)
  while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop()
  return `  [${cells.map((c) => `'${esc(c)}'`).join(',')}],`
}

const [site, ip] = await Promise.all([fetchTags('sing-geosite', 'geosite'), fetchTags('sing-geoip', 'geoip')])
const existing = readExisting()
const extra = fromJson()
const noteFor = (kind, name) => extra?.[kind].get(name) || existing[kind].get(name)

const header = fs.existsSync(target)
  ? fs.readFileSync(target, 'utf8').split('export type GeoCategoryRow')[0]
  : ''

fs.writeFileSync(
  target,
  `${header}export type GeoCategoryRow = readonly [string, string?, string?, string?]

export const GEOSITE_CATEGORIES: readonly GeoCategoryRow[] = [
${site.map((n) => row(n, noteFor('geosite', n))).join('\n')}
]

export const GEOIP_CATEGORIES: readonly GeoCategoryRow[] = [
${ip.map((n) => row(n, noteFor('geoip', n))).join('\n')}
]
`,
)
const missing = site.filter((n) => !noteFor('geosite', n)).length
console.log(`geosite ${site.length}(缺说明 ${missing})  geoip ${ip.length}  ->  ${path.relative(process.cwd(), target)}`)
