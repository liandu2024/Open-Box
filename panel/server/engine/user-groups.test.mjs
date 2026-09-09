import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILTIN_IDS, builtinTags, emitUserGroups, defaultGroups, normalizeGroup, normalizeGroups, GROUP_TYPES, FAILOVER_REJECT_TAG, isInternalTag } from './user-groups.mjs'

const nodes = ['香港-01', '香港-02', '美国-01'].map((tag) => ({ tag }))

// emitUserGroups 的输出永远以两个内置出站(直连/拒绝)开头;大多数用例只关心用户的组
const userOnly = (outbounds) => outbounds.filter((o) => o.type !== 'direct' && o.type !== 'block')
const emitUser = (groups, ns) => {
  const r = emitUserGroups(groups, ns)
  return { ...r, outbounds: userOnly(r.outbounds) }
}

test('组类型:内核只有 urltest / selector,failover 是应用层类型(内核里落成 selector + 内部 urltest)', () => {
  assert.deepEqual([...GROUP_TYPES], ['urltest', 'selector', 'failover'])
})

const failoverGroup = (over = {}) => ({
  id: 'fo1', name: '主备', type: 'failover',
  lanes: [
    { id: 'A', name: '主用', members: ['香港-01'] },
    { id: 'B', name: '', members: ['香港-02', '美国-01'] },
  ],
  ...over,
})

test('故障转移:归一化后固定静态、members/keywords 清空、lanes 去重补 id、参数越界回默认', () => {
  const g = normalizeGroup({
    ...failoverGroup({ mode: 'dynamic', members: ['x'], keywords: ['y'], interval: '1s', tolerance: -5,
      failover: { timeoutMs: 999999, failureThreshold: 0, restorePrimary: false, recoveryHoldMs: 'abc' } }),
    lanes: [
      { id: 'A', members: ['香港-01', '香港-01', '', 3] },
      { members: ['香港-02'] },
      { id: 'A', name: ' 备 ', members: [] },
    ],
  })
  assert.equal(g.type, 'failover')
  assert.equal(g.mode, 'static')
  assert.deepEqual(g.members, [])
  assert.deepEqual(g.keywords, [])
  assert.deepEqual(g.lanes, [
    { id: 'A', name: '', icon: '', members: ['香港-01'] },
    { id: 'lane-2', name: '', icon: '', members: ['香港-02'] },
    { id: 'A~', name: '备', icon: '', members: [] },
  ])
  assert.equal(g.interval, '30s')
  assert.equal(g.tolerance, 100)
  assert.deepEqual(g.failover, { timeoutMs: 5000, failureThreshold: 2, restorePrimary: false, recoveryHoldMs: 60000 })
  // 页签最多 3 个,多出来的读取时丢掉(写入时 API 直接拒)
  const many = normalizeGroup(failoverGroup({ lanes: [1, 2, 3, 4, 5].map((i) => ({ id: `L${i}`, members: ['香港-01'] })) }))
  assert.deepEqual(many.lanes.map((l) => l.id), ['L1', 'L2', 'L3'])
})

