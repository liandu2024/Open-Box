// 测速地址默认使用 HTTP；随包内核的 Clash API 保留用户指定的协议、主机和路径。
export const DEFAULT_TEST_URL = 'http://www.gstatic.com/generate_204'
export const DEFAULT_DIRECT_TEST_URL = 'http://connectivitycheck.platform.hicloud.com/generate_204'

// 仅移除输入首尾空白，不替换用户指定的检测地址或协议。
export const kernelTestUrl = (raw) => typeof raw === 'string' ? raw.trim() : ''

// 只迁移旧版内置默认值；自定义 HTTP / HTTPS 地址保持不变。
export const ensureTestUrlDefaults = (store) => {
  const profile = store.getProfile() || {}
  const patch = {}
  if (profile.testUrl === 'https://www.gstatic.com/generate_204') patch.testUrl = DEFAULT_TEST_URL
  if (['https://connectivitycheck.platform.hicloud.com/generate_204', 'http://www.msftconnecttest.com/connecttest.txt'].includes(profile.directTestUrl)) {
    patch.directTestUrl = DEFAULT_DIRECT_TEST_URL
  }
  if (!Object.keys(patch).length) return false
  store.setProfile(patch)
  return true
}
