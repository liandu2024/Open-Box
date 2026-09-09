// 每日流量采集。
//
// sing-box 自己不存历史流量:clash API 只有"当前连接表"(/connections,每条连接带累计
// upload/download)和两个自内核启动以来的总计数(uploadTotal/downloadTotal)。要画"每日
// 流量"并且能下钻到节点、域名,面板得自己常驻采样:每 intervalMs 读一次连接表,和上一次
// 比出增量,按"当天 / 节点 / 域名或 IP"三个维度累加,攒够 flushMs 一次写进 sqlite。
//
// 精度说明(前端"未采样到的短连接"那一行就是这么来的):
// - 当天总量用内核的 uploadTotal/downloadTotal 增量,再减去采样到的 dnsmasq 回环部分
//   (见下面 applySnapshot 里的说明);
// - 节点/域名的分量只能从连接表逐条比增量,存活不到一个采样周期的连接根本看不见,
//   连接关闭前最后不到一个周期的字节也会丢。总量 − 各节点之和 = 这部分误差。
//
// 方向:clash API 的 upload = 发往外网的字节(出口),download = 从外网收到的(入口)。
// 库里和接口里一律叫 up/down,前端再翻成 入口/出口。

import { DNSMASQ_OUTBOUND_TAG } from '../engine/config.mjs'

const pad2 = (n) => String(n).padStart(2, '0')

// 分析数据保留时长(月):默认半年,允许 1~36
export const DEFAULT_KEEP_MONTHS = 3
export const MIN_KEEP_MONTHS = 1
export const MAX_KEEP_MONTHS = 36
export const normalizeKeepMonths = (v) => {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return DEFAULT_KEEP_MONTHS
  return Math.min(MAX_KEEP_MONTHS, Math.max(MIN_KEEP_MONTHS, n))
}

// 都按面板进程的本地时间算天:路由器上 TZ 跟 OpenWrt 系统一致,前端拿服务端给的 today 做高亮,
// 不自己算,免得浏览器和路由器时区不一样。
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
// 小时明细:同一份增量除了按天记一份,还按「天@小时」再记一份(day 列写成 2026-09-05@17),
// 按天的查询、下钻、清理全部照用;只有 total 不写这种行——月视图按 kind='total' 扫日期范围,
// 不能混进来,小时的总量在 kind='hour' 那一行。这种行占空间(一天几万行),只保留最近几天。
export const HOUR_DETAIL_KEEP_DAYS = 7
export const hourDayKey = (day, hour) => `${day}@${pad2(hour)}`

// sing-box 的 chains 是 [末端节点, ..., 顶层策略](和 clash 一样,tracker 里 Reverse 过)
export const leafOf = (chains) => (Array.isArray(chains) && chains.length ? String(chains[0] ?? '') : '')

// 访问终端:局域网里发起连接的设备,按来源 IP 记
export const clientOf = (metadata) => {
  const m = metadata && typeof metadata === 'object' ? metadata : {}
  return String(m.sourceIP || '').trim()
}

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

// 两维交叉的明细:kind 是 client_host | client_node | node_host,key 是「前一维\t后一维」。
// 面板里点开一条终端/节点/访问目标,就按这三张交叉表查它由什么构成。
export const PAIR_SEP = '\t'
const PAIR_KINDS = {
  client: { host: ['client_host', 0], node: ['client_node', 0] },
  node: { client: ['client_node', 1], host: ['node_host', 0] },
  host: { client: ['client_host', 1], node: ['node_host', 1] },
}
// 给定「我是哪一维、要按哪一维拆」,返回交叉表的 kind 和我在 key 里的位置(0 前 1 后)
export const pairKindFor = (kind, by) => (PAIR_KINDS[kind] && PAIR_KINDS[kind][by]) || null
export const PAIR_KIND_NAMES = ['client_host', 'client_node', 'node_host']

