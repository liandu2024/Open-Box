import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { checkConfig, validateConfigObject, attributeBadNodes } from './validate.mjs'

const paths = createPaths('/opt/open-box')

test('checkConfig 通过', async () => {
  const ctx = createMockContext({ execResults: { '/opt/open-box/bin/sing-box check -c /tmp/c.json': { code: 0 } } })
  const r = await checkConfig(ctx, paths, '/tmp/c.json')
  assert.equal(r.ok, true)
})

test('checkConfig 失败带 message', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1, stderr: 'FATAL[0000] initialize outbound[1]: unknown method: x\n' } })
  const r = await checkConfig(ctx, paths, '/tmp/c.json')
  assert.equal(r.ok, false)
  assert.match(r.message, /unknown method/)
})

test('validateConfigObject 写临时文件并 check', async () => {
  const ctx = createMockContext()
  const r = await validateConfigObject(ctx, paths, { log: { level: 'warn' } }, '/tmp/v.json')
  assert.equal(r.ok, true)
  assert.equal(ctx.writes[0].path, '/tmp/v.json')
  assert.deepEqual(JSON.parse(ctx.writes[0].content), { log: { level: 'warn' } })
})

test('attributeBadNodes 定位坏节点', async () => {
  const config = {
    outbounds: [
      { type: 'direct', tag: 'direct' },
      { type: 'selector', tag: 'PROXY', outbounds: ['good'] },
      { type: 'shadowsocks', tag: 'good', server: 'a', server_port: 1, method: 'aes-256-gcm', password: 'p' },
      { type: 'shadowsocks', tag: 'bad', server: 'a', server_port: 1, method: 'nope', password: 'p' },
    ],
  }
  // 让含 "nope" 的那次 check 失败:用 defaultExec 成功,单独编排失败键
  const ctx = createMockContext({
    execResults: {},
    defaultExec: { code: 0 },
  })
  // 通过覆写 exec 精确模拟:按最近一次写入的探针内容判定该次 check 是否失败
  const realExec = ctx.exec
  ctx.exec = async (cmd, args) => {
    const call = await realExec(cmd, args)
    const written = ctx.writes[ctx.writes.length - 1]
    if (written && written.content.includes('"method":"nope"')) return { code: 1, stdout: '', stderr: 'unknown method: nope' }
    return call
  }
  const r = await attributeBadNodes(ctx, paths, config, '/tmp/n.json')
  assert.deepEqual(r.badTags, ['bad'])
  assert.equal(r.checked, 2)   // 只检代理节点,不检 direct/selector
})
