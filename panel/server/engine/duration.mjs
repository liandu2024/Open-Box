// sing-box 的时长写法:5m、1h30m、90s、250ms;纯数字当秒。解析不出来返回 0。
export const parseDuration = (raw) => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw * 1000
  const text = String(raw || '').trim()
  if (!text) return 0
  if (/^\d+$/.test(text)) return Number(text) * 1000
  let total = 0
  let matched = false
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true
    const n = Number(m[1])
    total += m[2] === 'h' ? n * 3600_000 : m[2] === 'm' ? n * 60_000 : m[2] === 's' ? n * 1000 : n
  }
  return matched ? total : 0
}
