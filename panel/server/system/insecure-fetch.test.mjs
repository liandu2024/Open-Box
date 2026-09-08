import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import https from 'node:https'
import { subscriptionFetch } from './insecure-fetch.mjs'

// 测试专用的自签证书(CN=selfsigned.test,100 年有效),只用来证明"不校验证书也能拉"
const SELF_SIGNED_KEY = `-----BEGIN PRIVATE KEY-----
MIIBeQIBADCCAQMGByqGSM49AgEwgfcCAQEwLAYHKoZIzj0BAQIhAP////8AAAAB
AAAAAAAAAAAAAAAA////////////////MFsEIP////8AAAABAAAAAAAAAAAAAAAA
///////////////8BCBaxjXYqjqT57PrvVV2mIa8ZR0GsMxTsPY7zjw+J9JgSwMV
AMSdNgiG5wSTamZ44ROdJreBn36QBEEEaxfR8uEsQkf4vOblY6RA8ncDfYEt6zOg
9KE5RdiYwpZP40Li/hp/m47n60p8D54WK84zV2sxXs7LtkBoN79R9QIhAP////8A
AAAA//////////+85vqtpxeehPO5ysL8YyVRAgEBBG0wawIBAQQgc2VRUsmKn51R
BL3Ck38YlAAXR6ogSg6l7uLh8V8bgcChRANCAATQsnD41Gd3WKqcSgHyZYjLp9qo
z8Lu22BuCZ1NS4EIuhdY2ObkJqWpDemvSSVcWuoLIu3BrQnpgdCXhH9KUh0K
-----END PRIVATE KEY-----`
const SELF_SIGNED_CERT = `-----BEGIN CERTIFICATE-----
MIICGTCCAcACCQDZuw/+tQnfvDAKBggqhkjOPQQDAjAaMRgwFgYDVQQDDA9zZWxm
c2lnbmVkLnRlc3QwIBcNMjYwOTAzMTA1MDUxWhgPMjEyNjA4MTAxMDUwNTFaMBox
GDAWBgNVBAMMD3NlbGZzaWduZWQudGVzdDCCAUswggEDBgcqhkjOPQIBMIH3AgEB
MCwGByqGSM49AQECIQD/////AAAAAQAAAAAAAAAAAAAAAP///////////////zBb
BCD/////AAAAAQAAAAAAAAAAAAAAAP///////////////AQgWsY12Ko6k+ez671V
dpiGvGUdBrDMU7D2O848PifSYEsDFQDEnTYIhucEk2pmeOETnSa3gZ9+kARBBGsX
0fLhLEJH+Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT+NC4v4af5uO5+tKfA+eFivO
M1drMV7Oy7ZAaDe/UfUCIQD/////AAAAAP//////////vOb6racXnoTzucrC/GMl
UQIBAQNCAATQsnD41Gd3WKqcSgHyZYjLp9qoz8Lu22BuCZ1NS4EIuhdY2ObkJqWp
DemvSSVcWuoLIu3BrQnpgdCXhH9KUh0KMAoGCCqGSM49BAMCA0cAMEQCIFATH5MC
ciJhAJAd6ujPQRySzGm0K2TIT2/vmxvP024dAiAWgDUFn0XfvymsLbljfT3hhyW0
+PAV9fLkXf8muPmmvA==
-----END CERTIFICATE-----`

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const close = (server) => new Promise((resolve) => server.close(resolve))

test('subscriptionFetch:自签证书的 https 也能拉到内容,Response 形状与 fetch 一致', async () => {
  const server = https.createServer({ key: SELF_SIGNED_KEY, cert: SELF_SIGNED_CERT }, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'x-ua': req.headers['user-agent'] || '' })
    res.end('ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388#HK-01')
  })
  const port = await listen(server)
  try {
    const url = `https://127.0.0.1:${port}/sub`
    // 系统 fetch 对同一个地址是拒绝的(证明测试环境没有全局放行)
    await assert.rejects(fetch(url), (e) => /fetch failed/.test(e.message))
    const res = await subscriptionFetch(url, { redirect: 'manual', headers: { 'User-Agent': 'clash-verge/v2.0.0' } })
    assert.equal(res.status, 200)
    assert.equal(res.ok, true)
    assert.equal(res.headers.get('x-ua'), 'clash-verge/v2.0.0')
    assert.ok(typeof res.body.getReader === 'function')
    assert.match(await res.text(), /^ss:\/\//)
  } finally {
    await close(server)
  }
})

test('subscriptionFetch:3xx 不自动跟随,原样返回给调用方逐跳校验;204 没有 body', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/r') { res.writeHead(302, { location: 'http://example.test/next' }); res.end(); return }
    res.writeHead(204); res.end()
  })
  const port = await listen(server)
  try {
    const r = await subscriptionFetch(`http://127.0.0.1:${port}/r`, { redirect: 'manual' })
    assert.equal(r.status, 302)
    assert.equal(r.headers.get('location'), 'http://example.test/next')
    const n = await subscriptionFetch(`http://127.0.0.1:${port}/n`)
    assert.equal(n.status, 204)
    assert.equal(n.body, null)
    await assert.rejects(subscriptionFetch('file:///etc/passwd'), /unsupported protocol/)
  } finally {
    await close(server)
  }
})

// 审查第 5 项:init.lookup 接到 node:http 的 lookup 上,连的是校验过的地址,Host 仍是域名
test('insecureFetch:带 init.lookup 时按它给的地址建连,不再解析域名;Host 头仍是原域名', async () => {
  const seen = []
  const server = http.createServer((req, res) => { seen.push(req.headers.host); res.end('pinned-ok') })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  try {
    // 用 net-guard 真正的 pinnedLookup:node:net 在新版本里带 { all: true } 调 lookup、要的是数组,手写桩容易漏这一点
    const { pinnedLookup } = await import('../api/net-guard.mjs')
    const lookup = pinnedLookup([{ address: '127.0.0.1', family: 4 }])
    const res = await subscriptionFetch(`http://never-resolves.invalid:${port}/sub`, { lookup })
    assert.equal(res.status, 200)
    assert.equal(await res.text(), 'pinned-ok')
    assert.deepEqual(seen, [`never-resolves.invalid:${port}`])
  } finally {
    await new Promise((r) => server.close(r))
  }
})

// 有的机场一个响应头就超过 Node 默认的 16KB 上限(很长的 subscription-userinfo、一堆
// set-cookie),整个订阅 HPE_HEADER_OVERFLOW 拉不下来(GitHub #3)。订阅专用的 fetch 放宽到 64KB。
test('subscriptionFetch:响应头超过 16KB 也能拉(机场的超长响应头)', async () => {
  const big = 'x'.repeat(40 * 1024)
  const server = http.createServer((req, res) => {
    res.setHeader('subscription-userinfo', big)
    res.end('nodes')
  })
  const port = await listen(server)
  try {
    const r = await subscriptionFetch(`http://127.0.0.1:${port}/sub`)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('subscription-userinfo')?.length, big.length)
    assert.equal(await r.text(), 'nodes')
  } finally {
    await close(server)
  }
})
