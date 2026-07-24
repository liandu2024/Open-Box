import { createNode, NODE_TYPES } from './node-model.mjs'

// 非节点 outbound 类型(静默忽略,不计 skipped)
const NON_NODE_TYPES = new Set(['selector', 'urltest', 'direct', 'block', 'dns'])

export const parseSingboxOutbounds = (jsonText) => {
  const nodes = []
  const skipped = []
  let doc
  try {
    doc = JSON.parse(jsonText)
  } catch {
    return { nodes, skipped }
  }
  const outbounds = doc && Array.isArray(doc.outbounds) ? doc.outbounds : []
  for (const o of outbounds) {
    if (!o || typeof o !== 'object') continue
    if (NON_NODE_TYPES.has(o.type)) continue
    if (!NODE_TYPES.includes(o.type)) {
      skipped.push({ name: o.tag, type: o.type })
      continue
    }
    const { type, tag, server, server_port, ...fields } = o
    try {
      nodes.push(createNode({ tag, type, server, server_port, fields, source: 'singbox' }))
    } catch {
      skipped.push({ name: tag, type })
    }
  }
  const endpoints = doc && Array.isArray(doc.endpoints) ? doc.endpoints : []
  for (const e of endpoints) {
    if (!e || typeof e !== 'object' || e.type !== 'wireguard') continue
    const peer = Array.isArray(e.peers) && e.peers[0] ? e.peers[0] : {}
    try {
      nodes.push(createNode({
        tag: e.tag, type: 'wireguard', server: peer.address, server_port: peer.port,
        fields: {
          private_key: e.private_key,
          peer_public_key: peer.public_key,
          local_address: Array.isArray(e.address) ? e.address : [],
          ...(peer.pre_shared_key ? { pre_shared_key: peer.pre_shared_key } : {}),
        },
        source: 'singbox',
      }))
    } catch {
      skipped.push({ name: e.tag, type: 'wireguard' })
    }
  }
  return { nodes, skipped }
}
