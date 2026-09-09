// 用系统 curl 拉一次订阅——Node fetch 的兜底(GitHub #37)。
//
// 有些机场的 WAF 不是按 User-Agent 字符串拒,而是按 TLS / HTTP 指纹认出 Node(undici)就回 403:同一台
// 路由器、同一个出口、同一个 UA,curl 是 200、Node 是 403,换多少个 UA 都没用。curl 在 OpenWrt 上几乎
// 都有(升级脚本也靠它),就拿它当第二条路。
// 和 api/subscriptions.mjs 里的 Node 路径守同一套闸:不给 -L,重定向逐跳自己跟、每一跳先过 assertPublicUrl
// (订阅允许内网 / 本机,但未指定 / 链路本地照拒),再用 --resolve 把校验过的地址钉死(校验和建连是同一次
// 解析,堵 DNS 重绑定);只认 http / https;限大小、限时。
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { assertPublicUrl } from '../api/net-guard.mjs'

const runCurl = (args, timeoutMs) => new Promise((resolve) => {
  execFile('curl', args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })
  })
})

const readLocation = async (headPath) => {
  let head = ''
  try { head = await readFile(headPath, 'utf8') } catch { return '' }
  const m = /^location:\s*(.+?)\s*$/im.exec(head)
  return m ? m[1] : ''
}

// 返回:{ available:false }(系统没有 curl)| { status, text }(拿到响应,status 是最后一跳的状态码)|
// { status:0, error }(连接层失败)。校验不过(地址不合法 / 不可路由)直接抛,和 Node 路径同一套报错
export const curlFetchText = async (initialUrl, {
  userAgent = 'Open-Box/1.0', lookup, allowPrivate = true, maxBytes = 5 * 1024 * 1024, timeoutMs = 20000, maxRedirects = 3,
} = {}) => {
  let url = initialUrl
  for (let hop = 0; ; hop += 1) {
    const checked = await assertPublicUrl(url, { ...(lookup ? { lookup } : {}), allowPrivate })
    const dir = await mkdtemp(path.join(os.tmpdir(), 'openbox-curl-'))
    const bodyPath = path.join(dir, 'body')
    const headPath = path.join(dir, 'head')
    try {
      const args = [
        '-sS', '--proto', '=http,https', '--max-redirs', '0',
        '--connect-timeout', '10', '--max-time', String(Math.max(5, Math.ceil(timeoutMs / 1000))),
        '--max-filesize', String(maxBytes),
        '-A', userAgent, '-o', bodyPath, '-D', headPath, '-w', '%{http_code}',
      ]
      // 校验过的地址钉死:域名形式的主机才需要(字面 IP 本来就是它自己)。v6 地址在 --resolve 里要带方括号
      const host = checked.hostname.replace(/^\[|\]$/g, '')
      if (!net.isIP(host)) {
        const port = checked.port || (checked.protocol === 'https:' ? '443' : '80')
        const addrs = (checked.validatedRecords || []).map((r) => String(r.address || '')).filter(Boolean)
          .map((a) => (net.isIPv6(a) ? `[${a}]` : a))
        if (addrs.length) args.push('--resolve', `${host}:${port}:${addrs.join(',')}`)
      }
      args.push(url)
      const { err, stdout, stderr } = await runCurl(args, timeoutMs + 5000)
      if (err && err.code === 'ENOENT') return { available: false }
      const status = Number(stdout.trim().slice(-3)) || 0
      if (status >= 300 && status < 400) {
        const location = await readLocation(headPath)
        if (!location) return { status, error: 'redirect response missing Location header' }
        if (hop >= maxRedirects) return { status, error: 'too many redirects while fetching subscription' }
        url = new URL(location, url).toString()
        continue
      }
      if (!status) return { status: 0, error: stderr.trim() || (err && err.message) || 'curl failed' }
      let text = ''
      try { text = await readFile(bodyPath, 'utf8') } catch { /* 没有正文就是空串 */ }
      return { status, text }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
