import { WebSocket } from 'ws'

const HOUR = 3600000
const DAY = 24 * HOUR
const bucket = (at) => Math.floor(at / HOUR) * HOUR

// Query detail is bounded (24 hours / 20k rows). Aggregates have their own retention and are
// not computed from the truncated detail table. Batch writes avoid a flash write per query.
export const createDnsFilterStore = (db, { now = Date.now } = {}) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dns_filter_hours (hour INTEGER PRIMARY KEY, queries INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, elapsed REAL NOT NULL DEFAULT 0, timed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS dns_filter_domains (hour INTEGER, domain TEXT, count INTEGER NOT NULL, PRIMARY KEY(hour,domain));
    CREATE TABLE IF NOT EXISTS dns_filter_records (id INTEGER PRIMARY KEY, at INTEGER, domain TEXT, qtype TEXT, source TEXT, result TEXT, list TEXT, elapsed REAL);
    CREATE INDEX IF NOT EXISTS dns_filter_records_at ON dns_filter_records(at);
  `)
  const hourSql = db.prepare('INSERT INTO dns_filter_hours VALUES (?,?,?,?,?) ON CONFLICT(hour) DO UPDATE SET queries=queries+excluded.queries, blocked=blocked+excluded.blocked, elapsed=elapsed+excluded.elapsed, timed=timed+excluded.timed')
  const domainSql = db.prepare('INSERT INTO dns_filter_domains VALUES (?,?,?) ON CONFLICT(hour,domain) DO UPDATE SET count=count+excluded.count')
  const recordSql = db.prepare('INSERT INTO dns_filter_records (at,domain,qtype,source,result,list,elapsed) VALUES (?,?,?,?,?,?,?)')
  let hours = new Map(), domains = new Map(), rows = [], pruned = 0
  const hour = (at) => { const key = bucket(at); if (!hours.has(key)) hours.set(key, { queries: 0, blocked: 0, elapsed: 0, timed: 0 }); return hours.get(key) }
  const flush = () => {
    db.exec('BEGIN')
    try {
      for (const [key, h] of hours) hourSql.run(key, h.queries, h.blocked, h.elapsed, h.timed)
      for (const d of domains.values()) domainSql.run(d.hour, d.domain, d.count)
      for (const r of rows) recordSql.run(r.at, r.domain, r.qtype, r.source || '', r.result, r.list || '', r.elapsed ?? null)
      if (now() - pruned > 60000) {
        db.prepare('DELETE FROM dns_filter_hours WHERE hour < ?').run(bucket(now()) - DAY)
        db.prepare('DELETE FROM dns_filter_domains WHERE hour < ?').run(bucket(now()) - DAY)
        db.prepare('DELETE FROM dns_filter_records WHERE at < ? OR id < (SELECT COALESCE(MAX(id),0)-19999 FROM dns_filter_records)').run(now() - DAY)
        // Worst-case distinct blocked domains is bounded independently of query rate.
        db.exec('DELETE FROM dns_filter_domains WHERE rowid IN (SELECT rowid FROM dns_filter_domains ORDER BY hour DESC, count DESC LIMIT -1 OFFSET 50000)')
        pruned = now()
      }
      db.exec('COMMIT')
      hours = new Map(); domains = new Map(); rows = []
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  return {
    start: (at) => { hour(at).queries++ },
    finish: (row) => {
      const h = hour(row.at)
      if (row.result === 'blocked') {
        h.blocked++
        const key = `${bucket(row.at)}:${row.domain}`
        if (!domains.has(key) && domains.size < 5000) domains.set(key, { hour: bucket(row.at), domain: row.domain, count: 0 })
        if (domains.has(key)) domains.get(key).count++
      }
      if (Number.isFinite(row.elapsed) && row.result !== 'blocked') { h.elapsed += row.elapsed; h.timed++ }
      rows.push(row)
      if (rows.length > 2000) rows.shift()
    },
    flush,
    summary: () => {
      flush()
      const since = bucket(now()) - 23 * HOUR
      const data = db.prepare('SELECT * FROM dns_filter_hours WHERE hour >= ? ORDER BY hour').all(since)
      const hourly = Array.from({ length: 24 }, (_, i) => data.find((h) => h.hour === since + i * HOUR) || { hour: since + i * HOUR, queries: 0, blocked: 0, elapsed: 0, timed: 0 })
      const sum = hourly.reduce((a, h) => ({ queries: a.queries + h.queries, blocked: a.blocked + h.blocked, elapsed: a.elapsed + h.elapsed, timed: a.timed + h.timed }), { queries: 0, blocked: 0, elapsed: 0, timed: 0 })
      return { ...sum, averageMs: sum.timed ? sum.elapsed / sum.timed : null, hourly, topDomains: db.prepare('SELECT domain,SUM(count) AS count FROM dns_filter_domains WHERE hour >= ? GROUP BY domain ORDER BY count DESC LIMIT 5').all(since) }
    },
    records: ({ search = '', result = '', page = 1, pageSize = 20 } = {}) => {
      flush()
      const requestedSize = Number(pageSize)
      const size = Number.isFinite(requestedSize) && requestedSize >= 1 ? Math.min(1000, Math.trunc(requestedSize)) : 20
      const requestedPage = Number(page)
      const where = 'at >= ? AND instr(domain, ?) > 0 AND (? = \'\' OR result = ?)'
      const params = [now() - DAY, String(search).toLowerCase().slice(0, 253), String(result), String(result)]
      const total = db.prepare(`SELECT COUNT(*) AS count FROM dns_filter_records WHERE ${where}`).get(...params).count
      const lastPage = Math.max(1, Math.ceil(total / size))
      const p = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.min(lastPage, Math.trunc(requestedPage)) : 1
      return { page: p, pageSize: size, total, rows: db.prepare(`SELECT * FROM dns_filter_records WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, size, (p - 1) * size) }
    },
  }
}

