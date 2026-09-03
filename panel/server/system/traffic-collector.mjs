// 每日流量采集。
//
// sing-box 自己不存历史流量:clash API 只有"当前连接表"(/connections,每条连接带累计
// upload/download)和两个自内核启动以来的总计数(uploadTotal/downloadTotal)。要画"每日
// 流量"并且能下钻到节点、域名,面板得自己常驻采样:每 intervalMs 读一次连接表,和上一次
// 比出增量,按"当天 / 节点 / 域名或 IP"三个维度累加,攒够 flushMs 一次写进 sqlite。
//
// 精度说明(前端"未采样到的短连接"那一行就是这么来的):
// - 当天总量用内核的 uploadTotal/downloadTotal 增量,是精确的;
// - 节点/域名的分量只能从连接表逐条比增量,存活不到一个采样周期的连接根本看不见,
//   连接关闭前最后不到一个周期的字节也会丢。总量 − 各节点之和 = 这部分误差。
//
// 方向:clash API 的 upload = 发往外网的字节(出口),download = 从外网收到的(入口)。
// 库里和接口里一律叫 up/down,前端再翻成 入口/出口。

const pad2 = (n) => String(n).padStart(2, '0')

// 都按面板进程的本地时间算天:路由器上 TZ 跟 OpenWrt 系统一致,前端拿服务端给的 today 做高亮,
// 不自己算,免得浏览器和路由器时区不一样。
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

// sing-box 的 chains 是 [末端节点, ..., 顶层策略](和 clash 一样,tracker 里 Reverse 过)
export const leafOf = (chains) => (Array.isArray(chains) && chains.length ? String(chains[0] ?? '') : '')

// 有域名(SNI / HTTP Host / 反查)就记域名,没有就记目标 IP
export const hostOf = (metadata) => {
  const m = metadata && typeof metadata === 'object' ? metadata : {}
  const host = String(m.host || '').trim().toLowerCase()
  return host || String(m.destinationIP || '').trim()
}

const toInt = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

