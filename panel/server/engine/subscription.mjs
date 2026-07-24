import { decodeBase64, isProbablyBase64 } from './codec.mjs'
import { parseShareLink } from './sharelink.mjs'
import { parseClashProxies } from './clash.mjs'
import { parseSingboxOutbounds } from './singbox-in.mjs'

const SHARELINK_PREFIX = /^(ss|ssr|vmess|vless|trojan|hysteria2|hy2|tuic):\/\//

export const detectSubscriptionFormat = (text) => {
  const trimmed = String(text || '').trim()
  if (!trimmed) return 'unknown'
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const doc = JSON.parse(trimmed)
      if (doc && Array.isArray(doc.outbounds)) return 'singbox'
    } catch { /* not json */ }
  }
  if (/^\s*proxies\s*:/m.test(trimmed) || /\n\s*proxies\s*:/.test('\n' + trimmed)) return 'clash'
  const firstLine = trimmed.split(/\r?\n/).find((l) => l.trim().length > 0) || ''
  if (SHARELINK_PREFIX.test(firstLine.trim())) return 'sharelink'
  return 'unknown'
}

const parseSharelinkLines = (text) => {
  const nodes = []
  const skipped = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const node = parseShareLink(line)
    if (node) nodes.push(node)
    else skipped.push({ name: line.slice(0, 40), type: 'sharelink' })
  }
  return { nodes, skipped }
}

export const parseSubscription = (text) => {
  let content = String(text || '')
  // base64 信封:整段像 base64 且不含明显的格式标志时,先解包一层
  const trimmed = content.trim()
  if (isProbablyBase64(trimmed) && !SHARELINK_PREFIX.test(trimmed) && !trimmed.startsWith('{')) {
    try {
      const decoded = decodeBase64(trimmed)
      if (decoded && detectSubscriptionFormat(decoded) !== 'unknown') content = decoded
    } catch { /* keep original */ }
  }
  const format = detectSubscriptionFormat(content)
  if (format === 'clash') return { ...parseClashProxies(content), format }
  if (format === 'singbox') return { ...parseSingboxOutbounds(content), format }
  if (format === 'sharelink') return { ...parseSharelinkLines(content), format }
  return { nodes: [], skipped: [], format: 'unknown' }
}
