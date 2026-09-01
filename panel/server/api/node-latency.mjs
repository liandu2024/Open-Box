import dns from 'node:dns/promises'
import express from 'express'
import { emitOutbound } from '../engine/emit-outbound.mjs'
import { assertPublicHost } from './net-guard.mjs'
import { resolveNodes } from './subscriptions.mjs'

// 节点测速。
//
// 第一版是从路由器直接对 server:port 做 TCP 握手计时。真机上被证明**完全没有意义**:
// 那台路由器的网络里有东西把所有 TCP 握手就地接管了——实测连 203.0.113.7:12345
// (RFC 5737 保留网段,完全不可路由)都在 0.84ms「连上」,端口 9 也一样。于是每个节点
// 都是 0ms/1ms,数字全是假的。
//
// 现在改用 `sing-box tools fetch -c <配置> -o <出站> <URL>`:让内核自己按节点的完整
// 配置拨号,真的发一次 HTTPS 请求。这条路径会走完协议握手与鉴权,所以密码错、协议不
// 支持、服务器没在监听都会如实失败——同一个不可达地址,TCP 版 0.84ms「成功」,这里
// 5 秒后报错。测的是**端到端可用性与延迟**,不再是"有没有人应答 SYN"。
//
// 代价:每测一个节点要起一个 sing-box 进程(本机实测走 direct 出站约 0.4~0.9 秒,
// 路由器上更慢),所以并发压到 4,并给每次调用单独的超时。

const TEST_URL = 'https://www.gstatic.com/generate_204'
const DEFAULT_TIMEOUT_MS = 8000
const MAX_TIMEOUT_MS = 30000
const MAX_TARGETS = 100
// 每个测试都是一个独立进程,路由器 CPU/内存都紧张,并发不能放大。
const CONCURRENCY = 4

// 按固定并发消费任务队列,结果与输入下标一一对应。
const runPool = async (items, limit, worker) => {
  const results = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = cursor++
        if (index >= items.length) return
        results[index] = await worker(items[index], index)
      }
    }),
  )
  return results
}

export const registerNodeLatencyRoutes = (app, { ctx, paths, fetchImpl = globalThis.fetch, lookup = dns.lookup } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '10mb' }))

  // POST /api/openbox/nodes/latency
  //   { url? , content?, renameOptions?, tags: [originalTag...], timeoutMs? }
  // 用 url/content 重新解析而不是让前端把节点配置传上来:节点里含密码,没有理由为了
  // 测速把它们送到浏览器再送回来。
  router.post('/nodes/latency', async (req, res) => {
    const body = req.body || {}
    const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string') : null
    if (!tags || !tags.length) {
      res.status(400).json({ error: 'tags must be a non-empty array' })
      return
    }
    if (tags.length > MAX_TARGETS) {
      res.status(400).json({ error: `too many targets (max ${MAX_TARGETS})` })
      return
    }

    const timeoutMs = Math.min(Math.max(Number(body.timeoutMs) || DEFAULT_TIMEOUT_MS, 2000), MAX_TIMEOUT_MS)

    let nodes
    try {
      const resolved = await resolveNodes(
        { url: body.url, content: body.content },
        fetchImpl,
        body.renameOptions,
        lookup,
      )
      nodes = resolved.renamed
    } catch (err) {
      res.status(400).json({ error: (err && err.message) || String(err) })
      return
    }

    const wanted = tags
      .map((tag) => nodes.find((n) => n.originalTag === tag))
      .map((node, i) => ({ tag: tags[i], node }))

    // 一份配置装下这一批要测的出站,每次调用只是换 -o 参数,省掉反复写文件。
    // probe-<下标> 作为出站 tag:节点自己的名字可能重复、含空格或特殊字符。
    const outbounds = []
    const probeTagOf = new Map()
    wanted.forEach((item, i) => {
      if (!item.node) return
      const probeTag = `probe-${i}`
      try {
        outbounds.push({ ...emitOutbound(item.node), tag: probeTag })
        probeTagOf.set(item.tag, probeTag)
      } catch {
        // 生成不出出站(协议不支持等)的节点直接跳过,下面按 unsupported 返回
      }
    })

    if (!outbounds.length) {
      res.json({ results: wanted.map(() => ({ ok: false, error: 'unsupported' })) })
      return
    }

    const configPath = `${paths.etc}/config.latency.json`
    try {
      await ctx.mkdirp(paths.etc)
      await ctx.writeFile(configPath, JSON.stringify({ log: { level: 'error' }, outbounds }, null, 2))
    } catch (err) {
      res.status(500).json({ error: `failed to write probe config: ${(err && err.message) || err}` })
      return
    }

    const results = await runPool(wanted, CONCURRENCY, async (item) => {
      if (!item.node) return { ok: false, error: 'not found' }
      const probeTag = probeTagOf.get(item.tag)
      if (!probeTag) return { ok: false, error: 'unsupported' }

      // 服务器地址来自订阅内容(可控输入)。挡住内网/回环,免得这个接口变成内网探测
      // 工具。代价是自建在局域网里的节点测不了——部署仍然可以,只是测速这里不放行。
      try {
        await assertPublicHost(item.node.server, { lookup })
      } catch (err) {
        return { ok: false, error: (err && err.message) || 'blocked' }
      }

      const startedAt = Date.now()
      const { code, stderr } = await ctx.exec(
        paths.singbox,
        ['tools', 'fetch', '-c', configPath, '-o', probeTag, TEST_URL],
        { timeoutMs },
      )
      const ms = Date.now() - startedAt
      if (code === 0) return { ok: true, ms }
      const reason = String(stderr || '').split('\n').filter(Boolean).pop() || 'failed'
      return { ok: false, error: reason.slice(0, 160) }
    })

    res.json({ results })
  })

  app.use('/api/openbox', router)
}
