import assert from 'node:assert/strict'
import test from 'node:test'
import { detectSubscriptionFormat, parseSubscription } from './subscription.mjs'

test('detectSubscriptionFormat', () => {
  assert.equal(detectSubscriptionFormat('proxies:\n  - name: a\n    type: ss'), 'clash')
  assert.equal(detectSubscriptionFormat('{"outbounds":[]}'), 'singbox')
  assert.equal(detectSubscriptionFormat('ss://abc#x\nvmess://def'), 'sharelink')
})

test('parseSubscription base64 信封解包 + sharelink 按行', () => {
  const raw = 'ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388#HK\nvmess://' +
    Buffer.from(JSON.stringify({ ps: 'US', add: 'us.com', port: '443', id: 'u', aid: '0', net: 'tcp' })).toString('base64')
  const envelope = Buffer.from(raw).toString('base64')
  const { nodes, format } = parseSubscription(envelope)
  assert.equal(format, 'sharelink')
  assert.deepEqual(nodes.map((n) => n.originalTag).sort(), ['HK', 'US'])
})

test('parseSubscription 直接 Clash 文本', () => {
  const { nodes, format } = parseSubscription('proxies:\n  - {name: A, type: ss, server: a.com, port: 8388, cipher: aes-256-gcm, password: pw}')
  assert.equal(format, 'clash')
  assert.equal(nodes[0].originalTag, 'A')
})

test('parseSubscription 无法识别的 sharelink 行计入 skipped', () => {
  const { nodes, skipped, format } = parseSubscription('ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388#HK\ngarbage-line')
  assert.equal(format, 'sharelink')
  assert.equal(nodes.length, 1)
  assert.equal(skipped.length, 1)
})

test('detectSubscriptionFormat/parseSubscription 首行为注释时仍识别 sharelink(修复8)', () => {
  const text = '# remark\nss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388#HK'
  assert.equal(detectSubscriptionFormat(text), 'sharelink')
  const { nodes, format } = parseSubscription(text)
  assert.equal(format, 'sharelink')
  assert.equal(nodes.length, 1)
})
