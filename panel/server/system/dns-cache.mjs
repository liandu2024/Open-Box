import { CLASH_API_BASE } from '../api/penetration.mjs'

// 清空内核的 DNS 缓存(clash_api 的 POST /cache/dns/flush,sing-box 1.13.14 实测回 204)。
//
// 为什么要清:走代理的域名是经节点问 1.1.1.1 的,内核把答案缓存下来——正式路由器实测
// 首次 67 到 246ms,命中缓存 1ms,所以缓存本身很值,平时不该关。但这份缓存不分线路:
// 换了节点,TTL 没过之前拿到的还是上一条线路问出来的地址,连上去的 CDN 就不是新线路
// 就近的那个。
//
// 所以只在两处清:换了出口之后(见 index.mjs),和用户点「重新测试」要看真实路由时
// (见 api/route-test.mjs)。清完下一次查询重新经当前线路问,几十毫秒,值。
export const flushDnsCache = async (fetchImpl = globalThis.fetch, secret = '', timeoutMs = 3000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${CLASH_API_BASE}/cache/dns/flush`, {
      method: 'POST',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      signal: controller.signal,
    })
    return res.ok
  } catch {
    // 内核没在跑、或者这个版本没有这个接口:清不了就算了,不该让调用方的主流程失败
    return false
  } finally {
    clearTimeout(timer)
  }
}
