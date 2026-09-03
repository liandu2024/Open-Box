// 订阅拉取用的 fetch:地址带 #insecure=1 时跳过 TLS 证书校验。
//
// 自建订阅服务(Caddy 本地 CA、自签证书、IP 直连的 https)在 Node 的 fetch 下一律
// "fetch failed"(UNABLE_TO_GET_ISSUER_CERT_LOCALLY 之类),而机场客户端普遍认
// `#insecure=1` / `#allowInsecure=1` 这类片段作为"我知道这是自签,放行"的开关。片段
// 本来就不会发给服务器,拿来当本地开关正合适;不带开关的地址照旧走系统 fetch,证书
// 该拒绝还是拒绝——这个开关只对用户明确标记的那一条订阅生效,不是全局关校验。
//
// Node 自带的 fetch(undici)没法按请求关证书校验(要 undici 的 Agent,而 undici 并不
// 作为模块暴露),所以 insecure 这条路用 node:https 直接发请求,再包成标准 Response
// 交回去——调用方(subscriptions.mjs)读的是 status / headers.get / body 流,和真 fetch
// 一样。redirect 由调用方手动处理(它本来就传 redirect:'manual' 逐跳做 SSRF 校验),
// 这里遇到 3xx 原样返回即可。
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { Readable } from 'node:stream'

const INSECURE_KEYS = new Set(['insecure', 'allowinsecure', 'allow_insecure', 'allow-insecure', 'skip-cert-verify', 'skipcertverify'])
const NULL_BODY_STATUS = new Set([204, 205, 304])

// #insecure=1 / #insecure / #allowInsecure=true …(不区分大小写)
export const hasInsecureFlag = (url) => {
  let hash = ''
  try {
    hash = new URL(String(url)).hash
  } catch {
    return false
  }
  if (!hash) return false
  for (const [key, value] of new URLSearchParams(hash.slice(1))) {
    if (INSECURE_KEYS.has(key.toLowerCase()) && (value === '' || value === '1' || /^true$/i.test(value))) return true
  }
  return false
}

export const insecureFetch = (url, init = {}) => new Promise((resolve, reject) => {
  let target
  try {
    target = new URL(String(url))
  } catch (err) {
    reject(err)
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
  }
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

// 按 URL(或 init.insecure,跟随重定向时由调用方传下来)分派:标了 insecure 的走
// 上面那条,其余走系统 fetch。init.insecure 不会传给系统 fetch。
export const createSubscriptionFetch = ({ secure = (u, i) => globalThis.fetch(u, i), insecure = insecureFetch } = {}) =>
  (url, init = {}) => {
    const { insecure: wantInsecure, ...rest } = init
    return wantInsecure || hasInsecureFlag(url) ? insecure(url, rest) : secure(url, rest)
  }

export const subscriptionFetch = createSubscriptionFetch()