const nextMonthOf = (month) => {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`
}

// sqlite 落地。表按 (day, kind, key) 唯一,kind ∈ total | node | host,total 的 key 是空串。
// 写入全是"加上增量"的 upsert,所以内存里只用攒增量,不用记绝对值。
export const createTrafficStore = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS traffic_daily (
      day TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      up INTEGER NOT NULL DEFAULT 0,
      down INTEGER NOT NULL DEFAULT 0,
      conns INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, kind, key)
    ) WITHOUT ROWID
  `)
  const upsert = db.prepare(`
    INSERT INTO traffic_daily (day, kind, key, up, down, conns) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, kind, key) DO UPDATE SET
      up = up + excluded.up,
      down = down + excluded.down,
      conns = conns + excluded.conns
  `)
  const selectMonth = db.prepare(`
    SELECT day, up, down, conns FROM traffic_daily
    WHERE kind = 'total' AND day >= ? AND day < ? ORDER BY day
  `)
  const selectTotal = db.prepare(`SELECT up, down, conns FROM traffic_daily WHERE kind = 'total' AND day = ?`)
  const selectKind = db.prepare(`
    SELECT key, up, down, conns FROM traffic_daily
    WHERE day = ? AND kind = ? ORDER BY (up + down) DESC, key LIMIT ?
  `)
  const sumKind = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(up), 0) AS up, COALESCE(SUM(down), 0) AS down
    FROM traffic_daily WHERE day = ? AND kind = ?
  `)
  const deleteBefore = db.prepare(`DELETE FROM traffic_daily WHERE day < ?`)

  return {
    add(rows) {
      if (!rows.length) return
      db.exec('BEGIN')
      try {
        for (const r of rows) upsert.run(r.day, r.kind, r.key, r.up, r.down, r.conns)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
    month(month) {
      return selectMonth.all(`${month}-01`, `${nextMonthOf(month)}-01`)
    },
    dayTotal(day) {
      return selectTotal.get(day) || null
    },
    day(day, kind, limit) {
      return selectKind.all(day, kind, limit)
    },
    daySum(day, kind) {
      return sumKind.get(day, kind) || { n: 0, up: 0, down: 0 }
    },
    prune(beforeDay) {
      deleteBefore.run(beforeDay)
    },
  }
}

export const createTrafficCollector = ({
  store,
  fetchImpl = globalThis.fetch,
  getSecret = () => '',
  baseUrl = 'http://127.0.0.1:9095',
  intervalMs = 2000,
  retryMs = 10_000,
  flushMs = 60_000,
  keepDays = 400,
  now = () => new Date(),
  log = () => {},
}) => {
  // 待写入的增量:key = day|kind|key
  const pending = new Map()
  // 上次快照里每条连接的累计字节,id → { up, down }
  const seen = new Map()
  let primed = false
  let lastUp = 0
  let lastDown = 0
  let failures = 0
  let stopped = true
  let pollTimer = null
  let flushTimer = null
  let pruneTimer = null

  const bump = (day, kind, key, up, down, conns) => {
    if (!up && !down && !conns) return
    const id = `${day}|${kind}|${key}`
    const row = pending.get(id)
    if (row) {
      row.up += up
      row.down += down
      row.conns += conns
    } else {
      pending.set(id, { day, kind, key, up, down, conns })
    }
  }

  // 一次快照:和上次比,把增量记到 at 这一天。第一次只做基线不计数——面板重启时
  // 内核可能一直在跑,之前的字节早被上一个面板进程记过了,再算一遍就重复。
  const applySnapshot = (body, at = now()) => {
    const day = localDay(at)
    const list = body && Array.isArray(body.connections) ? body.connections : []
    const up = toInt(body && body.uploadTotal)
    const down = toInt(body && body.downloadTotal)

    if (!primed) {
      for (const c of list) {
        if (c && c.id) seen.set(String(c.id), { up: toInt(c.upload), down: toInt(c.download) })
      }
      lastUp = up
      lastDown = down
      primed = true
      return
    }

    // 内核重启计数会归零:比上次小就当作从 0 起算
    bump(day, 'total', '', up >= lastUp ? up - lastUp : up, down >= lastDown ? down - lastDown : down, 0)
    lastUp = up
    lastDown = down

    const alive = new Set()
    for (const c of list) {
      if (!c || !c.id) continue
      const id = String(c.id)
      alive.add(id)
      const cu = toInt(c.upload)
      const cd = toInt(c.download)
      const prev = seen.get(id)
      const isNew = !prev
      let du = cu
      let dd = cd
      if (prev) {
        du = cu >= prev.up ? cu - prev.up : cu
        dd = cd >= prev.down ? cd - prev.down : cd
      }
      seen.set(id, { up: cu, down: cd })
      const conns = isNew ? 1 : 0
      if (!du && !dd && !conns) continue
      bump(day, 'total', '', 0, 0, conns)
      bump(day, 'node', leafOf(c.chains), du, dd, conns)
      bump(day, 'host', hostOf(c.metadata), du, dd, conns)
    }
    for (const id of seen.keys()) {
      if (!alive.has(id)) seen.delete(id)
    }
  }

  // 把攒的增量写库;写失败放回去下次再试,不能丢
  const flush = () => {
    if (!pending.size) return 0
    const rows = [...pending.values()]
    pending.clear()
    try {
      store.add(rows)
    } catch (err) {
      for (const r of rows) bump(r.day, r.kind, r.key, r.up, r.down, r.conns)
      log(`[traffic] 写入流量记录失败:${err instanceof Error ? err.message : err}`)
      return 0
    }
    return rows.length
  }

  const prune = () => {
    try {
      const d = now()
      d.setDate(d.getDate() - keepDays)
      store.prune(localDay(d))
    } catch (err) {
      log(`[traffic] 清理旧记录失败:${err instanceof Error ? err.message : err}`)
    }
  }

  const poll = async () => {
    try {
      const secret = getSecret()
      const res = await fetchImpl(`${baseUrl}/connections`, {
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      applySnapshot(await res.json())
      if (failures) log('[traffic] 连接表恢复可读,继续采集')
      failures = 0
    } catch (err) {
      failures += 1
      // 内核没启动时每次都失败,只在第一次说一声
      if (failures === 1) log(`[traffic] 读不到内核连接表(内核没在跑?):${err instanceof Error ? err.message : err}`)
    }
  }

  const schedule = () => {
    if (stopped) return
    pollTimer = setTimeout(async () => {
      await poll()
      schedule()
    }, failures ? retryMs : intervalMs)
    pollTimer.unref?.()
  }

  const start = () => {
    if (!stopped) return
    stopped = false
    prune()
    schedule()
    flushTimer = setInterval(flush, flushMs)
    flushTimer.unref?.()
    pruneTimer = setInterval(prune, 24 * 60 * 60 * 1000)
    pruneTimer.unref?.()
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimeout(pollTimer)
    clearInterval(flushTimer)
    clearInterval(pruneTimer)
    flush()
  }

  return { store, start, stop, flush, applySnapshot, poll, get pendingSize() { return pending.size } }
}
