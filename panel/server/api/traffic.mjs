// 每日流量查询:GET /api/openbox/traffic/month?month=YYYY-MM(月视图)、
// GET /api/openbox/traffic/day?day=YYYY-MM-DD(某天按节点、按域名/IP 的明细)。
// 数据来自 system/traffic-collector.mjs 常驻采集写进 cache.db 的 traffic_daily 表。
import express from 'express'
import { readLocalAddresses } from '../system/local-subnets.mjs'
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

// 路由器自己的地址 → { iface, kind }:WAN / LAN 地址会以"终端"身份出现在流量表里(打环、
// 路由器自身的直连),标出来免得像一台陌生设备
const readSelfAddresses = async (ctx) => {
  if (!ctx) return new Map()
  try {
    return new Map((await readLocalAddresses(ctx)).map((a) => [a.address, { iface: a.iface, kind: a.kind }]))
  } catch {
    return new Map()
  }
}
const withClientLabels = (rows, names, self) => rows.map((r) => {
  const out = { ...r, name: names.get(r.key) || '' }
  const me = self.get(r.key)
  if (me) out.self = me
  return out
})

const readLeaseNames = async (ctx, leasesPath) => {
  if (!ctx || !leasesPath) return new Map()
  try {
    return parseDhcpLeases(await ctx.readFile(leasesPath))
  } catch {
    return new Map()
  }
}

const DRILL_KINDS = new Set(['client', 'node', 'host'])

export const registerTrafficRoutes = (app, { collector, ctx, paths, now = () => new Date() }) => {
  const router = express.Router()

  // 「分析数据保留时长」卡片用:存了多少、大概占多大、每天涨多少
  router.get('/traffic/usage', (_req, res) => {
    const u = collector.store.usage ? collector.store.usage() : null
    if (!u) return res.json({ rows: 0, days: 0, bytes: 0, perDay: 0 })
    res.json({ ...u, perDay: u.days ? Math.round(u.bytes / u.days) : 0 })
  })

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
    const [names, self] = await Promise.all([readLeaseNames(ctx, paths && paths.dhcpLeases), readSelfAddresses(ctx)])
    const clients = withClientLabels(store.day(day, 'client', limit), names, self)
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
      // 24 小时曲线
      hours: store.hours(day),
    })
  })

  // GET /api/openbox/clients:终端分流选来源用。DHCP 租约里的设备 + 今天在流量里出现过的来源 IP
  // 一条记录往下钻:day + kind(client|node|host)+ key 定位记录,by 是拆成哪一维
  router.get('/traffic/drill', async (req, res) => {
    const day = typeof req.query.day === 'string' ? req.query.day : ''
    const kind = typeof req.query.kind === 'string' ? req.query.kind : ''
    const by = typeof req.query.by === 'string' ? req.query.by : ''
    const key = typeof req.query.key === 'string' ? req.query.key : ''
    if (!DAY_RE.test(day)) {
      res.status(400).json({ error: 'day 应为 YYYY-MM-DD' })
      return
    }
    if (!DRILL_KINDS.has(kind) || !DRILL_KINDS.has(by) || kind === by) {
      res.status(400).json({ error: 'kind/by 应为 client、node、host 中不同的两个' })
      return
    }
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200))
    collector.flush()
    const { rows, count, sum } = collector.store.drill(day, kind, key, by, limit)
    let labeled = rows
    if (by === 'client') {
      const [names, self] = await Promise.all([readLeaseNames(ctx, paths && paths.dhcpLeases), readSelfAddresses(ctx)])
      labeled = withClientLabels(rows, names, self)
    }
    res.json({ day, kind, key, by, count, sum: sum || { up: 0, down: 0 }, rows: labeled })
  })

  router.get('/clients', async (_req, res) => {
    const names = await readLeaseNames(ctx, paths && paths.dhcpLeases)
    const seen = new Map()
    for (const [ip, name] of names) seen.set(ip, name)
    try {
      collector.flush()
      for (const r of collector.store.day(localDay(now()), 'client', 500)) {
        if (r.key && !seen.has(r.key)) seen.set(r.key, '')
      }
    } catch { /* 采集器没数据就只给租约 */ }
    res.json({ clients: [...seen.entries()].map(([ip, name]) => ({ ip, name })) })
  })

  app.use('/api/openbox', router)
}