// sqlite 落地。表按 (day, kind, key) 唯一,kind ∈ total | node | host | client | 上面三种交叉,total 的 key 是空串。
// 写入全是"加上增量"的 upsert,所以内存里只用攒增量,不用记绝对值。
// node:sqlite 查出来的是无原型对象,整理成普通对象再往外交(deepEqual、JSON 都省心)
const plain = (row) => ({ ...row })

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
  // 交叉表按前一维查:key 以「x\t」开头,用主键范围扫(\n 是紧挨着 \t 的下一个字符)
  const selectPairHead = db.prepare(`
    SELECT substr(key, length(?1) + 2) AS key, up, down, conns FROM traffic_daily
    WHERE day = ?2 AND kind = ?3 AND key >= ?1 || char(9) AND key < ?1 || char(10)
    ORDER BY (up + down) DESC, key LIMIT ?4
  `)
  const countPairHead = db.prepare(`
    SELECT COUNT(*) AS n FROM traffic_daily
    WHERE day = ?2 AND kind = ?3 AND key >= ?1 || char(9) AND key < ?1 || char(10)
  `)
  // 按后一维查:key 以「\tx」结尾
  const selectPairTail = db.prepare(`
    SELECT substr(key, 1, length(key) - length(?1) - 1) AS key, up, down, conns FROM traffic_daily
    WHERE day = ?2 AND kind = ?3 AND substr(key, -length(?1) - 1) = char(9) || ?1
    ORDER BY (up + down) DESC, key LIMIT ?4
  `)
  const countPairTail = db.prepare(`
    SELECT COUNT(*) AS n FROM traffic_daily
    WHERE day = ?2 AND kind = ?3 AND substr(key, -length(?1) - 1) = char(9) || ?1
  `)
  // 构成的合计(不受 limit 影响):父行总量减它就是"没记到交叉表里的部分"
  const sumPairHead = db.prepare(`
    SELECT COALESCE(SUM(up), 0) AS up, COALESCE(SUM(down), 0) AS down FROM traffic_daily
    WHERE day = ?2 AND kind = ?3 AND key >= ?1 || char(9) AND key < ?1 || char(10)
  `)
  const sumPairTail = db.prepare(`
    SELECT COALESCE(SUM(up), 0) AS up, COALESCE(SUM(down), 0) AS down FROM traffic_daily
    WHERE day = ?2 AND kind = ?3 AND substr(key, -length(?1) - 1) = char(9) || ?1
  `)
  // 24 小时曲线:kind='hour',key 是两位小时,值是内核计数器在那个小时里的增量(和 total 同源)
  const selectHours = db.prepare(`SELECT key AS hour, up, down, conns FROM traffic_daily WHERE day = ? AND kind = 'hour' ORDER BY key`)
  // 某个出站(比如内置直连)按天 / 按月 / 按小时的量:概览「统计直连流量」关掉时从总量里扣掉它用。
  // 按月要跳过「天@小时」那些行(它们也是 kind='node'),不然重复计
  const selectNodeRow = db.prepare(`SELECT up, down, conns FROM traffic_daily WHERE day = ? AND kind = 'node' AND key = ?`)
  const selectMonthNode = db.prepare(`
    SELECT day, up, down, conns FROM traffic_daily
    WHERE kind = 'node' AND key = ? AND day >= ? AND day < ? AND instr(day, '@') = 0 ORDER BY day
  `)
  const selectNodeHours = db.prepare(`
    SELECT day, up, down, conns FROM traffic_daily
    WHERE kind = 'node' AND key = ? AND day >= ? || '@00' AND day <= ? || '@23'
  `)
  const deleteBefore = db.prepare(`DELETE FROM traffic_daily WHERE day < ?`)
  // 某一天的小时明细行(day 是「那天@HH」)在主键上紧挨在那天后面:> '那天' 且 < '那天~'
  const deleteHourDetailOfDay = db.prepare(`DELETE FROM traffic_daily WHERE day > ?1 AND day < ?1 || '~'`)
  // 「天@小时」的明细行和按天的行混在一张表里:天数、最早 / 最新那天只数按天的行(不然每天 24 个小时
  // 桶都算一「天」,正式路由器装了 5 天显示「已存 101 天」);字节数按天 / 按小时分开给,小时明细只留
  // HOUR_DETAIL_KEEP_DAYS 天,估算存满要多大时不能按它的日增量乘整个保留时长
  const usageStat = db.prepare(`
    SELECT COUNT(*) AS rows,
           COUNT(DISTINCT CASE WHEN instr(day, '@') = 0 THEN day END) AS days,
           MIN(CASE WHEN instr(day, '@') = 0 THEN day END) AS oldestDay,
           MAX(CASE WHEN instr(day, '@') = 0 THEN day END) AS newestDay,
           COALESCE(SUM(CASE WHEN instr(day, '@') = 0 THEN LENGTH(key) + LENGTH(kind) + 40 ELSE 0 END), 0) AS dayBytes,
           COALESCE(SUM(CASE WHEN instr(day, '@') > 0 THEN LENGTH(key) + LENGTH(kind) + 40 ELSE 0 END), 0) AS hourBytes,
           COUNT(DISTINCT CASE WHEN instr(day, '@') > 0 THEN substr(day, 1, 10) END) AS hourDays
    FROM traffic_daily
  `)

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
      return selectMonth.all(`${month}-01`, `${nextMonthOf(month)}-01`).map(plain)
    },
    dayTotal(day) {
      const r = selectTotal.get(day)
      return r ? plain(r) : null
    },
    // 某个出站这一天(或「天@小时」)的量,没有就 null
    nodeRow(day, key) {
      const r = selectNodeRow.get(day, key)
      return r ? plain(r) : null
    },
    // 某个出站整月每天的量(只有按天的行)
    monthNode(month, key) {
      return selectMonthNode.all(key, `${month}-01`, `${nextMonthOf(month)}-01`).map(plain)
    },
    // 某个出站这一天 24 个小时桶的量:Map<小时, {up, down, conns}>,没记录的小时没有键
    nodeHours(day, key) {
      return new Map(selectNodeHours.all(key, day, day).map((r) => [Number(String(r.day).slice(11)), { up: Number(r.up) || 0, down: Number(r.down) || 0, conns: Number(r.conns) || 0 }]))
    },
    // 一天 24 个小时桶,没记录的小时补 0
    hours(day) {
      const byHour = new Map(selectHours.all(day).map((r) => [Number(r.hour), r]))
      return Array.from({ length: 24 }, (_, hour) => {
        const r = byHour.get(hour)
        return { hour, up: r ? Number(r.up) || 0 : 0, down: r ? Number(r.down) || 0 : 0, conns: r ? Number(r.conns) || 0 : 0 }
      })
    },
    day(day, kind, limit) {
      return selectKind.all(day, kind, limit).map(plain)
    },
    daySum(day, kind) {
      const r = sumKind.get(day, kind)
      return r ? plain(r) : { n: 0, up: 0, down: 0 }
    },
    // 一条记录的构成:kind/key 是点开的那条,by 是要拆成哪一维
    drill(day, kind, key, by, limit) {
      const pair = pairKindFor(kind, by)
      if (!pair) return { rows: [], count: 0, sum: { up: 0, down: 0 } }
      const [pairKind, pos] = pair
      const select = pos === 0 ? selectPairHead : selectPairTail
      const count = pos === 0 ? countPairHead : countPairTail
      const sum = (pos === 0 ? sumPairHead : sumPairTail).get(key, day, pairKind) || {}
      return {
        rows: select.all(key, day, pairKind, limit).map(plain),
        count: Number((count.get(key, day, pairKind) || {}).n) || 0,
        sum: { up: Number(sum.up) || 0, down: Number(sum.down) || 0 },
      }
    },
    prune(beforeDay) {
      deleteBefore.run(beforeDay)
    },
    // 删掉某一天的小时明细(按天的那份不动)
    pruneHourDetail(day) {
      deleteHourDetailOfDay.run(day)
    },
    // 「分析数据保留时长」那张卡片要显示的东西:存了多少天、多少行、大概占多大。
    // 字节数是估的:键本身的长度 + 每行 40 字节(日期、三个整数、页内开销)。和把某一天
    // 的行复制进空库量出来的实际占用对得上(实测差 5% 以内)。days / oldestDay / newestDay
    // 只看按天的行;dayBytes / hourBytes 分别是按天的行和「天@小时」明细行的占用,hourDays
    // 是有小时明细的天数
    usage() {
      const r = usageStat.get() || {}
      const rows = Number(r.rows) || 0
      const dayBytes = Number(r.dayBytes) || 0
      const hourBytes = Number(r.hourBytes) || 0
      return {
        rows,
        days: Number(r.days) || 0,
        oldestDay: r.oldestDay || '',
        newestDay: r.newestDay || '',
        bytes: dayBytes + hourBytes,
        dayBytes,
        hourBytes,
        hourDays: Number(r.hourDays) || 0,
      }
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
  // 分析数据保留多少个月(面板「后端设置」里可改,1~36,默认 6)。曲线、排行和下钻构成
  // 用同一个期限:分开留会出现"曲线上有这一天、点开却没有构成"的怪事。
  getKeepMonths = () => DEFAULT_KEEP_MONTHS,
  now = () => new Date(),
  log = () => {},
}) => {
  // 待写入的增量:key = day|kind|key。写库连续失败时最多攒这么多条(约几 MB),再多就丢
  const MAX_PENDING = 20_000
  let flushFailing = false
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
    const totalUp = up >= lastUp ? up - lastUp : up
    const totalDown = down >= lastDown ? down - lastDown : down
    lastUp = up
    lastDown = down

    // 经 dnsmasq 回环出站的那些不算流量:它是绑在 lo 上的专用直连,只把发往 tun 网段
    // 53 端口的 DNS 查询交回路由器自己的 dnsmasq(见 engine/routing.mjs),字节根本没
    // 出过路由器。dnsmasq 接管模式下局域网每一次域名解析都从这里过,量还不小——正式
    // 路由器上一天 4.9 万条连接、14.8 GB,占了当天"出口"的三分之二,全是假的。
    // 内核的 uploadTotal/downloadTotal 把它算在内,所以总量也要把采样到的这部分减掉。
    let loopUp = 0
    let loopDown = 0
    const hh = pad2(at.getHours())
    const hday = hourDayKey(day, at.getHours())

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
      const node = leafOf(c.chains)
      if (node === DNSMASQ_OUTBOUND_TAG) {
        loopUp += du
        loopDown += dd
        continue
      }
      const host = hostOf(c.metadata)
      const client = clientOf(c.metadata)
      bump(day, 'total', '', 0, 0, conns)
      bump(day, 'hour', hh, 0, 0, conns)
      // 同一份增量记两遍:按天一份,按「天@小时」一份(小时明细,见 hourDayKey 的说明)
      for (const d of [day, hday]) {
        bump(d, 'node', node, du, dd, conns)
        bump(d, 'host', host, du, dd, conns)
        bump(d, 'client', client, du, dd, conns)
        bump(d, 'client_host', client + PAIR_SEP + host, du, dd, conns)
        bump(d, 'client_node', client + PAIR_SEP + node, du, dd, conns)
        bump(d, 'node_host', node + PAIR_SEP + host, du, dd, conns)
      }
    }
    // 总量减掉回环那部分。只能减"采样到的"——活不满一个采样周期的回环查询仍留在内核
    // 计数器里,和其它短连接一样进不了明细,这是采样精度的固有取舍(见文件开头)。
    // 连接数不用另外扣:回环的连接在上面 continue 掉了,本来就没进 total 的计数
    bump(day, 'total', '', Math.max(0, totalUp - loopUp), Math.max(0, totalDown - loopDown), 0)
    // 同一份增量再按采样时刻落进小时桶,给概览的 24 小时曲线用;一天只多 24 行
    bump(day, 'hour', hh, Math.max(0, totalUp - loopUp), Math.max(0, totalDown - loopDown), 0)

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
      // 放回去下次再试——但不能无限攒:闪存写满时每次都失败,pending 会一直长到把面板
      // 进程撑爆。超过上限就丢掉这批(丢的是统计,不是配置),并且只在第一次失败时记日志。
      if (pending.size + rows.length <= MAX_PENDING) {
        for (const r of rows) bump(r.day, r.kind, r.key, r.up, r.down, r.conns)
      }
      if (!flushFailing) log(`[traffic] 写入流量记录失败:${err instanceof Error ? err.message : err}`)
      flushFailing = true
      return 0
    }
    flushFailing = false
    return rows.length
  }

  let hourPruneWide = true
  // 上次清理是哪一天、按几个月清的:清理一天跑一次就够,但用户改了保留时长要马上按新期限来
  let lastPruneDay = ''
  let lastKeepMonths = null
  const prune = () => {
    try {
      const months = normalizeKeepMonths(getKeepMonths())
      // 拷一份再算:别就地改 now() 给的对象
      const d = new Date(now())
      d.setMonth(d.getMonth() - months)
      lastPruneDay = localDay(now())
      lastKeepMonths = months
      store.prune(localDay(d))
      // 小时明细只留最近 HOUR_DETAIL_KEEP_DAYS 天:按天做主键范围删,平时只看期限附近几天;
      // 第一次跑扫宽一点,补上停机期间没删掉的
      if (store.pruneHourDetail) {
        const span = hourPruneWide ? 60 : 3
        hourPruneWide = false
        for (let i = 0; i < span; i++) {
          const c = new Date(now())
          c.setDate(c.getDate() - HOUR_DETAIL_KEEP_DAYS - i)
          store.pruneHourDetail(localDay(c))
        }
      }
    } catch (err) {
      log(`[traffic] 清理旧记录失败:${err instanceof Error ? err.message : err}`)
    }
  }
  // 每分钟跟着 flush 看一眼:跨天了、或者保留时长改了,才真的去删
  const maybePrune = () => {
    if (localDay(now()) !== lastPruneDay || normalizeKeepMonths(getKeepMonths()) !== lastKeepMonths) prune()
  }
  const tick = () => {
    flush()
    maybePrune()
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
    // 每分钟写一次库;清理只在跨天或改了保留时长时才做(见 maybePrune)
    flushTimer = setInterval(tick, flushMs)
    flushTimer.unref?.()
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimeout(pollTimer)
    clearInterval(flushTimer)
    flush()
  }

  return { store, start, stop, flush, prune, tick, applySnapshot, poll, get pendingSize() { return pending.size } }
}
