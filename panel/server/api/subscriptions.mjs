import { randomUUID } from 'node:crypto'
import dns from 'node:dns/promises'
import express from 'express'
import { parseSubscription } from '../engine/subscription.mjs'
import { renameNodes, previewRename, excludeNodes } from '../engine/rename.mjs'
import { groupNodesByRegion } from '../engine/groups.mjs'
import { assertPublicUrl, pinnedLookup } from './net-guard.mjs'
import { subscriptionFetch } from '../system/insecure-fetch.mjs'
import { curlFetchText } from '../system/curl-fetch.mjs'

// 面板本身跑在网关上,订阅拉取又是"服务端发起、URL 客户端可控"的经典 SSRF 面——
// 不加限制的话可以拿它当跳板探测回环/内网端口。P4a 复审证明了仅做"字面 IP"层面拒绝远远
// 不够(域名不解析就直接放行、IPv6 十六进制形式的 IPv4-mapped 地址漏判、redirect 不复检
// 等四种绕过均有 PoC),所以这里改为:assertPublicUrl 真正解析 hostname(node:dns/promises
// lookup + {all:true}),对每一个解析出的地址都判定;拉取时手动处理重定向,每一跳都重新校验。
// 内网 / 本机地址放行(allowPrivate,GitHub #42):自建在局域网或路由器上的 subconverter 出的订阅地址
// 就是 192.168.x.x / 127.0.0.1,用户是面板管理员、本来就能拿路由器做任何事,拦着只是添堵;仍拒
// 未指定地址和链路本地,重定向逐跳校验、校验过的地址钉死建连这两道闸不动。
// 机场订阅端点普遍按 User-Agent 决定回什么:UA 里带 clash / sing-box 之类的关键字才
// 给对应格式的订阅,不认识的 UA 通常退回一份 base64 分享链接、有时干脆是网页。Node 的
// fetch 默认发 "User-Agent: node",没有任何机场会认——实测同一个订阅地址三种 UA 拿到
// 三份完全不同的响应(base64 8.5KB / Clash YAML 36KB / sing-box JSON 15KB)。
// 按信息量从高到低依次尝试,拿到能解析出节点的那一份就停:Clash YAML 字段最全(udp、
// 指纹、alpn 都在),sing-box JSON 次之,最后才退回默认 UA 那一份。
// 逐个试的 User-Agent:有些机场只认几个客户端的 UA,别的一律 403(GitHub #27)。前面是常见的
// 第三方客户端,最后才是我们自己的名字
const SUBSCRIPTION_USER_AGENTS = Object.freeze([
  'clash-verge/v2.0.0',
  'ClashMetaForAndroid/2.11.0',
  'mihomo/1.19.0',
  'clash-verge-rev/2.3.0',
  'sing-box/1.14.0',
  'Open-Box/1.0',
])

const SUBSCRIPTION_FETCH_TIMEOUT_MS = 15000
const MAX_SUBSCRIPTION_RESPONSE_BYTES = 5 * 1024 * 1024
// 粘贴保存下来的内容会跟着订阅记录一起进 store,并在每次改重命名规则时重新解析。
// 给个上限:store 是整条 JSON 读写的,塞进去一个几 MB 的配置会让每次读订阅列表都变慢。
const MAX_PASTED_CONTENT_BYTES = 1024 * 1024
const MAX_SUBSCRIPTION_REDIRECTS = 3

// 响应体大小上限:优先走真实 fetch 的可读流累计计数(边读边截断,避免恶意/超大响应把
// 进程内存吃满);测试注入的 fetchImpl 通常只给一个 text() 方法、没有可读流,退化为读完
// 整体后按字节长度校验——同一条上限,只是校验时机不同。
const readSubscriptionBody = async (res, maxBytes) => {
  const body = res.body

  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let received = 0
    let text = ''

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > maxBytes) {
          throw new Error(`subscription response exceeds ${maxBytes} byte limit`)
        }
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
      return text
    } finally {
      if (typeof reader.releaseLock === 'function') reader.releaseLock()
    }
  }

  const text = await res.text()
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`subscription response exceeds ${maxBytes} byte limit`)
  }
  return text
}

