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
  return { nodes, skipped }
}
