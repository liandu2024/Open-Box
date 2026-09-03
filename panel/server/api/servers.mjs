// 共享网络 · 端口检测:GET /api/openbox/servers/port-check?port=N&id=<自己的 id>
// 三类冲突:面板/内核自用端口、列表里另一台服务器、路由器上正在监听的端口(读
// /proc/net/tcp|tcp6|udp|udp6)。编辑已在跑的那台自己占着的端口不算冲突。
import express from 'express'
import { RESERVED_PORTS } from '../engine/servers.mjs'

const TCP_LISTEN = '0A'

// 一行 "sl local_address rem_address st ..." → { port, state }
export const parseProcNet = (text) => {
  const out = []
  for (const line of String(text || '').split('\n').slice(1)) {
    const f = line.trim().split(/\s+/)
    if (f.length < 4) continue
    const port = parseInt(f[1].split(':').pop(), 16)
    if (Number.isFinite(port)) out.push({ port, state: f[3] })
  }
  return out
}

export const listeningPorts = async (ctx) => {
  const ports = new Set()
  for (const [file, isTcp] of [['/proc/net/tcp', true], ['/proc/net/tcp6', true], ['/proc/net/udp', false], ['/proc/net/udp6', false]]) {
    let text = ''
    try { text = await ctx.readFile(file) } catch { continue }
    for (const row of parseProcNet(text)) {
      if (!isTcp || row.state === TCP_LISTEN) ports.add(row.port)
    }
  }
  return ports
}

export const checkServerPort = async ({ store, ctx }, { port, id }) => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: 'invalid' }
  if (RESERVED_PORTS.has(port)) return { ok: false, reason: 'reserved' }
  const servers = Array.isArray(store.getProfile().servers) ? store.getProfile().servers : []
  const other = servers.find((s) => s && s.id !== id && s.port === port)
  if (other) return { ok: false, reason: 'server', name: other.name || other.id }
  // 自己已经保存过且端口没变:内核里占着这个口的就是它自己
  const self = servers.find((s) => s && s.id === id)
  if (self && self.port === port) return { ok: true }
  if (ctx && (await listeningPorts(ctx)).has(port)) return { ok: false, reason: 'listening' }
  return { ok: true }
}

export const registerServerRoutes = (app, { store, ctx } = {}) => {
  const router = express.Router()
  router.get('/servers/port-check', async (req, res) => {
    const port = Number(req.query.port)
    const id = typeof req.query.id === 'string' ? req.query.id : ''
    res.json(await checkServerPort({ store, ctx }, { port, id }))
  })
  app.use('/api/openbox', router)
}