test('故障转移:单节点页签直接引用节点,多节点页签生成内部 urltest 子组;父组是 selector,默认主用,末位兜底拒绝', () => {
  const { outbounds, failover, internalTags, publicTags } = emitUser([...defaultGroups(), failoverGroup()], nodes)
  const parent = outbounds.find((o) => o.tag === '主备')
  const sub = outbounds.find((o) => o.type === 'urltest' && isInternalTag(o.tag))
  assert.ok(sub, '多节点页签应生成内部 urltest 子组')
  assert.equal(sub.tag, '__fo:fo1:B')
  assert.deepEqual(sub.outbounds, ['香港-02', '美国-01'])
  assert.equal(sub.interval, '30s')
  assert.equal(sub.tolerance, 100)
  assert.equal(sub.idle_timeout, '12h')
  assert.deepEqual(parent, {
    type: 'selector', tag: '主备', outbounds: ['香港-01', '__fo:fo1:B', '拒绝'], default: '香港-01', interrupt_exist_connections: true,
  })
  // 子组排在父组前面(内核要求引用的出站先定义不是硬性的,但顺序稳定便于对照)
  assert.ok(outbounds.indexOf(sub) < outbounds.indexOf(parent))
  assert.deepEqual(internalTags, ['__fo:fo1:B'])
  assert.ok(!publicTags.includes('__fo:fo1:B'))
  assert.ok(publicTags.includes('主备'))
  assert.equal(failover.length, 1)
  assert.equal(failover[0].tag, '主备')
  assert.equal(failover[0].rejectTag, '拒绝')
  assert.deepEqual(failover[0].lanes.map((l) => [l.id, l.mode, l.ref]), [['A', 'single', '香港-01'], ['B', 'urltest', '__fo:fo1:B']])
  assert.equal(failover[0].settings.intervalMs, 30000)
  assert.equal(failover[0].settings.failureThreshold, 2)
})

test('故障转移:失效节点不算有效成员;页签全空的组只剩兜底拒绝,不补直连;内置拒绝停用时用内部 block', () => {
  const groups = [
    ...defaultGroups().map((g) => (g.id === BUILTIN_IDS.block ? { ...g, enabled: false } : g)),
    failoverGroup({ lanes: [
      { id: 'A', members: ['已删节点', '香港-01'] },
      { id: 'B', members: ['也删了'] },
    ] }),
    failoverGroup({ id: 'fo2', name: '全空', lanes: [{ id: 'A', members: ['无'] }] }),
  ]
  const { outbounds, failover, placeholders, internalTags } = emitUserGroups(groups, nodes)
  const parent = outbounds.find((o) => o.tag === '主备')
  assert.deepEqual(parent.outbounds, ['香港-01', FAILOVER_REJECT_TAG])
  assert.equal(parent.default, '香港-01')
  assert.deepEqual(failover[0].lanes.map((l) => [l.mode, l.valid]), [['single', ['香港-01']], ['empty', []]])
  const empty = outbounds.find((o) => o.tag === '全空')
  assert.deepEqual(empty.outbounds, [FAILOVER_REJECT_TAG])
  assert.equal(empty.default, FAILOVER_REJECT_TAG)
  assert.equal(outbounds.filter((o) => o.tag === FAILOVER_REJECT_TAG).length, 1)
  assert.equal(outbounds.find((o) => o.tag === FAILOVER_REJECT_TAG).type, 'block')
  assert.ok(internalTags.includes(FAILOVER_REJECT_TAG))
  assert.ok(!placeholders.some((p) => p.name === '全空'), '故障转移组不用直连占位')
  assert.ok(!outbounds.some((o) => o.tag === '拒绝'), '停用的内置拒绝不会被故障转移拉回配置')
})

test('故障转移:两个单节点页签引用同一个节点时父组成员去重;页签只引用节点,写了组名不算有效', () => {
  const { outbounds, failover } = emitUser([...defaultGroups(), failoverGroup({ lanes: [
    { id: 'A', members: ['香港-01'] },
    { id: 'B', members: ['香港-01'] },
    { id: 'C', members: ['所有-自动'] },
  ] })], nodes)
  const parent = outbounds.find((o) => o.tag === '主备')
  assert.deepEqual(parent.outbounds, ['香港-01', '拒绝'])
  assert.deepEqual(failover[0].lanes.map((l) => l.mode), ['single', 'single', 'empty'])
})

test('故障转移:别的组可以把故障转移父组当成员,但拿不到内部子组', () => {
  const groups = [...defaultGroups(), failoverGroup(), { id: 'u', name: '手动', type: 'selector', mode: 'static', members: ['主备', '__fo:fo1:B'] }]
  const { outbounds } = emitUser(groups, nodes)
  assert.deepEqual(outbounds.find((o) => o.tag === '手动').outbounds, ['主备'])
})

