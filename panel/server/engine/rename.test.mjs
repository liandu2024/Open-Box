import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_REGION_DICT, DEFAULT_FEATURE_DICT, matchRegion, extractFeatures, renameNodes, previewRename } from './rename.mjs'
import { createNode } from './node-model.mjs'

const mk = (name) => createNode({ tag: name, type: 'trojan', server: 'a.com', server_port: 443, fields: { password: 'x', tls: { enabled: true } }, source: 'sharelink' })

test('matchRegion 覆盖缩写/中文/城市/emoji', () => {
  assert.equal(matchRegion('US-CA-01', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('洛杉矶 03', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('🇺🇸 premium', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('香港 IEPL', DEFAULT_REGION_DICT).name, '香港')
  assert.equal(matchRegion('unknown-place', DEFAULT_REGION_DICT), null)
})

test('extractFeatures 多命中按序去重', () => {
  assert.deepEqual(extractFeatures('US-IEPL-x2', DEFAULT_FEATURE_DICT), ['专线', '2x'])
  assert.deepEqual(extractFeatures('普通节点', DEFAULT_FEATURE_DICT), [])
})

test('词典结构完整', () => {
  assert.ok(DEFAULT_REGION_DICT.length >= 8)
  for (const r of DEFAULT_REGION_DICT) {
    assert.ok(r.code && r.name && Array.isArray(r.keywords) && r.keywords.length > 0)
  }
})

test('renameNodes 模板 + 序号 + 特征省略', () => {
  const out = renameNodes([mk('US-IEPL-x2 洛杉矶 01'), mk('US-IEPL 02'), mk('美国普通')])
  assert.equal(out[0].tag, '美国-专线-2x-01')
  assert.equal(out[1].tag, '美国-专线-02')
  assert.equal(out[2].tag, '美国-01')          // 无特征:省略 feature 段
})

test('renameNodes 序号按 区域+特征 组合独立递增', () => {
  const out = renameNodes([mk('香港 01'), mk('香港 02'), mk('日本 01')])
  assert.deepEqual(out.map((n) => n.tag), ['香港-01', '香港-02', '日本-01'])
})

test('renameNodes 未命中区域:归其他并保留原名', () => {
  const out = renameNodes([mk('火星基地')])
  assert.equal(out[0].tag, '其他-火星基地-01')
})

test('renameNodes 不改原对象', () => {
  const input = [mk('香港 01')]
  const before = input[0].tag
  renameNodes(input)
  assert.equal(input[0].tag, before)
})

test('previewRename 原名→新名', () => {
  const pv = previewRename([mk('US-01')])
  assert.deepEqual(pv, [{ originalTag: 'US-01', newTag: '美国-01' }])
})