// 合并多订阅节点时,同名 tag 会让 sing-box 启动 FATAL(重复 outbound tag)。
// 按输入顺序保证全局唯一:首次出现原样保留(同引用返回,不拷贝);重复的追加 -2/-3/...,
// 且候选后缀若也已被占用(例如输入里本就含 "xxx-2")则继续递增,避免二次撞车。
export const dedupeNodeTags = (nodes) => {
  const used = new Set()
  return nodes.map((node) => {
    const tag = node.tag
    if (!used.has(tag)) {
      used.add(tag)
      return node
    }
    let seq = 2
    let candidate = `${tag}-${seq}`
    while (used.has(candidate)) {
      seq += 1
      candidate = `${tag}-${seq}`
    }
    used.add(candidate)
    return { ...node, tag: candidate }
  })
}

const errorMessage = (err) => (err instanceof Error ? err.message : String(err))

// 系统 fetch 把底层原因藏在 err.cause 里,面上只有一句 "fetch failed"——把 cause 带出来。
// node:http 的错误(ECONNREFUSED、ETIMEDOUT…)本身带 code,也一并带上。
const describeFetchError = (err) => {
  let message = errorMessage(err)
  const code = err && typeof err === 'object' && err.code ? String(err.code) : ''
  if (code && !message.includes(code)) message = `${code}: ${message}`
  const cause = err && typeof err === 'object' ? err.cause : null
  const causeCode = cause && typeof cause === 'object' ? String(cause.code || '') : ''
  const causeMessage = cause && typeof cause === 'object' && cause.message ? String(cause.message) : ''
  if (causeMessage && causeMessage !== message) message += ` (${causeCode ? `${causeCode}: ` : ''}${causeMessage})`
  return message
}

// 拉取订阅内容,手动处理重定向:默认 fetch 会自动跟随 3xx,首跳校验通过后就对
// Location 完全不设防——P4a 复审的 PoC 正是靠一个"看起来公网"的地址 302 到回环端口
// 拿到命中。这里用 redirect:'manual' 拿到原始 3xx 响应,每一跳(含首跳)都先跑
// assertPublicUrl,再决定要不要继续跟——最多跟 3 跳,超出或缺 Location 头一律拒绝。
const fetchSubscriptionResponse = async (initialUrl, fetchImpl, lookup, userAgent) => {
  let currentUrl = initialUrl
  let redirectsFollowed = 0

  for (;;) {
    // 校验和建连必须是同一次解析:把校验过的地址交给 fetch 实现按它去连(insecure-fetch 会
    // 接到 node:http 的 lookup 上),Host / SNI 仍是域名。否则同一个域名校验时答公网、建连时
    // 答回环,就绕过了这道闸(DNS rebinding)。每一跳重定向都重新校验、重新绑定。
    const checked = await assertPublicUrl(currentUrl, { lookup, allowPrivate: true })

    let res
    try {
      res = await fetchImpl(currentUrl, {
        redirect: 'manual',
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(SUBSCRIPTION_FETCH_TIMEOUT_MS),
        lookup: pinnedLookup(checked.validatedRecords),
      })
    } catch (err) {
      throw new Error(`failed to fetch subscription: ${describeFetchError(err)}`)
    }

    if (!res) {
      throw new Error('failed to fetch subscription: no response')
    }

    if (res.status >= 300 && res.status < 400) {
      if (redirectsFollowed >= MAX_SUBSCRIPTION_REDIRECTS) {
        throw new Error('too many redirects while fetching subscription')
      }

      const location = typeof res.headers?.get === 'function' ? res.headers.get('location') : null
      if (!location) {
        throw new Error('redirect response missing Location header')
      }

      currentUrl = new URL(location, currentUrl).toString()
      redirectsFollowed += 1
      continue
    }

    if (!res.ok) {
      // 带上状态码:调用方据此决定换下一个 UA 再试(403 / 401 这类多半是机场按 UA 拒的)
      const err = new Error(`failed to fetch subscription: HTTP ${res.status}`)
      err.httpStatus = res.status
      throw err
    }

    return res
  }
}

