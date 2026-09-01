import assert from 'node:assert/strict'
import test from 'node:test'
import { createNode, NODE_TYPES, isNodeType } from './node-model.mjs'

test('createNode 规范化端口为整数并回填 originalTag', () => {
  const n = createNode({ tag: '美国 01', type: 'shadowsocks', server: 'a.com', server_port: '443', source: 'clash' })
  assert.equal(n.server_port, 443)
  assert.equal(n.originalTag, '美国 01')
  assert.deepEqual(n.fields, {})
})

test('createNode 保留显式 originalTag 与 fields', () => {
  const n = createNode({ tag: 'x', originalTag: 'orig', type: 'vmess', server: 'a', server_port: 1, fields: { uuid: 'u' }, source: 'sharelink' })
  assert.equal(n.originalTag, 'orig')
  assert.equal(n.fields.uuid, 'u')
})

test('createNode 缺 server 抛错', () => {
  assert.throws(() => createNode({ tag: 'x', type: 'trojan', server_port: 1, source: 'clash' }), /server/)
})

test('createNode 非法端口抛错', () => {
  assert.throws(() => createNode({ tag: 'x', type: 'trojan', server: 'a', server_port: 'abc', source: 'clash' }), /port/)
})

test('NODE_TYPES 覆盖八协议,isNodeType 判定', () => {
  assert.deepEqual([...NODE_TYPES].sort(), ['anytls','hysteria2','shadowsocks','trojan','tuic','vless','vmess','wireguard'])
  assert.equal(isNodeType('vless'), true)
  // anytls 是第八个:真机上遇到过整个订阅 35 个节点全是 anytls 的机场,不支持就是 0 个节点
  assert.equal(isNodeType('anytls'), true)
  // 换一个确实不支持的类型继续守住"未知类型判 false"这条
  assert.equal(isNodeType('ssh'), false)
})