test('默认两个组:所有-自动(urltest) 与 所有-手动(selector),成员都是全部节点', () => {
  const { outbounds, dropped } = emitUser(defaultGroups(), nodes)
  assert.equal(dropped.length, 0)
  assert.deepEqual(outbounds.map((o) => [o.tag, o.type]), [
    ['所有-自动', 'urltest'],
    ['所有-手动', 'selector'],
  ])
  assert.deepEqual(outbounds[0].outbounds, ['香港-01', '香港-02', '美国-01'])
  assert.equal(outbounds[0].interval, '5m')
  assert.equal(outbounds[0].tolerance, 100)
  // selector 不该带 urltest 才有的字段
  assert.equal(outbounds[1].interval, undefined)
  assert.equal(outbounds[1].tolerance, undefined)
})

test('allNodes 是动态的:节点变了,组的成员跟着变', () => {
  const before = emitUser(defaultGroups(), nodes).outbounds[0].outbounds
  const after = emitUser(defaultGroups(), [{ tag: '新节点' }]).outbounds[0].outbounds
  assert.equal(before.length, 3)
  assert.deepEqual(after, ['新节点'])
})

// 以下三条是 sing-box check 挡不住、必须由生成器自己保证的(见模块头注释)
test('成员为空的组挂 direct 占位:照样写进配置,但不能是空 outbounds(内核会 FATAL)', () => {
  const { outbounds, dropped, placeholders } = emitUser(
    [{ id: 'g', name: '空组', type: 'selector', members: [] }], nodes,
  )
  assert.deepEqual(outbounds, [{ type: 'selector', tag: '空组', outbounds: ['直连'] }])
  assert.deepEqual(dropped, [])
  assert.deepEqual(placeholders, ['空组'])
})

test('悬空成员被剔除,但不连累整个组', () => {
  const { outbounds } = emitUser(
    [{ id: 'g', name: 'G', type: 'selector', members: ['香港-01', '并不存在的节点'] }], nodes,
  )
  assert.deepEqual(outbounds[0].outbounds, ['香港-01'])
})

test('自引用成员被剔除', () => {
  const { outbounds } = emitUser(
    [{ id: 'g', name: 'G', type: 'selector', members: ['G', '美国-01'] }], nodes,
  )
  assert.deepEqual(outbounds[0].outbounds, ['美国-01'])
})

test('两个组互相引用 → 整对丢弃,不生成会在运行时打转的配置', () => {
  const { outbounds, dropped } = emitUser([
    { id: 'a', name: 'A', type: 'selector', members: ['B'] },
    { id: 'b', name: 'B', type: 'selector', members: ['A'] },
  ], nodes)
  assert.equal(outbounds.length, 0)
  assert.deepEqual(dropped.map((d) => d.reason), ['cycle', 'cycle'])
})

test('组可以引用别的组(非环),按依赖顺序都能生成', () => {
  const { outbounds, dropped } = emitUser([
    { id: 'a', name: '上层', type: 'selector', members: ['下层'] },
    { id: 'b', name: '下层', type: 'selector', members: ['香港-01'] },
  ], nodes)
  assert.equal(dropped.length, 0)
  assert.deepEqual(outbounds.map((o) => o.tag).sort(), ['上层', '下层'])
})

test('重复成员去重(sing-box 自己不去重)', () => {
  const { outbounds } = emitUser(
    [{ id: 'g', name: 'G', type: 'selector', members: ['香港-01', '香港-01'] }], nodes,
  )
  assert.deepEqual(outbounds[0].outbounds, ['香港-01'])
})

test('normalizeGroup:非法类型回落 selector,非法容差回落默认值', () => {
  const g = normalizeGroup({ name: 'X', type: 'fallback', tolerance: -5 })
  assert.equal(g.type, 'selector')
  assert.equal(g.tolerance, undefined) // selector 不带这个字段
  const u = normalizeGroup({ name: 'Y', type: 'urltest', tolerance: 'abc' })
  assert.equal(u.tolerance, 100)
  assert.equal(u.interval, '5m')
})

// -------- 动态组(按关键词现挑成员) --------