const fetchSubscriptionText = async (url, fetchImpl, lookup, userAgent) => {
  const res = await fetchSubscriptionResponse(url, fetchImpl, lookup, userAgent)
  return readSubscriptionBody(res, MAX_SUBSCRIPTION_RESPONSE_BYTES)
}

// 一个节点都没解析出来时,把原因说清楚。以前这种情况是"静默成功":订阅照样存下、
// nodeCount 记 0,界面上只剩一句「0 个节点」,既看不出是没抓到、没认出格式,还是
// 协议不支持——用户除了反复点刷新无事可做。
const describeEmptyResult = ({ format, skipped }) => {
  if (format === 'unknown') {
    return '无法识别订阅内容的格式(既不是 Clash YAML、sing-box JSON,也不是分享链接)。' +
      '请确认订阅地址填的是订阅链接本身,而不是机场的网页地址。'
  }
  const types = [...new Set((skipped || []).map((s) => s.type).filter(Boolean))]
  if (types.length) {
    return `订阅解析成功(${format} 格式),但其中 ${skipped.length} 个节点使用的协议都不受支持:` +
      `${types.join('、')}。`
  }
  return `订阅解析成功(${format} 格式),但里面一个节点都没有。`
}

// 定期更新:{ enabled, days(1~30), hour(0~23) }——每隔几天、几点重新拉一次(system/scheduler.mjs
// 到点来做)。关掉或不合法就是 null。小时粒度和后端设置里 Geo / 自身升级的计划一致。
export const normalizeAutoUpdate = (raw) => {
  if (!raw || typeof raw !== 'object' || raw.enabled !== true) return null
  const days = Math.min(30, Math.max(1, Math.round(Number(raw.days)) || 1))
  const hour = Math.min(23, Math.max(0, Math.round(Number(raw.hour)) || 0))
  return { enabled: true, days, hour }
}

// 订阅地址可以填多个(镜像、备用、几个机场合成一条):数组 urls 优先,老字段 url 只在没给
// 数组时算一条。去空白、去重、顺序保留——第一条兼作老字段 url,给还只认单个地址的地方用。
export const normalizeUrls = (urls, url) => {
  const list = Array.isArray(urls) && urls.length ? urls : (typeof url === 'string' ? [url] : [])
  return [...new Set(list.filter((u) => typeof u === 'string').map((u) => u.trim()).filter(Boolean))]
}

// 一条订阅记录的全部地址:新记录存 urls,老记录只有 url
export const subscriptionUrls = (sub) =>
  (sub && Array.isArray(sub.urls) && sub.urls.length ? sub.urls : (sub && sub.url ? [sub.url] : []))

// url(s) / content 二选一,统一成 resolveNodes 认的形状。粘贴保存是「节点」模式的正路,
// 不再是"只能预览":用户手上只有一堆分享链接、没有订阅地址的情况很常见。
export const normalizeSource = ({ url, urls, content }) => {
  const trimmedContent = typeof content === 'string' ? content.trim() : ''
  if (trimmedContent) {
    if (Buffer.byteLength(trimmedContent, 'utf8') > MAX_PASTED_CONTENT_BYTES) {
      throw new Error(`粘贴内容超过 ${MAX_PASTED_CONTENT_BYTES} 字节上限`)
    }
    return { content: trimmedContent }
  }
  const list = normalizeUrls(urls, url)
  if (list.length) return { url: list[0], urls: list }
  throw new Error('url or content is required')
}

// preview/create/refresh 共用的解析管道:优先用直传的 content,否则用 fetchImpl 拉取 url;
// 再走 parseSubscription → renameNodes/previewRename。拉取或校验失败在这里抛出,
// 调用方在 store 写入之前捕获,天然保证"失败不破坏已存状态"。
// name:订阅名称。renameOptions.usePrefix 打开时用它做节点名前缀(「破晓 | 香港-01」)。
// 存的是开关而不是前缀文本本身——存文本的话,用户改了订阅名,前缀还留着旧名字。
// 停用的订阅(enabled === false)的节点不进内核:生成配置 / 旁路计划 / 直连站点名单都用这份而不是 store.getNodes()
// (GitHub #40)。节点池本身不动,重新启用就回来
export const activeNodes = (store) => {
  const nodes = typeof store.getNodes === 'function' ? store.getNodes() : []
  const subs = typeof store.getSubscriptions === 'function' ? store.getSubscriptions() : []
  const disabled = new Set(subs.filter((s) => s && s.enabled === false).map((s) => s.id))
  if (!disabled.size) return nodes
  return nodes.filter((n) => !n || !disabled.has(n.subscriptionId))
}

