// 从内核的 debug 日志流里截出「这一条域名查询」在内核里的实际处理过程——规则页「真实路由 · 模拟终端」
// 的 DNS 一站要回答的不只是"LAN 的 DNS 是谁应答的",还有下一层:进了内核之后命中哪条 DNS 规则、交给哪个
// 解析器、是路由器自己直接问上游还是经哪个节点发出去的、上游回了什么、耗时多少。这些都不推算,只认内核
// 自己写的日志(sing-box 1.14,level=debug):
//   [id 0ms] inbound/direct[dns-in]: inbound packet connection from 192.168.3.167:49426
//   [id 0ms] dns: exchange chatgpt.com. IN A
//   [id 0ms] dns: match[9] rule_set=geosite-category-ai-!cn => route(dns-policy-4)
//   [id 0ms] outbound/tuic[VW | 英国-HOME-02]: outbound connection to 1.1.1.1:53
//   [id 270ms] dns: exchanged chatgpt.com NOERROR 300
//   [id 270ms] dns: exchanged A chatgpt.com. 300 IN A 104.18.32.47
//   [id 12ms] dns: exchanged A www.a.shifen.com. 44 IN A 183.240.99.224   ← 经 CNAME 的答案,owner 不是查的域名
//   [id 0ms] dns: strategy rejected                      ← AAAA 被 IPv6 策略挡下
//   [id 5.0s] dns: exchange failed for x.com IN A: …     ← 上游没答
// A 和 AAAA 是两条独立的入站连接(各自一个 id),按类型分别取;同一时间窗里别的终端也可能在查同一个
// 域名,优先取来源是探测终端(hijack 模式)或本机(dnsmasq 转发)的那条,再退到最后一条。
import { WebSocket } from 'ws'
import { CLASH_API_BASE } from '../api/penetration.mjs'

// sing-box 的时长写法:0ms / 270ms / 2.49s / 1m2s
export const elapsedMs = (text) => {
  const s = String(text || '').trim()
  if (/^\d+ms$/.test(s)) return Number(s.slice(0, -2))
  const sec = /^(\d+)(?:\.(\d{1,3}))?s$/.exec(s)
  if (sec) return Number(sec[1]) * 1000 + Math.round(Number(`0.${sec[2] || '0'}`) * 1000)
  const min = /^(\d+)m(\d+)s$/.exec(s)
  return min ? (Number(min[1]) * 60 + Number(min[2])) * 1000 : null
}

const parseLine = (payload) => {
  const m = /^\[(\d+) ([^\]]+)\] (.+)$/.exec(String(payload || ''))
  return m ? { id: m[1], ms: elapsedMs(m[2]), text: m[3] } : null
}
const stripDot = (name) => String(name || '').toLowerCase().replace(/\.$/, '')
const hostOf = (addr) => String(addr || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '')

const newRecord = (type) => ({ type, source: '', ruleIndex: null, ruleText: '', action: '', server: '', outbound: null, result: 'pending', rcode: '', ttl: null, answers: [], ms: null, error: '' })

