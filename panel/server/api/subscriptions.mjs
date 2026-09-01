import { randomUUID } from 'node:crypto'
import dns from 'node:dns/promises'
import express from 'express'
import { parseSubscription } from '../engine/subscription.mjs'
import { renameNodes, previewRename, excludeNodes } from '../engine/rename.mjs'
import { groupNodesByRegion } from '../engine/groups.mjs'
import { assertPublicUrl } from './net-guard.mjs'

// 面板本身跑在网关上,订阅拉取又是"服务端发起、URL 客户端可控"的经典 SSRF 面——
// 不加限制的话可以拿它当跳板探测回环/内网端口。P4a 复审证明了仅做"字面 IP"层面拒绝远远
// 不够(域名不解析就直接放行、IPv6 十六进制形式的 IPv4-mapped 地址漏判、redirect 不复检
// 等四种绕过均有 PoC),所以这里改为:assertPublicUrl 真正解析 hostname(node:dns/promises
// lookup + {all:true}),对每一个解析出的地址都判定;拉取时手动处理重定向,每一跳都重新校验。
// 机场订阅端点普遍按 User-Agent 决定回什么:UA 里带 clash / sing-box 之类的关键字才
// 给对应格式的订阅,不认识的 UA 通常退回一份 base64 分享链接、有时干脆是网页。Node 的
// fetch 默认发 "User-Agent: node",没有任何机场会认——实测同一个订阅地址三种 UA 拿到
// 三份完全不同的响应(base64 8.5KB / Clash YAML 36KB / sing-box JSON 15KB)。
// 按信息量从高到低依次尝试,拿到能解析出节点的那一份就停:Clash YAML 字段最全(udp、
// 指纹、alpn 都在),sing-box JSON 次之,最后才退回默认 UA 那一份。
const SUBSCRIPTION_USER_AGENTS = Object.freeze([
  'clash-verge/v2.0.0',
  'sing-box/1.13.14',
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

// 拉取订阅内容,手动处理重定向:默认 fetch 会自动跟随 3xx,首跳校验通过后就对
// Location 完全不设防——P4a 复审的 PoC 正是靠一个"看起来公网"的地址 302 到回环端口
// 拿到命中。这里用 redirect:'manual' 拿到原始 3xx 响应,每一跳(含首跳)都先跑
// assertPublicUrl,再决定要不要继续跟——最多跟 3 跳,超出或缺 Location 头一律拒绝。
const fetchSubscriptionResponse = async (initialUrl, fetchImpl, lookup, userAgent) => {
  let currentUrl = initialUrl
  let redirectsFollowed = 0

  for (;;) {
    await assertPublicUrl(currentUrl, { lookup })

    let res
    try {
      res = await fetchImpl(currentUrl, {
        redirect: 'manual',
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(SUBSCRIPTION_FETCH_TIMEOUT_MS),
      })
    } catch (err) {
      throw new Error(`failed to fetch subscription: ${errorMessage(err)}`)
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
      throw new Error(`failed to fetch subscription: HTTP ${res.status}`)
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

// url / content 二选一,统一成 resolveNodes 认的形状。粘贴保存是「节点」模式的正路,
// 不再是"只能预览":用户手上只有一堆分享链接、没有订阅地址的情况很常见。
export const normalizeSource = ({ url, content }) => {
  const trimmedContent = typeof content === 'string' ? content.trim() : ''
  if (trimmedContent) {
    if (Buffer.byteLength(trimmedContent, 'utf8') > MAX_PASTED_CONTENT_BYTES) {
      throw new Error(`粘贴内容超过 ${MAX_PASTED_CONTENT_BYTES} 字节上限`)
    }
    return { content: trimmedContent }
  }
  if (typeof url === 'string' && url.trim()) return { url: url.trim() }
  throw new Error('url or content is required')
}

// preview/create/refresh 共用的解析管道:优先用直传的 content,否则用 fetchImpl 拉取 url;
// 再走 parseSubscription → renameNodes/previewRename。拉取或校验失败在这里抛出,
// 调用方在 store 写入之前捕获,天然保证"失败不破坏已存状态"。
// name:订阅名称。renameOptions.usePrefix 打开时用它做节点名前缀(「破晓 | 香港-01」)。
// 存的是开关而不是前缀文本本身——存文本的话,用户改了订阅名,前缀还留着旧名字。
export const resolveNodes = async ({ url, content, name }, fetchImpl, renameOptions, lookup) => {
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

  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('url or content is required')
  }

  // 逐个 UA 试,第一份能解析出节点的就采用。多发的请求只在失败路径上产生:
  // 首选 UA 就拿到节点时(绝大多数情况)只有一次请求。
  let firstParsed = null
  for (const userAgent of SUBSCRIPTION_USER_AGENTS) {
    const text = await fetchSubscriptionText(url, fetchImpl, lookup, userAgent)
    const parsed = parseSubscription(text)
    if (parsed.nodes.length) return finish(parsed)
    if (!firstParsed) firstParsed = parsed
  }
  throw new Error(describeEmptyResult(firstParsed))
}

// 把某订阅的新节点并入全局节点池:其它订阅的节点原样保留,按 subscriptions 记录的顺序
// 排列(新建订阅排在最后,刷新订阅保持原有位置),目标订阅位置换成新节点,整体再去重一次。
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

const nodeSummary = (n) => ({ tag: n.tag, originalTag: n.originalTag, type: n.type, server: n.server })

export const registerSubscriptionRoutes = (app, { store, fetchImpl = globalThis.fetch, lookup = dns.lookup } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '10mb' }))

  // 预览:纯解析/改名/分组,不落库。
  router.post('/preview', async (req, res) => {
    try {
      const { url, content, renameOptions } = req.body || {}
      const resolved = await resolveNodes({ url, content, name: req.body?.name }, fetchImpl, renameOptions, lookup)
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
    try {
      const { url, content, name, renameOptions } = req.body || {}
      const source = normalizeSource({ url, content })
      if (typeof name !== 'string' || !name.trim()) throw new Error('name is required')

      const resolved = await resolveNodes({ ...source, name }, fetchImpl, renameOptions, lookup)
      const { renamed, skipped, format } = resolved

      const id = randomUUID()
      const now = Date.now()
      const record = {
        id,
        name,
        url: source.url || '',
        // 粘贴来的订阅没有可回源的地址,内容必须存下来:改重命名规则时要拿它重新解析,
        // 否则一改规则节点就全没了。
        ...(source.content ? { content: source.content } : {}),
        format,
        nodeCount: renamed.length,
        renameOptions: resolved.renameOptions || {},
        createdAt: now,
        updatedAt: now,
      }
      const newNodesForSub = renamed.map((n) => ({ ...n, subscriptionId: id }))
      const subsInOrder = [...store.getSubscriptions(), record]

      store.setNodes(rebuildNodePool(store.getNodes(), subsInOrder, id, newNodesForSub))
      store.setSubscriptions(subsInOrder)

      res.json({ id, name, nodeCount: renamed.length, skipped })
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  // 列表
  router.get('/', (_req, res) => {
    res.json({ subscriptions: store.getSubscriptions() })
  })

  // 删除:同时清掉该订阅的节点。幂等——id 不存在也返回 ok:true。
  router.delete('/:id', (req, res) => {
    const { id } = req.params
    store.setSubscriptions(store.getSubscriptions().filter((s) => s.id !== id))
    store.setNodes(store.getNodes().filter((n) => n.subscriptionId !== id))
    res.json({ ok: true })
  })

  // 修改:改名 / 换订阅链接 / 调整重命名规则。
  // 只改名字时不重新拉取——链接和重命名规则都没动,节点必然还是那一批,为了改个名字
  // 去发一次网络请求毫无意义,而且机场抽风时会连改名都做不了。链接或重命名规则一旦
  // 变化才重新解析,失败在 store 写入之前抛出,原记录与节点原样保留。
  router.patch('/:id', async (req, res) => {
    const { id } = req.params
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

      // url / content 两者都没传时沿用已存的来源;创建时就保证了至少有一个非空。
      const url = body.url === undefined ? existing.url || '' : body.url
      const content = body.content === undefined ? existing.content || '' : body.content
      const source = normalizeSource({ url, content })

      const renameOptions =
        body.renameOptions === undefined ? existing.renameOptions || {} : body.renameOptions

      // 开了「订阅名做前缀」时,改订阅名字就等于改掉全部节点名字,必须重新解析。
      // 不带这个条件的话,改完名字节点上还挂着旧前缀,而界面上看不出任何异常。
      const renamedWithPrefix =
        renameOptions && renameOptions.usePrefix === true && name !== existing.name

      const needsRefetch =
        (source.url || '') !== (existing.url || '') ||
        (source.content || '') !== (existing.content || '') ||
        renamedWithPrefix ||
        JSON.stringify(renameOptions || {}) !== JSON.stringify(existing.renameOptions || {})

      if (!needsRefetch) {
        const updated = { ...existing, name, updatedAt: Date.now() }
        store.setSubscriptions(subs.map((s, i) => (i === idx ? updated : s)))
        res.json({ id, name, nodeCount: existing.nodeCount, skipped: [] })
        return
      }

      const resolved = await resolveNodes({ ...source, name }, fetchImpl, renameOptions, lookup)
      const { renamed, skipped, format } = resolved

      const updated = {
        ...existing,
        name,
        url: source.url || '',
        content: source.content || undefined,
        format,
        nodeCount: renamed.length,
        renameOptions: resolved.renameOptions || {},
        updatedAt: Date.now(),
      }
      const newNodesForSub = renamed.map((n) => ({ ...n, subscriptionId: id }))

      store.setNodes(rebuildNodePool(store.getNodes(), subs, id, newNodesForSub))
      store.setSubscriptions(subs.map((s, i) => (i === idx ? updated : s)))

      res.json({ id, name, nodeCount: renamed.length, skipped })
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  // 粘贴来源的订阅没有可回源的地址,刷新就是拿已存内容重新解析一遍(不走网络)。
  const existingSource = (sub) => (sub.url ? { url: sub.url } : { content: sub.content || '' })

  // 刷新:重新拉取解析,只替换该订阅的节点。拉取/解析失败时在 store 写入之前就已抛出,
  // 已存的订阅记录与节点保持原样不变。
  router.post('/:id/refresh', async (req, res) => {
    const { id } = req.params
    const subs = store.getSubscriptions()
    const idx = subs.findIndex((s) => s.id === id)
    if (idx === -1) {
      res.status(404).json({ error: 'subscription not found' })
      return
    }
    try {
      const existing = subs[idx]
      const requestedRenameOptions = (req.body && req.body.renameOptions) || existing.renameOptions || {}
      const resolved = await resolveNodes({ ...existingSource(existing), name: existing.name }, fetchImpl, requestedRenameOptions, lookup)
      const { renamed, skipped, format } = resolved
      const renameOptions = resolved.renameOptions || {}

      const updated = { ...existing, format, nodeCount: renamed.length, renameOptions, updatedAt: Date.now() }
      const newNodesForSub = renamed.map((n) => ({ ...n, subscriptionId: id }))
      const updatedSubs = subs.map((s, i) => (i === idx ? updated : s))

      store.setNodes(rebuildNodePool(store.getNodes(), subs, id, newNodesForSub))
      store.setSubscriptions(updatedSubs)

      res.json({ id, name: updated.name, nodeCount: renamed.length, skipped })
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  app.use('/api/openbox/subscriptions', router)
}