// curlFetch:Node fetch 全被拒后的兜底(system/curl-fetch.mjs)。只在真实网络路径上默认开——测试注入的
// fetchImpl 不该悄悄去跑系统 curl;要测兜底就显式传
export const resolveNodes = async ({ url, urls, content, name }, fetchImpl, renameOptions, lookup, { curlFetch } = {}) => {
  const curl = curlFetch !== undefined ? curlFetch : (fetchImpl === subscriptionFetch ? curlFetchText : null)
  // renameNodes/groupNodesByRegion 的默认参数只兜底 undefined;显式传 null(合法 JSON 值)
  // 会在其内部触发 "options.xxx of null" —— 这里统一归一化,避免因此误判 400。
  const raw = renameOptions && typeof renameOptions === 'object' ? renameOptions : undefined
  // prefix 是「usePrefix 开关 + 订阅名」的派生值,不进持久化的 renameOptions:
  // 存下前缀文本的话,订阅一改名,节点前缀还挂着旧名字。这里先把它剥掉,
  // 免得历史记录里残留的 prefix 在开关关掉之后还继续生效。
  const base = raw
    ? Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'prefix'))
    : undefined
  const opts = base && base.usePrefix && typeof name === 'string' && name.trim()
    ? { ...base, prefix: name.trim() }
    : base
  // 过滤必须发生在改名之前:renameNodes / previewRename 按下标一一对应,
  // 而且被过滤掉的条目连预览表都不该出现——它们压根不算节点。
  const finish = (parsed) => {
    const { kept, excluded, disabled } = excludeNodes(parsed.nodes, opts || {})
    return {
      renamed: renameNodes(kept, opts),
      skipped: parsed.skipped,
      excluded: excluded.map((n) => ({ name: n.originalTag })),
      disabled: disabled.map((n) => ({ name: n.originalTag })),
      format: parsed.format,
      preview: previewRename(kept, opts),
      renameOptions: base,
    }
  }

  if (typeof content === 'string' && content.trim()) {
    const parsed = parseSubscription(content)
    if (!parsed.nodes.length) throw new Error(describeEmptyResult(parsed))
    return finish(parsed)
  }

  const list = normalizeUrls(urls, url)
  if (!list.length) throw new Error('url or content is required')

  // 逐个 UA 试,第一份能解析出节点的就采用。多发的请求只在失败路径上产生:
  // 首选 UA 就拿到节点时(绝大多数情况)只有一次请求。
  // 服务器按状态码拒掉的(403 / 401 / 406…)换下一个 UA 继续;网络不通、地址不合法这类错误和 UA
  // 无关,直接报出去,不白等几轮超时(GitHub #27:以前第一个 UA 被 403 就整次失败,后面的 UA 轮不到)
  const fetchOne = async (oneUrl) => {
    let firstParsed = null
    const rejected = []
    for (const userAgent of SUBSCRIPTION_USER_AGENTS) {
      let text
      try {
        text = await fetchSubscriptionText(oneUrl, fetchImpl, lookup, userAgent)
      } catch (err) {
        if (err && err.httpStatus) {
          rejected.push(`${userAgent} → HTTP ${err.httpStatus}`)
          continue
        }
        throw err
      }
      const parsed = parseSubscription(text)
      if (parsed.nodes.length) return parsed
      if (!firstParsed) firstParsed = parsed
    }
    // Node fetch 全被按状态码拒了:换系统 curl 再来一轮。有些机场的 WAF 认的是 TLS / HTTP 指纹而不是 UA——
    // 同一台机器、同一个出口、同一个 UA,Node 403、curl 200(GitHub #37)。curl 那边同样逐跳校验地址、钉死解析
    if (curl && rejected.length) {
      for (const userAgent of SUBSCRIPTION_USER_AGENTS) {
        let r
        try {
          r = await curl(oneUrl, { userAgent, lookup, maxBytes: MAX_SUBSCRIPTION_RESPONSE_BYTES, timeoutMs: SUBSCRIPTION_FETCH_TIMEOUT_MS })
        } catch (err) {
          rejected.push(`curl ${userAgent} → ${errorMessage(err)}`)
          break
        }
        if (!r || r.available === false) break
        if (!r.status) { rejected.push(`curl ${userAgent} → ${r.error || 'failed'}`); break }
        if (r.status < 200 || r.status >= 300) { rejected.push(`curl ${userAgent} → HTTP ${r.status}`); continue }
        const parsed = parseSubscription(r.text || '')
        if (parsed.nodes.length) {
          console.log(`[subscription] Node fetch 全部被拒,改用系统 curl 拿到 ${(r.text || '').length} 字节(UA=${userAgent})`)
          return parsed
        }
        if (!firstParsed) firstParsed = parsed
      }
    }
    if (firstParsed) throw new Error(describeEmptyResult(firstParsed))
    throw new Error(`订阅服务器拒绝了所有客户端标识(User-Agent),请联系机场确认是否限制第三方客户端:\n${rejected.join('\n')}`)
  }

  // 多个地址:逐个拉,任何一个失败整次失败——刷新时不能因为一个地址暂时不通就把它那份
  // 节点静默丢掉,失败了原有的订阅记录和节点原样保留。各家的节点按地址顺序接起来;
  // 同一个节点在两个地址里都出现(镜像地址)只留一份,不然会被 dedupeNodeTags 编成 xx-2。
  const parts = []
  for (const oneUrl of list) {
    try {
      parts.push(await fetchOne(oneUrl))
    } catch (err) {
      throw list.length > 1 ? new Error(`${oneUrl}:${errorMessage(err)}`) : err
    }
  }
  if (parts.length === 1) return finish(parts[0])
  const seen = new Set()
  const nodes = []
  for (const part of parts) {
    for (const node of part.nodes) {
      const key = JSON.stringify(node)
      if (seen.has(key)) continue
      seen.add(key)
      nodes.push(node)
    }
  }
  const formats = [...new Set(parts.map((p) => p.format))]
  return finish({ nodes, skipped: parts.flatMap((p) => p.skipped), format: formats.join('+') })
}

