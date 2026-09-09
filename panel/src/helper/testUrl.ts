// 测速地址给内核用之前的规范化(和 server/engine/test-url.mjs 同一套规则)。
//
// sing-box 的 clash API(/proxies/:name/delay、/group/:name/delay)对 http:// 的测速地址一律不认:直接丢掉,
// 换成它内置的 https://www.gstatic.com/generate_204 去测。用户把地址改成 http://cp.cloudflare.com/generate_204
// 之类,代理页测出来的其实还是 gstatic——「改测速地址不生效」(#35)。所以发给内核之前 http:// 一律升成 https://;
// 两个老默认值(http 的 gstatic、直连的 msftconnecttest——它没有 https)直接换成新默认。
import { DIRECT_TEST_URL, TEST_URL } from '@/constant'

const LEGACY: Record<string, string> = {
  'http://www.gstatic.com/generate_204': TEST_URL,
  'http://www.msftconnecttest.com/connecttest.txt': DIRECT_TEST_URL,
}

export const kernelTestUrl = (raw: string | undefined | null): string => {
  const url = (raw ?? '').trim()
  if (!url) return ''
  const legacy = LEGACY[url]
  if (legacy) return legacy
  return /^http:\/\//i.test(url) ? `https://${url.slice('http://'.length)}` : url
}
