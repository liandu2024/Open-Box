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
test('成员为空的组挂 PROXY 占位:照样写进配置,但不能是空 outbounds(内核会 FATAL)', () => {
  const { outbounds, dropped, placeholders } = emitUserGroups(
    [{ id: 'g', name: '空组', type: 'selector', members: [] }], nodes,
  )
  assert.deepEqual(outbounds, [{ type: 'selector', tag: '空组', outbounds: ['PROXY'] }])
  assert.deepEqual(dropped, [])
  assert.deepEqual(placeholders, ['空组'])
})

test('占位用的 tag 跟着 proxyTag 走', () => {
  const { outbounds } = emitUserGroups(
    [{ id: 'g', name: '空组', type: 'selector', members: [] }], nodes, { proxyTag: '出口' },
  )
  assert.deepEqual(outbounds[0].outbounds, ['出口'])
})

test('组名正好等于 proxyTag 时占位退回 direct,不能自己引用自己', () => {
  const { outbounds } = emitUserGroups(
    [{ id: 'g', name: 'PROXY', type: 'selector', members: [] }], nodes,
  )
  assert.deepEqual(outbounds[0].outbounds, ['direct'])
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

// -------- 动态组(按关键词现挑成员) --------

const nodesOf = (...tags) => tags.map((tag) => ({ tag }))

test('动态组按关键词从当前节点里挑成员', () => {
  const { outbounds } = emitUserGroups(
    [{ id: 'g1', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: ['香港'] }],
    nodesOf('破晓 | 香港-01', '破晓 | 台湾-01', '备用 | 香港-02'),
  )
  assert.deepEqual(outbounds[0].outbounds, ['破晓 | 香港-01', '备用 | 香港-02'])
})

test('动态组不带关键词 = 全部节点', () => {
  const { outbounds } = emitUserGroups(
    [{ id: 'g1', name: '全部', type: 'selector', mode: 'dynamic', keywords: [] }],
    nodesOf('A', 'B'),
  )
  assert.deepEqual(outbounds[0].outbounds, ['A', 'B'])
})

test('动态组只认节点,不会把同名命中的别的组吸进来(否则凭空成环)', () => {
  const { outbounds } = emitUserGroups(
    [
      { id: 'g1', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: ['香港'] },
      { id: 'g2', name: '香港-手动', type: 'selector', mode: 'dynamic', keywords: ['香港'] },
    ],
    nodesOf('香港-01'),
  )
  assert.deepEqual(outbounds.map((o) => o.outbounds), [['香港-01'], ['香港-01']])
})

test('关键词匹配与地区词典同一套规则:国旗 emoji 能被 hk 命中', () => {
  const { outbounds } = emitUserGroups(
    [{ id: 'g1', name: '香港', type: 'selector', mode: 'dynamic', keywords: ['hk'] }],
    nodesOf('🇭🇰香港 01', '美国 01'),
  )
  assert.deepEqual(outbounds[0].outbounds, ['🇭🇰香港 01'])
})

test('动态组一个都没命中也照样写进配置,挂 PROXY 占位等以后的节点', () => {
  // 用户建「爱尔兰-自动」就是在等以后有爱尔兰节点;组要是被丢掉,指向它的分流
  // 规则还得回去重挑目标
  const { outbounds, dropped, placeholders } = emitUserGroups(
    [{ id: 'g1', name: '火星', type: 'selector', mode: 'dynamic', keywords: ['火星'] }],
    nodesOf('香港-01'),
  )
  assert.deepEqual(outbounds, [{ type: 'selector', tag: '火星', outbounds: ['PROXY'] }])
  assert.deepEqual(dropped, [])
  assert.deepEqual(placeholders, ['火星'])
})

test('老记录的 allNodes:true 迁移成"不带关键词的动态组",行为不变', () => {
  const g = normalizeGroup({ id: 'x', name: '所有', type: 'selector', allNodes: true })
  assert.equal(g.mode, 'dynamic')
  assert.deepEqual(g.keywords, [])
  const { outbounds } = emitUserGroups([g], nodesOf('A', 'B'))
  assert.deepEqual(outbounds[0].outbounds, ['A', 'B'])
})

test('没写 mode 的老记录默认是静态组:成员照旧按 members 走', () => {
  const g = normalizeGroup({ id: 'x', name: '手挑', type: 'selector', members: ['A'] })
  assert.equal(g.mode, 'static')
  const { outbounds } = emitUserGroups([g], nodesOf('A', 'B'))
  assert.deepEqual(outbounds[0].outbounds, ['A'])
})

test('图标存国家代码并统一成大写;不写就是空', () => {
  assert.equal(normalizeGroup({ id: 'x', name: 'n', icon: 'hk' }).icon, 'HK')
  assert.equal(normalizeGroup({ id: 'x', name: 'n' }).icon, '')
})

test('地球图标统一成小写,不能跟着国家代码转大写', () => {
  // 界面按这个值查图标:变成 GLOBE:ASIA 就查不到,直接显示空白(本地跑的时候就这么中过)
  assert.equal(normalizeGroup({ id: 'x', name: 'n', icon: 'globe:asia' }).icon, 'globe:asia')
  assert.equal(normalizeGroup({ id: 'x', name: 'n', icon: 'GLOBE:EARTH-ASIA' }).icon, 'globe:earth-asia')
})

test('图标不进 sing-box 出站:那边没有这个字段', () => {
  const { outbounds } = emitUserGroups(
    [{ id: 'g1', name: '香港', type: 'selector', mode: 'dynamic', keywords: [], icon: 'HK' }],
    nodesOf('A'),
  )
  assert.ok(!('icon' in outbounds[0]), '出站里不该出现 icon')
})

test('两个默认组自带地球图标:跨地区的组配国旗都不对,也不该新装出来是空的', () => {
  assert.deepEqual(
    defaultGroups().map((g) => [g.name, g.icon]),
    [['所有-自动', 'globe:earth-asia'], ['所有-手动', 'globe:earth-meridians']],
  )
})
