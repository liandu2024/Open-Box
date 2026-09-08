// 订阅拉取用的 fetch:不校验 TLS 证书——只要地址能访问就能订阅。
//
// 自建订阅服务用 Caddy 本地 CA、自签证书、IP 直连 https 的情况非常普遍,Node 自带的
// fetch 一律 "fetch failed"(UNABLE_TO_GET_ISSUER_CERT_LOCALLY 之类)。订阅内容本身
// 不是机密(拉回来的是节点配置,连的对不对由节点那边的 TLS 自己保证),所以这里干脆
// 不校验:体验对齐各家客户端"填上就能用"。
//
// Node 自带的 fetch(undici)没法按请求关证书校验(要 undici 的 Agent,而 undici 并不
// 作为模块暴露),所以用 node:https / node:http 直接发请求,再包成标准 Response 交回去
// ——调用方(subscriptions.mjs)读的是 status / headers.get / body 流,和真 fetch 一样。
// 不自动跟随重定向:调用方本来就传 redirect:'manual' 逐跳做 SSRF 校验,3xx 原样返回。
// 只给订阅拉取用;规则集 / 升级包下载等仍走系统 fetch,证书照常校验。
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { Readable } from 'node:stream'

const NULL_BODY_STATUS = new Set([204, 205, 304])

export const insecureFetch = (url, init = {}) => new Promise((resolve, reject) => {
  let target
  try {
    target = new URL(String(url))
  } catch (err) {
    reject(err)
    return
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    reject(new Error(`unsupported protocol: ${target.protocol}`))
    return
  }
  const mod = target.protocol === 'https:' ? https : http
  const headers = {}
  const given = init.headers || {}
  if (typeof given.forEach === 'function' && !Array.isArray(given)) given.forEach((v, k) => { headers[k] = v })
  else for (const [k, v] of Object.entries(given)) headers[k] = v
  const options = {
    method: init.method || 'GET',
    headers,
    signal: init.signal,
    rejectUnauthorized: false,
    // Node 的 HTTP 解析器默认只收 16KB 响应头,有的机场一个响应头就超过这个数(带很长的
    // subscription-userinfo / 一堆 set-cookie),整个订阅直接 HPE_HEADER_OVERFLOW 拉不下来
    // (GitHub #3)。放宽到 64KB;这是订阅专用的 fetch,不影响别处。
    maxHeaderSize: 64 * 1024,
  }
  // 调用方校验过地址就按校验过的连(见 api/net-guard.mjs 的 pinnedLookup),不再解析一次
  if (typeof init.lookup === 'function') options.lookup = init.lookup
  // IP 直连的 https 不能发 SNI(Node 会警告且部分服务端拒绝),域名才带
  if (target.protocol === 'https:' && !net.isIP(target.hostname)) options.servername = target.hostname
  const req = mod.request(target, options, (res) => {
    const responseHeaders = new Headers()
    for (const [k, v] of Object.entries(res.headers)) {
      if (v === undefined) continue
      responseHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v))
    }
    const status = res.statusCode || 0
    const body = NULL_BODY_STATUS.has(status) ? null : Readable.toWeb(res)
    if (!body) res.resume()
    resolve(new Response(body, { status, statusText: res.statusMessage || '', headers: responseHeaders }))
  })
  req.on('error', reject)
  if (init.body !== undefined && init.body !== null) req.write(init.body)
  req.end()
})

export const subscriptionFetch = insecureFetch
