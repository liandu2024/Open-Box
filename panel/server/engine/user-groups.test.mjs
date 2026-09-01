import assert from 'node:assert/strict'
import test from 'node:test'
import { emitUserGroups, defaultGroups, normalizeGroup, GROUP_TYPES } from './user-groups.mjs'

const nodes = ['香港-01', '香港-02', '美国-01'].map((tag) => ({ tag }))

test('sing-box 只有 urltest / selector 两种组类型(Clash 的 fallback 不存在)', () => {
  assert.deepEqual([...GROUP_TYPES], ['urltest', 'selector'])
})

test('默认两个组:所有-自动(urltest) 与 所有-手动(selector),成员都是全部节点', () => {
  const { outbounds, dropped } = emitUserGroups(defaultGroups(), nodes)
  assert.equal(dropped.length, 0)
  assert.deepEqual(outbounds.map((o) => [o.tag, o.type]), [
    ['所有-自动', 'urltest'],
    ['所有-手动', 'selector'],
  ])
  assert.deepEqual(outbounds[0].outbounds, ['香港-01', '香港-02', '美国-01'])
  assert.equal(outbounds[0].interval, '3m')
  assert.equal(outbounds[0].tolerance, 50)
  // selector 不该带 urltest 才有的字段
  assert.equal(outbounds[1].interval, undefined)
  assert.equal(outbounds[1].tolerance, undefined)
})

test('allNodes 是动态的:节点变了,组的成员跟着变', () => {
  const before = emitUserGroups(defaultGroups(), nodes).outbounds[0].outbounds
  const after = emitUserGroups(defaultGroups(), [{ tag: '新节点' }]).outbounds[0].outbounds
  assert.equal(before.length, 3)
  assert.deepEqual(after, ['新节点'])
})

// 以下三条是 sing-box check 挡不住、必须由生成器自己保证的(见模块头注释)
test('成员为空的组被丢弃——留着内核会 FATAL: missing tags', () => {
  const { outbounds, dropped } = emitUserGroups(
    [{ id: 'g', name: '空组', type: 'selector', members: [] }], nodes,
  )
  assert.equal(outbounds.length, 0)
  assert.deepEqual(dropped, [{ name: '空组', reason: 'empty' }])
})

test('悬空成员被剔除,但不连累整个组', () => {
  const { outbounds } = emitUserGroups(
    [{ id: 'g', name: 'G', type: 'selector', members: ['香港-01', '并不存在的节点'] }], nodes,
  )
  assert.deepEqual(outbounds[0].outbounds, ['香港-01'])
})

test('自引用成员被剔除', () => {
  const { outbounds } = emitUserGroups(
    [{ id: 'g', name: 'G', type: 'selector', members: ['G', '美国-01'] }], nodes,
  )
  assert.deepEqual(outbounds[0].outbounds, ['美国-01'])
})

test('两个组互相引用 → 整对丢弃,不生成会在运行时打转的配置', () => {
  const { outbounds, dropped } = emitUserGroups([
    { id: 'a', name: 'A', type: 'selector', members: ['B'] },
    { id: 'b', name: 'B', type: 'selector', members: ['A'] },
  ], nodes)
  assert.equal(outbounds.length, 0)
  assert.deepEqual(dropped.map((d) => d.reason), ['cycle', 'cycle'])
})

test('组可以引用别的组(非环),按依赖顺序都能生成', () => {
  const { outbounds, dropped } = emitUserGroups([
    { id: 'a', name: '上层', type: 'selector', members: ['下层'] },
    { id: 'b', name: '下层', type: 'selector', members: ['香港-01'] },
  ], nodes)
  assert.equal(dropped.length, 0)
  assert.deepEqual(outbounds.map((o) => o.tag).sort(), ['上层', '下层'])
})

test('重复成员去重(sing-box 自己不去重)', () => {
  const { outbounds } = emitUserGroups(
    [{ id: 'g', name: 'G', type: 'selector', members: ['香港-01', '香港-01'] }], nodes,
  )
  assert.deepEqual(outbounds[0].outbounds, ['香港-01'])
})

test('normalizeGroup:非法类型回落 selector,非法容差回落默认值', () => {
  const g = normalizeGroup({ name: 'X', type: 'fallback', tolerance: -5 })
  assert.equal(g.type, 'selector')
  assert.equal(g.tolerance, undefined) // selector 不带这个字段
  const u = normalizeGroup({ name: 'Y', type: 'urltest', tolerance: 'abc' })
  assert.equal(u.tolerance, 50)
  assert.equal(u.interval, '3m')
})