// lines:日志的 payload 字符串;domain:要找的域名;preferSources:优先认这些来源发出的查询
export const traceDnsQuery = (lines, domain, { preferSources = [] } = {}) => {
  const name = stripDot(domain)
  const sources = new Map()
  const records = new Map() // id -> record(只登记 exchange 命中目标域名的 id)
  const order = []
  for (const raw of lines || []) {
    const line = parseLine(raw)
    if (!line) continue
    const { id, ms, text } = line
    const from = /^inbound\/[^:]+: inbound (?:packet )?connection from (.+)$/.exec(text)
    if (from) { sources.set(id, hostOf(from[1])); continue }
    const start = /^dns: exchange (\S+) IN ([A-Z0-9]+)$/.exec(text)
    if (start) {
      if (stripDot(start[1]) !== name) continue
      const rec = newRecord(start[2])
      rec.source = sources.get(id) || ''
      records.set(id, rec)
      order.push(id)
      continue
    }
    const rec = records.get(id)
    if (!rec) continue
    const matched = /^dns: match\[(\d+)\]\s*(.*?)\s*=> (.+)$/.exec(text)
    if (matched) {
      rec.ruleIndex = Number(matched[1])
      rec.ruleText = matched[2]
      rec.action = matched[3]
      const route = /^route\((.+)\)$/.exec(matched[3])
      rec.server = route ? route[1] : ''
      if (!route) { rec.result = 'action'; rec.ms = ms }
      continue
    }
    const dial = /^outbound\/([^[]+)\[(.+)\]: outbound (?:packet )?connection to (.+)$/.exec(text)
    if (dial) { rec.outbound = { type: dial[1], tag: dial[2], to: dial[3] }; continue }
    const done = /^dns: (exchanged|cached|optimistic) (\S+) (NOERROR|NXDOMAIN|SERVFAIL|REFUSED|FORMERR|NOTIMP)(?: (\d+))?/.exec(text)
    if (done && stripDot(done[2]) === name) {
      rec.result = done[1]
      rec.rcode = done[3]
      rec.ttl = done[4] !== undefined ? Number(done[4]) : null
      rec.ms = ms
      continue
    }
    // 答案行按 id 归属,不看 owner:经 CNAME 解析出来的 A 记录 owner 是别名目标(www.a.shifen.com),不是查的域名
    const answer = /^dns: (?:exchanged|cached|optimistic) (A|AAAA) \S+ \d+ IN (?:A|AAAA) (\S+)$/.exec(text)
    if (answer) { rec.answers.push(answer[2]); continue }
    const failed = /^dns: exchange failed for (\S+) IN ([A-Z0-9]+): (.+)$/.exec(text)
    if (failed) { if (stripDot(failed[1]) === name) { rec.result = 'failed'; rec.error = failed[3]; rec.ms = ms }; continue }
    if (/^dns: strategy rejected$/.test(text)) { rec.result = 'rejected'; rec.ms = ms }
  }
  const pick = (type) => {
    const list = order.map((id) => records.get(id)).filter((r) => r.type === type)
    if (!list.length) return null
    const preferred = list.filter((r) => r.source && preferSources.includes(r.source))
    return (preferred.length ? preferred : list).at(-1)
  }
  const A = pick('A')
  const AAAA = pick('AAAA')
  return { seen: Boolean(A || AAAA), A, AAAA }
}

// 开一条到内核日志流的连接,把 payload 一行行攒起来;ready 在连上(true)或失败 / 超时(false)时决议。
// 内核没在跑、clash_api 没开时 ready=false、error 里是原因,调用方如实报"看不到内核侧过程",不猜
export const openKernelLogTap = ({ secret = '', url = `${CLASH_API_BASE.replace(/^http/, 'ws')}/logs?level=debug`, WebSocketImpl = WebSocket, connectTimeoutMs = 2000 } = {}) => {
  const lines = []
  let socket = null
  let opened = false
  let error = ''
  const ready = new Promise((resolve) => {
    const timer = setTimeout(() => { if (!opened) { error = error || 'log stream timeout'; resolve(false) } }, connectTimeoutMs)
    try {
      socket = new WebSocketImpl(url, { headers: secret ? { Authorization: `Bearer ${secret}` } : {}, handshakeTimeout: connectTimeoutMs })
      socket.on('open', () => { opened = true; clearTimeout(timer); resolve(true) })
      socket.on('message', (raw) => {
        try {
          const entry = JSON.parse(raw.toString())
          if (entry && typeof entry.payload === 'string') lines.push(entry.payload)
        } catch { /* 不是日志行 */ }
      })
      socket.on('error', (err) => { error = (err && err.message) || 'log stream error'; clearTimeout(timer); resolve(false) })
      socket.on('close', () => { clearTimeout(timer); resolve(opened) })
    } catch (err) {
      error = (err && err.message) || String(err)
      clearTimeout(timer)
      resolve(false)
    }
  })
  return {
    ready,
    lines,
    get error() { return error },
    close: () => {
      if (!socket) return
      try { socket.removeAllListeners(); socket.on('error', () => {}); socket.terminate() } catch { /* 已经关了 */ }
      socket = null
    },
  }
}