const nodesOf = (...tags) => tags.map((tag) => ({ tag }))

test('动态组按关键词从当前节点里挑成员', () => {
  const { outbounds } = emitUser(
    [{ id: 'g1', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: ['香港'] }],
    nodesOf('破晓 | 香港-01', '破晓 | 台湾-01', '备用 | 香港-02'),
  )
  assert.deepEqual(outbounds[0].outbounds, ['破晓 | 香港-01', '备用 | 香港-02'])
})

test('动态组不带关键词 = 全部节点', () => {
  const { outbounds } = emitUser(
    [{ id: 'g1', name: '全部', type: 'selector', mode: 'dynamic', keywords: [] }],
    nodesOf('A', 'B'),
  )
  assert.deepEqual(outbounds[0].outbounds, ['A', 'B'])
})

test('动态组只认节点,不会把同名命中的别的组吸进来(否则凭空成环)', () => {
  const { outbounds } = emitUser(
    [
      { id: 'g1', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: ['香港'] },
      { id: 'g2', name: '香港-手动', type: 'selector', mode: 'dynamic', keywords: ['香港'] },
    ],
    nodesOf('香港-01'),
  )
  assert.deepEqual(outbounds.map((o) => o.outbounds), [['香港-01'], ['香港-01']])
})

test('关键词匹配与地区词典同一套规则:国旗 emoji 能被 hk 命中', () => {
  const { outbounds } = emitUser(
    [{ id: 'g1', name: '香港', type: 'selector', mode: 'dynamic', keywords: ['hk'] }],
    nodesOf('🇭🇰香港 01', '美国 01'),
  )
  assert.deepEqual(outbounds[0].outbounds, ['🇭🇰香港 01'])
})

test('动态组一个都没命中也照样写进配置,挂 direct 占位等以后的节点', () => {
  // 用户建「爱尔兰-自动」就是在等以后有爱尔兰节点;组要是被丢掉,指向它的分流
  // 规则还得回去重挑目标
  const { outbounds, dropped, placeholders } = emitUser(
    [{ id: 'g1', name: '火星', type: 'selector', mode: 'dynamic', keywords: ['火星'] }],
    nodesOf('香港-01'),
  )
  assert.deepEqual(outbounds, [{ type: 'selector', tag: '火星', outbounds: ['直连'] }])
  assert.deepEqual(dropped, [])
  assert.deepEqual(placeholders, ['火星'])
})

test('老记录的 allNodes:true 迁移成"不带关键词的动态组",行为不变', () => {
  const g = normalizeGroup({ id: 'x', name: '所有', type: 'selector', allNodes: true })
  assert.equal(g.mode, 'dynamic')
  assert.deepEqual(g.keywords, [])
  const { outbounds } = emitUser([g], nodesOf('A', 'B'))
  assert.deepEqual(outbounds[0].outbounds, ['A', 'B'])
})

test('没写 mode 的老记录默认是静态组:成员照旧按 members 走', () => {
  const g = normalizeGroup({ id: 'x', name: '手挑', type: 'selector', members: ['A'] })
  assert.equal(g.mode, 'static')
  const { outbounds } = emitUser([g], nodesOf('A', 'B'))
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
  // 公司图标和地球一样是带前缀的值,不能被当成国家代码转大写
  assert.equal(normalizeGroup({ id: 'x', name: 'n', icon: 'brand:netflix' }).icon, 'brand:netflix')
  assert.equal(normalizeGroup({ id: 'x', name: 'n', icon: 'BRAND:Netflix' }).icon, 'brand:netflix')
})

test('图标不进 sing-box 出站:那边没有这个字段', () => {
  const { outbounds } = emitUser(
    [{ id: 'g1', name: '香港', type: 'selector', mode: 'dynamic', keywords: [], icon: 'HK' }],
    nodesOf('A'),
  )
  assert.ok(!('icon' in outbounds[0]), '出站里不该出现 icon')
})

