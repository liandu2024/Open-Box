import { fetchRulesetEntries } from '@/api/openbox'

// 规则集里有多少条记录。规则页、站点集编辑里的「详情」按钮要在按钮上直接显示这个数,
// 不用点开才知道。
//
// 服务端算这个数不便宜:本地没有 .srs 要先下,然后 spawn 一次 sing-box rule-set decompile
// (server/api/rulesets.mjs 的 loadEntries),之后才在服务端内存里缓存一阵。所以这里:
//   · 只取 1 条(total 是全量的,和 limit 无关),不把整份名单拉回浏览器;
//   · 同一个 tag 的结果在浏览器里也存一份,一次会话内不重复问;
//   · 串行排队——一个站点集里可能有十条规则,同时发十个请求会在路由器上同时 spawn
//     十个进程,内存小的机器扛不住。
const counts = new Map<string, number>()
const inflight = new Map<string, Promise<number | null>>()
let queue: Promise<unknown> = Promise.resolve()

export const cachedGeoEntryCount = (tag: string) => counts.get(tag) ?? null

export const geoEntryCount = (tag: string): Promise<number | null> => {
  if (!tag) return Promise.resolve(null)
  const cached = counts.get(tag)
  if (cached !== undefined) return Promise.resolve(cached)
  const running = inflight.get(tag)
  if (running) return running

  const task = queue
    .catch(() => {})
    .then(() => fetchRulesetEntries(tag, { limit: 1 }))
    .then((res) => {
      const total = Number(res?.total)
      if (!Number.isFinite(total)) return null
      counts.set(tag, total)
      return total
    })
    // 取不到就当没有这个数:按钮照常显示「详情」,点开时用户会看到真正的报错
    .catch(() => null)
    .finally(() => inflight.delete(tag))

  queue = task
  inflight.set(tag, task)
  return task
}
