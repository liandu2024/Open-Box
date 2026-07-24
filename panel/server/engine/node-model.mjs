export const NODE_TYPES = Object.freeze([
  'shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard',
])

export const isNodeType = (value) => NODE_TYPES.includes(value)

export const createNode = (input) => {
  if (!input || typeof input !== 'object') throw new Error('node input must be an object')
  const { tag, type, server, source } = input
  if (!type || !isNodeType(type)) throw new Error(`invalid node type: ${type}`)
  if (!server || typeof server !== 'string') throw new Error('node requires a string server')
  const port = Number.parseInt(input.server_port, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid server_port: ${input.server_port}`)
  }
  if (source !== 'clash' && source !== 'sharelink' && source !== 'singbox') {
    throw new Error(`invalid source: ${source}`)
  }
  const name = typeof tag === 'string' && tag.length > 0 ? tag : `${server}:${port}`
  return {
    tag: name,
    originalTag: typeof input.originalTag === 'string' && input.originalTag.length > 0 ? input.originalTag : name,
    type,
    server,
    server_port: port,
    fields: input.fields && typeof input.fields === 'object' ? input.fields : {},
    source,
  }
}