// 把某订阅的新节点并入全局节点池:其它订阅的节点原样保留,按 subscriptions 记录的顺序
// 排列(新建订阅排在最后,刷新订阅保持原有位置),目标订阅位置换成新节点,整体再去重一次。
// 节点池按订阅顺序重排:同一订阅内的相对顺序不变,不属于任何已知订阅的排最后
export const orderNodesBySubscriptions = (nodes, subscriptionsInOrder) => {
  const bySub = new Map()
  const orphans = []
  const known = new Set(subscriptionsInOrder.map((s) => s.id))
  for (const node of nodes) {
    if (!known.has(node.subscriptionId)) { orphans.push(node); continue }
    if (!bySub.has(node.subscriptionId)) bySub.set(node.subscriptionId, [])
    bySub.get(node.subscriptionId).push(node)
  }
  return [...subscriptionsInOrder.flatMap((s) => bySub.get(s.id) || []), ...orphans]
}

const rebuildNodePool = (existingNodes, subscriptionsInOrder, subscriptionId, newNodesForSub) => {
  const bySub = new Map()
  for (const node of existingNodes) {
    if (node.subscriptionId === subscriptionId) continue
    if (!bySub.has(node.subscriptionId)) bySub.set(node.subscriptionId, [])
    bySub.get(node.subscriptionId).push(node)
  }
  const merged = []
  for (const sub of subscriptionsInOrder) {
    if (sub.id === subscriptionId) {
      merged.push(...newNodesForSub)
    } else {
      merged.push(...(bySub.get(sub.id) || []))
    }
  }
  return dedupeNodeTags(merged)
}

const nodeSummary = (n) => ({ tag: n.tag, originalTag: n.originalTag, type: n.type, server: n.server, regionCode: n.regionCode || '' })

