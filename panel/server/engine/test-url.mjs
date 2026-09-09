// 测速地址:默认值、给内核用之前的规范化、老默认值的迁移。
//
// sing-box 的 clash API(/proxies/:name/delay、/group/:name/delay)对 http:// 的测速地址一律不认:
// 直接丢掉,换成它内置的 https://www.gstatic.com/generate_204 去测(experimental/clashapi/proxies.go、
// api_meta_group.go 里都是 `if strings.HasPrefix(url, "http://") { url = "" }`)。用户把地址改成
// http://cp.cloudflare.com/generate_204 之类,面板 / 定时测速 / 故障转移探测测的其实还是 gstatic——
// 「改测速地址不生效」(#35);内置直连的老默认 http://www.msftconnecttest.com/connecttest.txt 同理,
// 直连测的一直是 Google,国内直连必然超时。
//
// 所以:凡是要经 clash API 测的地址先过 kernelTestUrl(http:// 升成 https://);自动择优组配置里的
// url 是内核自己定时用的,http 照常认,但默认值也统一成 https,一个地址各处一致。
// 两个老默认值单独映射:老的 http gstatic 对应新默认;老的直连默认 msftconnecttest 没有 https,
// 升成 https 只会 TLS 失败,直接换成新的直连默认(华为的 204,国内直连可达)。
export const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204'
export const DEFAULT_DIRECT_TEST_URL = 'https://connectivitycheck.platform.hicloud.com/generate_204'

const LEGACY_TEST_URL = 'http://www.gstatic.com/generate_204'
const LEGACY_DIRECT_TEST_URL = 'http://www.msftconnecttest.com/connecttest.txt'
const LEGACY = new Map([
  [LEGACY_TEST_URL, DEFAULT_TEST_URL],
  [LEGACY_DIRECT_TEST_URL, DEFAULT_DIRECT_TEST_URL],
])

// 给内核 clash API 用的地址:去首尾空白,老默认值换新默认,http:// 升 https://;空的原样返回空
export const kernelTestUrl = (raw) => {
  const url = typeof raw === 'string' ? raw.trim() : ''
  if (!url) return ''
  const legacy = LEGACY.get(url)
  if (legacy) return legacy
  return /^http:\/\//i.test(url) ? `https://${url.slice('http://'.length)}` : url
}

// 启动时把档案里还是老默认值的两个地址换成新默认(用户自己改过的不动)。返回是否写过
export const ensureTestUrlDefaults = (store) => {
  const profile = store.getProfile() || {}
  const patch = {}
  if (profile.testUrl === LEGACY_TEST_URL) patch.testUrl = DEFAULT_TEST_URL
  if (profile.directTestUrl === LEGACY_DIRECT_TEST_URL) patch.directTestUrl = DEFAULT_DIRECT_TEST_URL
  if (!Object.keys(patch).length) return false
  store.setProfile(patch)
  return true
}