test('默认列表:直连、拒绝两个内置出站在前,两个默认组自带地球图标', () => {
  assert.deepEqual(
    defaultGroups().map((g) => [g.name, g.icon]),
    [['直连', 'misc:dart'], ['所有-自动', 'globe:earth-asia'], ['所有-手动', 'globe:earth-meridians'], ['拒绝', 'misc:cross']],
  )
})

// -------- 内置出站:直连 / 拒绝 --------

test('内置出站永远在列表里:老档案没有就补上(直连最前、拒绝最后),有就照用户排的位置', () => {
  const fresh = normalizeGroups([{ id: 'g', name: 'G', type: 'selector', members: [] }])
  assert.deepEqual(fresh.map((g) => g.kind || g.name), ['direct', 'G', 'block'])
  const reordered = normalizeGroups([
    { id: 'g', name: 'G', type: 'selector', members: [] },
    { id: BUILTIN_IDS.block, name: '拒绝' },
    { id: BUILTIN_IDS.direct, name: '直连' },
  ])
  assert.deepEqual(reordered.map((g) => g.kind || g.name), ['G', 'block', 'direct'])
})

test('kind 只认固定 id:普通组冒充 direct 不生效', () => {
  const [g] = normalizeGroups([{ id: 'x', name: 'X', kind: 'direct', type: 'selector', members: [] }]).filter((g) => g.id === 'x')
  assert.equal(g.kind, undefined)
})

test('内置出站按名字出 tag:改名之后内核里的出站就叫那个名', () => {
  const { outbounds, builtin } = emitUserGroups([
    { id: BUILTIN_IDS.direct, name: '国内直出' },
    { id: BUILTIN_IDS.block, name: '拦截' },
    { id: 'g', name: '空组', type: 'selector', members: [] },
  ], nodes)
  assert.deepEqual(outbounds.slice(0, 2), [{ type: 'direct', tag: '国内直出' }, { type: 'block', tag: '拦截' }])
  assert.equal(builtin.direct, '国内直出')
  // 空组占位跟着直连现在的名字走
  assert.deepEqual(outbounds[2].outbounds, ['国内直出'])
})

test('停用的组不进配置;停用的拒绝也不进;停用的直连仍然要在(内核离不开它)', () => {
  const { outbounds, builtin } = emitUserGroups([
    { id: BUILTIN_IDS.direct, name: '直连', enabled: false },
    { id: BUILTIN_IDS.block, name: '拒绝', enabled: false },
    { id: 'a', name: 'A', type: 'selector', mode: 'dynamic', keywords: [], enabled: false },
    { id: 'b', name: 'B', type: 'selector', mode: 'dynamic', keywords: [] },
  ], nodes)
  assert.deepEqual(outbounds.map((o) => o.tag), ['直连', 'B'])
  assert.equal(builtin.directEnabled, false)
  assert.equal(builtin.blockEnabled, false)
  assert.deepEqual(builtinTags([]), { direct: '直连', block: '拒绝', directEnabled: true, blockEnabled: true })
})

test('内置出站的图标:用户存了什么就用什么(含 misc:direct / misc:reject 这两个变体),只有空的才补默认', () => {
  const [direct] = normalizeGroups([{ id: BUILTIN_IDS.direct, name: '直连', icon: 'misc:direct' }])
  assert.equal(direct.icon, 'misc:direct')
  const list = normalizeGroups([{ id: BUILTIN_IDS.block, name: '拒绝', icon: 'misc:reject' }])
  assert.equal(list.find((g) => g.kind === 'block').icon, 'misc:reject')
  const [custom] = normalizeGroups([{ id: BUILTIN_IDS.direct, name: '直连', icon: 'brand:google' }])
  assert.equal(custom.icon, 'brand:google')
  const [empty] = normalizeGroups([{ id: BUILTIN_IDS.direct, name: '直连', icon: '' }])
  assert.equal(empty.icon, 'misc:dart')
})