// 粘贴来源的订阅没有可回源的地址,刷新就是拿已存内容重新解析一遍(不走网络)。
const existingSource = (sub) => {
  const urls = subscriptionUrls(sub)
  return urls.length ? { urls } : { content: sub.content || '' }
}

// 重新拉取一条订阅、只替换它的节点。刷新按钮和定时任务(system/scheduler.mjs)共用。
// 拉取 / 解析失败在 store 写入之前抛出,已存的记录与节点原样不变。
export const refreshSubscriptionById = async (store, id, { fetchImpl = subscriptionFetch, lookup = dns.lookup, renameOptions, curlFetch } = {}) => {
  const existing = store.getSubscriptions().find((s) => s.id === id)
  if (!existing) throw new Error('subscription not found')
  const resolved = await resolveNodes({ ...existingSource(existing), name: existing.name }, fetchImpl, renameOptions || existing.renameOptions || {}, lookup, { curlFetch })
  const { renamed, skipped, format } = resolved
  // 拉取可能花几十秒,期间用户可能改了这条订阅、删了别的订阅或新建了订阅:一律按此刻的列表办。
  //   · 这条被删了 → 作废;
  //   · 来源(地址 / 内容)、名字(节点名前缀跟着它)或改名规则变了 → 这份结果是按旧设置拉的,
  //     写进去就是新旧混杂,作废,让用户再刷一次;
  //   · 只改了自动更新之类的设置 → 照常写,但只合并这次拉取派生出来的字段(格式、数量、时间),
  //     其余以此刻存的为准。以前是拿拉取前的快照整份覆盖,刷新期间保存的新名字、新开关会被
  //     改回去。
  const nowSubs = store.getSubscriptions()
  const current = nowSubs.find((s) => s.id === id)
  if (!current) throw new Error('subscription was deleted while refreshing')
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const settingsChanged = !same(existingSource(current), existingSource(existing))
    || current.name !== existing.name
    || (!renameOptions && !same(current.renameOptions || {}, existing.renameOptions || {}))
  if (settingsChanged) throw new Error('subscription was modified while refreshing; refresh it again')
  const updated = { ...current, format, nodeCount: renamed.length, renameOptions: resolved.renameOptions || {}, updatedAt: Date.now() }
  const newNodesForSub = renamed.map((n) => ({ ...n, subscriptionId: id }))
  store.setNodes(rebuildNodePool(store.getNodes(), nowSubs, id, newNodesForSub))
  store.setSubscriptions(nowSubs.map((s) => (s.id === id ? updated : s)))
  return { id, name: updated.name, nodeCount: renamed.length, skipped }
}