const elapsedMs = (text) => {
  if (/^\d+ms$/.test(text)) return Number(text.slice(0, -2))
  // sing-box FormatDuration prints hundredths as an unpadded integer: "1.5s" = 1050ms.
  const seconds = text.match(/^(\d+)\.(\d{1,2})s$/)
  if (seconds) return Number(seconds[1]) * 1000 + Number(seconds[2]) * 10
  const parts = text.match(/^(\d+)m(\d+)s$/)
  return parts ? (Number(parts[1]) * 60 + Number(parts[2])) * 1000 : null
}

// Native debug stream is observable even while the core's file log stays at warn. No extra DNS
// forwarder, no change to source-IP matching, and no debug log file on router flash.
export const createDnsEventParser = ({ data, now = Date.now, rules = [], names = {} }) => {
  const pending = new Map(), sources = new Map()
  const filterNames = new Map()
  const tags = (rule) => [...(rule?.rule_set || []), ...(rule?.rules || []).flatMap(tags)]
  rules.forEach((r, i) => { const tag = tags(r).find((t) => names[t]); if (tag && r.action === 'predefined' && r.rcode === 'NXDOMAIN') filterNames.set(i, names[tag]) })
  const finish = (id, query, result, duration, list = '') => {
    const queue = pending.get(id) || []
    queue.splice(queue.indexOf(query), 1)
    if (!queue.length) pending.delete(id)
    data.finish({ ...query, result, list, elapsed: Number.isFinite(duration) && Number.isFinite(query.start) && duration >= query.start ? duration - query.start : null })
  }
  const drain = () => {
    for (const [id, queue] of pending) for (const q of [...queue]) finish(id, q, 'unknown', null)
    sources.clear()
  }
  return {
    drain,
    expire: () => { for (const [id, queue] of pending) for (const q of [...queue]) if (now() - q.at > 60000) finish(id, q, 'unknown', null) },
    accept: (entry) => {
      const m = String(entry.payload || '').match(/^\[(\d+) ([^\]]+)\] (.+)$/)
      if (!m) return
      const [, id, elapsed, text] = m
      const duration = elapsedMs(elapsed)
      const incoming = text.match(/^inbound\/[^:]+: inbound (?:packet )?connection from (.+)$/)
      if (incoming) {
        if (sources.size > 5000) sources.delete(sources.keys().next().value)
        sources.set(id, { source: incoming[1].replace(/:\d+$/, '').replace(/^\[|\]$/g, ''), at: now() })
      }
      const start = text.match(/^dns: exchange ([^ ]+) IN ([A-Z0-9]+)$/)
      if (start) {
        if (pending.size > 2048) drain()
        const queue = pending.get(id) || []
        if (queue.length >= 32) { finish(id, queue[0], 'unknown', null) }
        const source = sources.get(id)
        const q = { at: now(), domain: start[1].replace(/\.$/, '').toLowerCase(), qtype: start[2], source: source && now() - source.at < 60000 ? source.source : '', start: duration }
        queue.push(q); pending.set(id, queue); data.start(q.at)
        return
      }
      const queue = pending.get(id)
      if (!queue?.length) return
      const matched = text.match(/^dns: match\[(\d+)\].* => (.+)$/)
      if (matched) {
        const query = queue[queue.length - 1]
        const name = filterNames.get(Number(matched[1]))
        if (name) finish(id, query, 'blocked', duration, name)
        else if (/^(predefined|reject)/.test(matched[2])) finish(id, query, 'policy', duration)
        return
      }
      const complete = text.match(/^dns: (?:cached|exchanged|optimistic) ([^ ]+) (NOERROR|NXDOMAIN|SERVFAIL|REFUSED|FORMERR)(?: |$)/)
      const failed = text.match(/^dns: exchange failed for ([^ ]+) IN ([A-Z0-9]+):/)
      if (complete || failed) {
        const domain = (complete || failed)[1].replace(/\.$/, '').toLowerCase()
        const queries = queue.filter((q) => q.domain === domain && (!failed || q.qtype === failed[2]))
        if (queries.length) finish(id, queries[0], failed ? 'error' : complete[2] === 'NOERROR' ? 'allowed' : complete[2].toLowerCase(), queries.length === 1 ? duration : null)
      }
      for (const [key, entries] of pending) for (const q of [...entries]) if (now() - q.at > 60000) finish(key, q, 'unknown', null)
    },
  }
}

