import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerShareRoutes } from './share.mjs'
import { shareTokenFor } from '../engine/share-link.mjs'

const server = { id: 'a1', enabled: true, name: 'ss', protocol: 'shadowsocks', port: 8388, address: 'h.com', method: 'aes-256-gcm', password: 'pw' }
const store = { getProfile: () => ({ servers: [server, { ...server, id: 'noaddr', address: '' }] }), getClashSecret: () => 'sec' }

const startApp = async () => {
  const app = express()
  registerShareRoutes(app, { store })
  const srv = app.listen(0)
  await new Promise((r) => srv.once('listening', r))
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) }
}

test('订阅接口:对的令牌给 base64 内容,raw=1 给明文;错令牌 404;没地址 409', async () => {
  const { base, close } = await startApp()
  try {
    const token = shareTokenFor('sec', server)
    const ok = await fetch(`${base}/api/openbox/share/a1/${token}`)
    assert.equal(ok.status, 200)
    const body = Buffer.from(await ok.text(), 'base64').toString('utf8')
    assert.match(body, /^ss:\/\/.*@h\.com:8388#ss\n$/)
    const raw = await (await fetch(`${base}/api/openbox/share/a1/${token}?raw=1`)).text()
    assert.match(raw, /^ss:\/\//)
    assert.equal((await fetch(`${base}/api/openbox/share/a1/badtoken`)).status, 404)
    assert.equal((await fetch(`${base}/api/openbox/share/nope/${token}`)).status, 404)
    assert.equal((await fetch(`${base}/api/openbox/share/noaddr/${shareTokenFor('sec', { ...server, id: 'noaddr' })}`)).status, 409)
  } finally {
    await close()
  }
})