export const registerSubscriptionRoutes = (app, { store, fetchImpl = subscriptionFetch, lookup = dns.lookup, curlFetch } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '10mb' }))

  // 订阅的任何动作都不自动重启内核——重启会把连接全断一次,什么时候重启该由用户决定。
  // 但要如实告诉前端节点池变没变(新增 / 刷新 / 换地址 / 删除 / 排序都可能变),变了面板才提示
  // "重启内核生效";上游没动的刷新、只是把规则原样存一遍,就说"节点没有变化"。每个路由进来
  // 先拍一张节点池快照,写完再比一次:tag / 服务器 / 参数任何一处不同都算变。
  const snapshot = () => JSON.stringify(store.getNodes())
  const changedSince = (before) => snapshot() !== before

  // 预览:纯解析/改名/分组,不落库。
  router.post('/preview', async (req, res) => {
    try {
      const { url, urls, content, renameOptions } = req.body || {}
      const resolved = await resolveNodes({ url, urls, content, name: req.body?.name }, fetchImpl, renameOptions, lookup, { curlFetch })
      const { renamed, skipped, excluded, disabled, format, preview } = resolved
      const { groups } = groupNodesByRegion(renamed, resolved.renameOptions)
      res.json({
        format,
        nodes: renamed.map(nodeSummary),
        skipped,
        // 被过滤/被禁用的条目要如实报出来:它们会让节点凭空消失,不列出来的话
        // 用户既看不出规则有没有生效,也无从发现自己写的关键词误伤了真节点。
        excluded,
        disabled,
        preview,
        groups,
      })
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  // 创建:拉取解析后保存订阅记录 + 合并节点(全局去重)。
  router.post('/', async (req, res) => {
    const before = snapshot()
    try {
      const { url, urls, content, name, renameOptions, autoUpdate } = req.body || {}
      const source = normalizeSource({ url, urls, content })
      if (typeof name !== 'string' || !name.trim()) throw new Error('name is required')

      const resolved = await resolveNodes({ ...source, name }, fetchImpl, renameOptions, lookup, { curlFetch })
      const { renamed, skipped, format } = resolved

      const id = randomUUID()
      const now = Date.now()
      const record = {
        id,
        name,
        url: source.url || '',
        // 全部地址存在 urls;url 留着第一条,给老版本面板和只认单个地址的地方用
        ...(source.urls ? { urls: source.urls } : {}),
        // 粘贴来的订阅没有可回源的地址,内容必须存下来:改重命名规则时要拿它重新解析,
        // 否则一改规则节点就全没了。
        ...(source.content ? { content: source.content } : {}),
        format,
        nodeCount: renamed.length,
        renameOptions: resolved.renameOptions || {},
        // 定期更新计划;粘贴来的订阅没有地址可回源,不给计划
        autoUpdate: source.urls ? normalizeAutoUpdate(autoUpdate) : null,
        createdAt: now,
        updatedAt: now,
      }
      const newNodesForSub = renamed.map((n) => ({ ...n, subscriptionId: id }))
      const subsInOrder = [...store.getSubscriptions(), record]

      store.setNodes(rebuildNodePool(store.getNodes(), subsInOrder, id, newNodesForSub))
      store.setSubscriptions(subsInOrder)

      res.json({ id, name, nodeCount: renamed.length, skipped, changed: changedSince(before) })
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  // 列表
  router.get('/', (_req, res) => {
    res.json({ subscriptions: store.getSubscriptions() })
  })

  // 排序:ids 是全部订阅 id 的新顺序(必须一一对应,不能多也不能少)。节点池也按新顺序
  // 重排——节点组成员选择器、终端分流的出口选择器、内核里的出站顺序都是照节点池来的。
  router.put('/order', async (req, res) => {
    const before = snapshot()
    const ids = req.body && req.body.ids
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
      return res.status(400).json({ error: 'ids must be an array of strings' })
    }
    const subs = store.getSubscriptions()
    const current = new Set(subs.map((s) => s.id))
    if (ids.length !== current.size || new Set(ids).size !== ids.length || !ids.every((id) => current.has(id))) {
      return res.status(400).json({ error: 'ids must list every subscription exactly once' })
    }
    const byId = new Map(subs.map((s) => [s.id, s]))
    const ordered = ids.map((id) => byId.get(id))
    store.setSubscriptions(ordered)
    store.setNodes(orderNodesBySubscriptions(store.getNodes(), ordered))
    res.json({ ok: true, subscriptions: ordered, changed: changedSince(before) })
  })

  // 删除:同时清掉该订阅的节点。幂等——id 不存在也返回 ok:true。
  router.delete('/:id', async (req, res) => {
    const { id } = req.params
    const before = snapshot()
    store.setSubscriptions(store.getSubscriptions().filter((s) => s.id !== id))
    store.setNodes(store.getNodes().filter((n) => n.subscriptionId !== id))
    // 本来就不存在的 id、或者本来就没有节点的订阅:节点池没变,changed 就是 false
    res.json({ ok: true, changed: changedSince(before) })
  })

  // 修改:改名 / 换订阅链接 / 调整重命名规则。
  // 只改名字时不重新拉取——链接和重命名规则都没动,节点必然还是那一批,为了改个名字
  // 去发一次网络请求毫无意义,而且机场抽风时会连改名都做不了。链接或重命名规则一旦
  // 变化才重新解析,失败在 store 写入之前抛出,原记录与节点原样保留。
  router.patch('/:id', async (req, res) => {
    const { id } = req.params
    const before = snapshot()
    const subs = store.getSubscriptions()
    const idx = subs.findIndex((s) => s.id === id)
    if (idx === -1) {
      res.status(404).json({ error: 'subscription not found' })
      return
    }
    try {
      const existing = subs[idx]
      const body = req.body || {}

      const name = body.name === undefined ? existing.name : body.name
      if (typeof name !== 'string' || !name.trim()) throw new Error('name is required')
      // 定期更新计划只是记录,改它不用重拉
      const autoUpdate = body.autoUpdate === undefined ? existing.autoUpdate || null : normalizeAutoUpdate(body.autoUpdate)
      // 启用 / 停用(GitHub #40):只是个开关,不重拉;停用的订阅节点不进内核,所以开关一变就算"节点池变了"
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new Error('enabled must be a boolean')
      const enabled = body.enabled === undefined ? existing.enabled !== false : body.enabled
      const enabledFlipped = enabled !== (existing.enabled !== false)

      // url(s) / content 两者都没传时沿用已存的来源;创建时就保证了至少有一个非空。
      const urls = body.urls === undefined && body.url === undefined
        ? subscriptionUrls(existing)
        : normalizeUrls(body.urls, body.url)
      const content = body.content === undefined ? existing.content || '' : body.content
      const source = normalizeSource({ urls, content })

      const renameOptions =
        body.renameOptions === undefined ? existing.renameOptions || {} : body.renameOptions

      // 开了「订阅名做前缀」时,改订阅名字就等于改掉全部节点名字,必须重新解析。
      // 不带这个条件的话,改完名字节点上还挂着旧前缀,而界面上看不出任何异常。
      const renamedWithPrefix =
        renameOptions && renameOptions.usePrefix === true && name !== existing.name

      const needsRefetch =
        JSON.stringify(source.urls || []) !== JSON.stringify(subscriptionUrls(existing)) ||
        (source.content || '') !== (existing.content || '') ||
        renamedWithPrefix ||
        JSON.stringify(renameOptions || {}) !== JSON.stringify(existing.renameOptions || {})

      if (!needsRefetch) {
        const updated = { ...existing, name, autoUpdate, enabled, updatedAt: Date.now() }
        store.setSubscriptions(subs.map((s, i) => (i === idx ? updated : s)))
        res.json({ id, name, nodeCount: existing.nodeCount, skipped: [], changed: enabledFlipped })
        return
      }

      const resolved = await resolveNodes({ ...source, name }, fetchImpl, renameOptions, lookup, { curlFetch })
      const { renamed, skipped, format } = resolved

      const updated = {
        ...existing,
        name,
        autoUpdate,
        enabled,
        url: source.url || '',
        urls: source.urls || undefined,
        content: source.content || undefined,
        format,
        nodeCount: renamed.length,
        renameOptions: resolved.renameOptions || {},
        updatedAt: Date.now(),
      }
      const newNodesForSub = renamed.map((n) => ({ ...n, subscriptionId: id }))

      // 拉取可能花几十秒,期间用户可能删了别的订阅或新建了订阅:必须按此刻的列表写回,
      // 否则旧快照会把删掉的复活、把新建的连节点一起丢掉
      const nowSubs = store.getSubscriptions()
      if (!nowSubs.some((s) => s.id === id)) throw new Error('subscription was deleted while refreshing')
      store.setNodes(rebuildNodePool(store.getNodes(), nowSubs, id, newNodesForSub))
      store.setSubscriptions(nowSubs.map((s) => (s.id === id ? { ...s, ...updated } : s)))

      res.json({ id, name, nodeCount: renamed.length, skipped, changed: changedSince(before) || enabledFlipped })
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  // 刷新:重新拉取解析,只替换该订阅的节点(逻辑在 refreshSubscriptionById,定时任务也用它)。
  // 拉取/解析失败时在 store 写入之前就已抛出,已存的订阅记录与节点保持原样不变。
  router.post('/:id/refresh', async (req, res) => {
    const { id } = req.params
    const before = snapshot()
    if (!store.getSubscriptions().some((s) => s.id === id)) {
      res.status(404).json({ error: 'subscription not found' })
      return
    }
    try {
      const r = await refreshSubscriptionById(store, id, { fetchImpl, lookup, renameOptions: req.body && req.body.renameOptions, curlFetch })
      res.json({ ...r, changed: changedSince(before) })
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  app.use('/api/openbox/subscriptions', router)
}