export const createDnsFilterObserver = ({ data, readConfig, getSecret, getNames, enabled, url = 'ws://127.0.0.1:9095/logs?level=debug', log = () => {} }) => {
  let socket, timer, parser, stopped = true, checking = false, version = '', connected = false
  const disconnect = () => { socket?.removeAllListeners(); socket?.on('error', () => {}); socket?.terminate(); socket = null; parser?.drain(); parser = null; connected = false }
  const tick = async () => {
    if (checking || stopped) return
    checking = true
    try {
      data.flush()
      if (!(await enabled())) { disconnect(); return }
      parser?.expire()
      const config = await readConfig()
      if (stopped) return
      const next = JSON.stringify(config.dns?.rules || [])
      if (next !== version) { disconnect(); version = next }
      if (socket) return
      parser = createDnsEventParser({ data, rules: config.dns?.rules, names: getNames() })
      socket = new WebSocket(url, { headers: { Authorization: `Bearer ${getSecret()}` }, handshakeTimeout: 4000 })
      socket.on('open', () => { connected = true })
      socket.on('message', (raw) => { try { parser?.accept(JSON.parse(raw.toString())) } catch { /* malformed unrelated log */ } })
      socket.on('error', () => {})
      socket.on('close', () => { parser?.drain(); parser = null; socket = null; connected = false })
    } catch (error) { disconnect(); log(`[dns-filter] 采集暂不可用: ${error.message}`) }
    finally { checking = false }
  }
  return {
    start: () => { stopped = false; tick(); timer = setInterval(tick, 2000); timer.unref?.() },
    stop: () => { stopped = true; clearInterval(timer); disconnect(); data.flush() },
    status: () => ({ connected }),
    tick,
  }
}
