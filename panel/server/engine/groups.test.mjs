import assert from 'node:assert/strict'
import test from 'node:test'
import { groupNodesByRegion, buildProxyGroupModel } from './groups.mjs'
import { createNode } from './node-model.mjs'

const mk = (tag) => createNode({ tag, type: 'trojan', server: 'a.com', server_port: 443, fields: { password: 'x', tls: { enabled: true } }, source: 'sharelink' })

test('groupNodesByRegion 按区域首段聚合,默认 urltest', () => {
  const { groups } = groupNodesByRegion([mk('美国-专线-01'), mk('美国-02'), mk('日本-01')])
  assert.deepEqual(groups.map((g) => g.name), ['美国', '日本'])
  assert.equal(groups[0].type, 'urltest')
  assert.deepEqual(groups[0].nodeTags, ['美国-专线-01', '美国-02'])
  assert.deepEqual(groups[1].nodeTags, ['日本-01'])
})

test('groupNodesByRegion 支持 select 组类型', () => {
  const { groups } = groupNodesByRegion([mk('香港-01')], { groupType: 'select' })
  assert.equal(groups[0].type, 'select')
})

test('buildProxyGroupModel 汇总所有区域组名', () => {
  const model = buildProxyGroupModel([mk('美国-01'), mk('日本-01')])
  assert.deepEqual(model.allGroupTags, ['美国', '日本'])
  assert.equal(model.regionGroups.length, 2)
})

test('空输入', () => {
  assert.deepEqual(groupNodesByRegion([]).groups, [])
})
