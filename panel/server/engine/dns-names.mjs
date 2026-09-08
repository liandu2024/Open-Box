import { domainToASCII } from 'node:url'

// 能安全写进 dnsmasq `server=/域名/` 的域名。非 ASCII 的先按 IDNA 转成 punycode(中文.example →
// xn--fiq228c.example:查询报文里跑的本来就是这个形态,精确匹配范围没变);转不了、标签超长、
// 带控制字符 / `#` / `/` 之类会改变语义或让 dnsmasq 拒绝启动的一律判为不可写。
// 前面的 `*.` / `.` 是用户写后缀的习惯,去掉;末尾的点去掉。
const DNS_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i
export const dnsmasqSafeDomain = (raw) => {
  let d = String(raw || '').trim().toLowerCase().replace(/^\*\./, '').replace(/^\.+/, '').replace(/\.+$/, '')
  if (!d || d.length > 253) return null
  if (/[^\x21-\x7e]/.test(d)) {
    const ascii = domainToASCII(d)
    if (!ascii) return null
    d = ascii
  }
  const labels = d.split('.')
  if (!labels.every((l) => DNS_LABEL.test(l))) return null
  return d
}
