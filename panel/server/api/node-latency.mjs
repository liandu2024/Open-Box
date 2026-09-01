import net from 'node:net'
import dns from 'node:dns/promises'
import express from 'express'
import { assertPublicHost } from './net-guard.mjs'

// 节点延迟测试。
//
// 订阅里的节点还没部署进内核,所以拿不到 Clash API 的 /proxies/{name}/delay——那个
// 只对"已经在跑的配置里的出站"有效。这里退而求其次:从路由器直接对 server:port 做一次
// TCP 握手并计时。
//
// 它测的是**到节点入口的可达性与往返时延**,不是代理本身的速度,也不校验密码/协议是否
// 正确。这一点必须在界面上说清楚,不能让用户以为"绿了就一定能用"。
//
// 安全:server 来自订阅内容,是攻击者可控的输入。不加限制的话,这个接口就是一台内网
// 端口扫描器——填 127.0.0.1:22 就能靠"连上了/没连上 + 耗时"探测路由器自身和内网。
// 所以每个目标都走和订阅拉取同一套 assertPublicHost:解析域名并要求每一个解析结果
// 都是公网地址,解析不出来也拒绝。

const DEFAULT_TIMEOUT_MS = 5000
const MAX_TIMEOUT_MS = 20000
// 一次最多测多少个:一份订阅几百个节点时,并发全开会把路由器的文件描述符和内存吃掉。
const MAX_TARGETS = 200
// 并发上限。路由器 CPU/内存都紧张,逐个测太慢、全并发又扛不住,取个中间值。
const CONCURRENCY = 8

// 导出以便直接测:成功路径需要一个真的能连上的地址,而 assertPublicHost 会拒绝回环,
// 两者没法在同一个用例里同时满足。拆开测——守卫归守卫,拨测归拨测。
export const tcpPing = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const startedAt = process.hrtime.bigint()
    const socket = new net.Socket()
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      const ms = Number((process.hrtime.bigint() - startedAt) / 1000000n)
      finish({ ok: true, ms })
    })
    socket.once('timeout', () => finish({ ok: false, error: 'timeout' }))
    socket.once('error', (err) => finish({ ok: false, error: err && err.code ? err.code : 'error' }))
    socket.connect(port, host)
  })

// 简易并发池:按固定并发数消费任务队列,保持结果与输入下标一一对应。
const runPool = async (items, limit, worker) => {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

export const registerNodeLatencyRoutes = (app, { lookup = dns.lookup } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '1mb' }))

  // POST /api/openbox/nodes/latency  { targets: [{ server, port }], timeoutMs? }
  router.post('/nodes/latency', async (req, res) => {
    const body = req.body || {}
    const targets = Array.isArray(body.targets) ? body.targets : null
    if (!targets) {
      res.status(400).json({ error: 'targets must be an array' })
      return
    }
    if (targets.length > MAX_TARGETS) {
      res.status(400).json({ error: `too many targets (max ${MAX_TARGETS})` })
      return
    }

    const timeoutMs = Math.min(
      Math.max(Number(body.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000),
      MAX_TIMEOUT_MS,
    )

    const results = await runPool(targets, CONCURRENCY, async (target) => {
      const server = typeof target?.server === 'string' ? target.server.trim() : ''
      const port = Number(target?.port)
      if (!server || !Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, error: 'invalid target' }
      }

      // 用解析出来的地址去连,而不是再让 socket 自己解析一次:否则校验与实际连接之间
      // 存在 TOCTOU 窗口(DNS rebinding),校验过的域名可以在下一次解析时指回内网。
      let address
      try {
        const records = await assertPublicHost(server, { lookup })
        address = Array.isArray(records) && records.length ? records[0].address : null
      } catch (err) {
        return { ok: false, error: (err && err.message) || 'blocked' }
      }
      if (!address) return { ok: false, error: 'blocked' }

      return tcpPing(address, port, timeoutMs)
    })

    res.json({ results })
  })

  app.use('/api/openbox', router)
}
