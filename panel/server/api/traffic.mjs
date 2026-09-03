// 每日流量查询:GET /api/openbox/traffic/month?month=YYYY-MM(月视图)、
// GET /api/openbox/traffic/day?day=YYYY-MM-DD(某天按节点、按域名/IP 的明细)。
// 数据来自 system/traffic-collector.mjs 常驻采集写进 cache.db 的 traffic_daily 表。
import express from 'express'
import { localDay } from '../system/traffic-collector.mjs'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const pad2 = (n) => String(n).padStart(2, '0')

export const daysInMonth = (month) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

// 整月每天一条(没记录的补 0),外加合计和日均。日均按"这个月已经过去的天数"算:
// 往月除以整月天数,当月除以今天的日期,未来的月份没有日均。
export const buildMonthView = (month, rows, today) => {
  const n = daysInMonth(month)
  const byDay = new Map((rows || []).map((r) => [r.day, r]))
  const days = []
  const total = { up: 0, down: 0, conns: 0 }
  for (let i = 1; i <= n; i += 1) {
    const day = `${month}-${pad2(i)}`
    const r = byDay.get(day)
    const item = {
      day,
      up: r ? Number(r.up) || 0 : 0,
      down: r ? Number(r.down) || 0 : 0,
      conns: r ? Number(r.conns) || 0 : 0,
    }
    days.push(item)
    total.up += item.up
    total.down += item.down
    total.conns += item.conns
  }
  const currentMonth = today.slice(0, 7)
  const avgDays = month < currentMonth ? n : month === currentMonth ? Number(today.slice(8)) : 0
  const avg = avgDays ? { up: total.up / avgDays, down: total.down / avgDays } : { up: 0, down: 0 }
  return { month, today, days, total, avg, avgDays }
}

// OpenWrt 的 dnsmasq 租约表:每行「到期时间 MAC IP 主机名 客户端ID」。读不到就当没有。
export const parseDhcpLeases = (text) => {
  const map = new Map()
  for (const line of String(text || '').split('\n')) {
    const f = line.trim().split(/\s+/)
    if (f.length >= 4 && f[2] && f[3] && f[3] !== '*') map.set(f[2], f[3])
  }
  return map
}

const readLeaseNames = async (ctx, leasesPath) => {
  if (!ctx || !leasesPath) return new Map()
  try {
    return parseDhcpLeases(await ctx.readFile(leasesPath))
  } catch {
    return new Map()
  }
}

export const registerTrafficRoutes = (app, { collector, ctx, paths, now = () => new Date() }) => {
  const router = express.Router()

  router.get('/traffic/month', (req, res) => {
    const today = localDay(now())
    const month = typeof req.query.month === 'string' && req.query.month ? req.query.month : today.slice(0, 7)
    if (!MONTH_RE.test(month)) {
      res.status(400).json({ error: 'month 应为 YYYY-MM' })
      return
    }
    collector.flush()
    res.json(buildMonthView(month, collector.store.month(month), today))
  })

  router.get('/traffic/day', async (req, res) => {
    const day = typeof req.query.day === 'string' ? req.query.day : ''
    if (!DAY_RE.test(day)) {
      res.status(400).json({ error: 'day 应为 YYYY-MM-DD' })
      return
    }
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 500))
    collector.flush()
    const store = collector.store
    const t = store.dayTotal(day)
    const total = {
      up: t ? Number(t.up) || 0 : 0,
      down: t ? Number(t.down) || 0 : 0,
      conns: t ? Number(t.conns) || 0 : 0,
    }
    const nodes = store.day(day, 'node', limit)
    const hosts = store.day(day, 'host', limit)
    const names = await readLeaseNames(ctx, paths && paths.dhcpLeases)
    const clients = store.day(day, 'client', limit).map((r) => ({ ...r, name: names.get(r.key) || '' }))
    const hostSum = store.daySum(day, 'host')
    const clientSum = store.daySum(day, 'client')
    const nodeSum = store.daySum(day, 'node')
    // 总量是内核精确计数,分量是采样的;差额就是没采到的短连接(见 traffic-collector 顶部说明)
    const other = {
      up: Math.max(0, total.up - (Number(nodeSum.up) || 0)),
      down: Math.max(0, total.down - (Number(nodeSum.down) || 0)),
    }
    res.json({
      day, today: localDay(now()), total, nodes, hosts, clients,
      hostsCount: Number(hostSum.n) || 0, clientsCount: Number(clientSum.n) || 0, other,
    })
  })

  app.use('/api/openbox', router)
}