test('url-test 组的测速地址:组里填了用组的,没填用档案里的全局地址,都没有才用默认', () => {
  const groups = [
    { id: 'a', name: 'A', type: 'urltest', mode: 'dynamic', keywords: [], testUrl: 'http://a.test/204' },
    { id: 'b', name: 'B', type: 'urltest', mode: 'dynamic', keywords: [] },
  ]
  const withGlobal = userOnly(emitUserGroups(groups, nodes, { testUrl: 'http://global.test/204' }).outbounds)
  assert.deepEqual(withGlobal.map((o) => o.url), ['http://a.test/204', 'http://global.test/204'])
  const noGlobal = userOnly(emitUserGroups(groups, nodes).outbounds)
  assert.equal(noGlobal[1].url, 'https://www.gstatic.com/generate_204')
})

test('自动择优组带 idle_timeout:内核默认 30 分钟不用就停止健康检查,停了就一直挂在失效的线路上', () => {
  const { outbounds } = emitUserGroups(
    [{ id: 'g', name: '自动', type: 'urltest', mode: 'static', members: ['A', 'B'] }],
    [{ tag: 'A' }, { tag: 'B' }],
  )
  const group = outbounds.find((o) => o.tag === '自动')
  assert.equal(group.type, 'urltest')
  assert.equal(group.interval, '5m')
  assert.equal(group.tolerance, 100)
  assert.equal(group.idle_timeout, '12h')
  // 组自己填了就用组的
  const custom = emitUserGroups(
    [{ id: 'g', name: '自动', type: 'urltest', mode: 'static', members: ['A'], idleTimeout: '2h' }],
    [{ tag: 'A' }],
  ).outbounds.find((o) => o.tag === '自动')
  assert.equal(custom.idle_timeout, '2h')
})

test('图标缩放:整数、限在 ±20,缺省 0', async () => {
  const { normalizeGroup, normalizeIconScale } = await import('./user-groups.mjs')
  assert.equal(normalizeIconScale(undefined), 0)
  assert.equal(normalizeIconScale('2'), 2)
  assert.equal(normalizeIconScale(-1.6), -2)
  assert.equal(normalizeIconScale(99), 20)
  assert.equal(normalizeIconScale(-99), -20)
  assert.equal(normalizeIconScale(20), 20)
  assert.equal(normalizeGroup({ name: 'x', iconScale: -3 }).iconScale, -3)
  assert.equal(normalizeGroup({ name: 'x' }).iconScale, 0)
})

test('interval 比 idle_timeout 长时 idle_timeout 抬到和 interval 一样(sing-box 要求 interval ≤ idle_timeout,check 查不出、启动才炸)', async () => {
  const { emitUserGroups, idleTimeoutFor } = await import('./user-groups.mjs')
  assert.equal(idleTimeoutFor('12h', '5m'), '12h')
  assert.equal(idleTimeoutFor('12h', '1440m'), '1440m')
  assert.equal(idleTimeoutFor('12h', '12h'), '12h')
  assert.equal(idleTimeoutFor('2h', '3h'), '3h')
  assert.equal(idleTimeoutFor(undefined, '30m'), '12h')
  const nodes = [{ tag: 'A' }]
  const { outbounds } = emitUserGroups([{ id: 'g', name: '自动', type: 'urltest', mode: 'static', members: ['A'], interval: '1440m' }], nodes)
  const group = outbounds.find((o) => o.tag === '自动')
  assert.equal(group.interval, '1440m')
  assert.equal(group.idle_timeout, '1440m')
})

test('动态组按关键词选成员时把识别出的地区名也算上:订阅关了重命名、节点叫 US-01 也能进「美国-自动」', () => {
  const ns = [{ tag: 'US-01', regionName: '美国' }, { tag: 'HK-01', regionName: '香港' }, { tag: 'Tokyo Node', regionName: '' }]
  const groups = [{ id: 'g-us', name: '美国-自动', type: 'urltest', mode: 'dynamic', keywords: ['美国'], members: [], enabled: true }]
  const { outbounds } = emitUser(groups, ns)
  assert.deepEqual(outbounds.find((o) => o.tag === '美国-自动').outbounds, ['US-01'])
})
