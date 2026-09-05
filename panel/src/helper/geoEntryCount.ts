import { fetchRuleListPreview, fetchRulesetEntries } from '@/api/openbox'

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

// key 区分两种来源:规则集名原样,「规则集链接」加 url: 前缀
const countFor = (key: string, fetchTotal: () => Promise<{ total?: number } | null | undefined>) => {
  const cached = counts.get(key)
  if (cached !== undefined) return Promise.resolve(cached)
  const running = inflight.get(key)
  if (running) return running

  const task = queue
    .catch(() => {})
    .then(fetchTotal)
    .then((res) => {
      const total = Number(res?.total)
      if (!Number.isFinite(total)) return null
      counts.set(key, total)
      return total
    })
    // 取不到就当没有这个数:按钮照常显示「详情」,点开时用户会看到真正的报错
    .catch(() => null)
    .finally(() => inflight.delete(key))

  queue = task
  inflight.set(key, task)
  return task
}

export const cachedGeoEntryCount = (tag: string) => counts.get(tag) ?? null
export const geoEntryCount = (tag: string): Promise<number | null> =>
  tag ? countFor(tag, () => fetchRulesetEntries(tag, { limit: 1 })) : Promise.resolve(null)

// 「规则集链接」:同样只要 1 条拿 total;服务端按网址缓存,这里也按网址缓存
export const cachedRuleListCount = (url: string) => counts.get(`url:${url}`) ?? null
export const ruleListCount = (url: string): Promise<number | null> =>
  url ? countFor(`url:${url}`, () => fetchRuleListPreview(url, { limit: 1 })) : Promise.resolve(null)
