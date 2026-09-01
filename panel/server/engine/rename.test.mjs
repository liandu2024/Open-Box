import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_REGION_DICT, DEFAULT_FEATURE_KEYWORDS, matchRegion, extractFeatures, renameNodes, previewRename, excludeNodes, isExcludedName } from './rename.mjs'
import { createNode } from './node-model.mjs'

const mk = (name) => createNode({ tag: name, type: 'trojan', server: 'a.com', server_port: 443, fields: { password: 'x', tls: { enabled: true } }, source: 'sharelink' })

test('matchRegion 覆盖缩写/中文/城市/emoji', () => {
  assert.equal(matchRegion('US-CA-01', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('洛杉矶 03', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('🇺🇸 premium', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('香港 IEPL', DEFAULT_REGION_DICT).name, '香港')
  assert.equal(matchRegion('unknown-place', DEFAULT_REGION_DICT), null)
})

test('matchRegion 短 ASCII 码需 token 边界,避免子串误配(修复4)', () => {
  assert.equal(matchRegion('Russia-01', DEFAULT_REGION_DICT), null)
  assert.equal(matchRegion('Sweden', DEFAULT_REGION_DICT), null)
  assert.equal(matchRegion('Ukraine', DEFAULT_REGION_DICT), null)
  assert.equal(matchRegion('Australia', DEFAULT_REGION_DICT), null)
  // 既有断言不回归
  assert.equal(matchRegion('US-CA-01', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('洛杉矶 03', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('🇺🇸 premium', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('香港 IEPL', DEFAULT_REGION_DICT).name, '香港')
})

test('extractFeatures 返回命中的关键词本身(转大写),按关键词表顺序去重', () => {
  // 语义变更:以前 iepl/iplc/专线 会被折叠成统一标签「专线」,现在命中哪个词就显示哪个词
  assert.deepEqual(extractFeatures('US-IEPL-2x', DEFAULT_FEATURE_KEYWORDS), ['IEPL', '2X'])
  assert.deepEqual(extractFeatures('普通节点', DEFAULT_FEATURE_KEYWORDS), [])
})

test('词典结构完整', () => {
  assert.ok(DEFAULT_REGION_DICT.length >= 8)
  for (const r of DEFAULT_REGION_DICT) {
    assert.ok(r.code && r.name && Array.isArray(r.keywords) && r.keywords.length > 0)
  }
})

test('renameNodes 模板 + 序号 + 特征省略', () => {
  // 命中多个关键词就按关键词表顺序依次拼接,全部转大写
  const out = renameNodes([mk('US-IEPL-2x 洛杉矶 01'), mk('US-IEPL 02'), mk('美国普通')])
  assert.equal(out[0].tag, '美国-IEPL-2X-01')
  // 序号只按「区域 + 首个特征」分组,所以 IEPL 与 IEPL-2X 共用同一组序号(原有设计)
  assert.equal(out[1].tag, '美国-IEPL-02')
  assert.equal(out[2].tag, '美国-01')          // 无特征:省略 feature 段
})

test('用户给的例子:关键词 iplc,ipv6 全命中 → 美国-IPLC-IPV6-01', () => {
  const out = renameNodes([mk('美国 IPLC IPv6 01')], { featureKeywords: ['iplc', 'ipv6'] })
  assert.equal(out[0].tag, '美国-IPLC-IPV6-01')
})

test('旧档案的两层 featureDict 仍能读:扁平化成关键词表(语义随之变成显示关键词本身)', () => {
  const out = renameNodes([mk('香港 IEPL 01')], {
    featureDict: [{ label: '专线', keywords: ['iepl', 'iplc'] }],
  })
  assert.equal(out[0].tag, '香港-IEPL-01')
})

test('renameNodes 序号按 区域+特征 组合独立递增', () => {
  const out = renameNodes([mk('香港 01'), mk('香港 02'), mk('日本 01')])
  assert.deepEqual(out.map((n) => n.tag), ['香港-01', '香港-02', '日本-01'])
})

test('renameNodes 未命中区域:归到"其他"并正常编号,不再把原名塞进 feature 位', () => {
  // 旧行为是 其他-火星基地-01:原名整个进 feature 位,而且原名当序号分组键,
  // 于是每个未识别节点各成一组、全都是 -01(真机上三条法国节点就是这样)。
  const out = renameNodes([mk('火星基地'), mk('月球基地'), mk('🇫🇷法国01｜三网')])
  assert.deepEqual(out.map((n) => n.tag), ['其他-01', '其他-02', '其他-03'])
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

test('applyTemplate 元字符 $&/$1 不被 String.replace 误解析(修复7)', () => {
  // 原名不再进 feature 位,但这条防护仍然需要:region 名、无法识别标签、特征关键词
  // 都是用户自己填的,任何一个写成 "$&" 都会被 String.replace 当成替换模式吃掉。
  const viaUnknownLabel = renameNodes([mk('火星基地')], { unknownLabel: 'A$&B' })
  assert.equal(viaUnknownLabel[0].tag, 'A$&B-01')

  const viaFeature = renameNodes([mk('香港 $1 节点')], { featureKeywords: ['$1'] })
  assert.equal(viaFeature[0].tag, '香港-$1-01')
})

// -------- 国旗 emoji --------
// 用户反馈:词典里带国旗关键词,但国旗没法用键盘输入。国旗本质就是两个「区域指示符」
// 字母(🇭🇰 = H,K),所以匹配前把它们还原成 ASCII,已有的 "hk" 就能命中,词典里不必
// 再收一份打不出来的字符。

test('节点名里的国旗被还原成国家代码,用可键入的关键词就能匹配', () => {
  const dict = [{ code: 'HK', name: '香港', keywords: ['hk', '香港'] }]
  assert.deepEqual(matchRegion('🇭🇰香港 01', dict), { code: 'HK', name: '香港' })
  // 只有国旗、没有任何文字的节点名也能认出来
  assert.deepEqual(matchRegion('🇭🇰 01', dict), { code: 'HK', name: '香港' })
})

test('两个国旗连着写也不会粘成一个词而漏配', () => {
  const dict = [{ code: 'HK', name: '香港', keywords: ['hk'] }]
  assert.deepEqual(matchRegion('🇭🇰🇨🇳 01', dict), { code: 'HK', name: '香港' })
})

test('老词典里残留的国旗关键词仍然有效(改动不破坏已存配置)', () => {
  const dict = [{ code: 'HK', name: '香港', keywords: ['🇭🇰'] }]
  assert.deepEqual(matchRegion('🇭🇰 01', dict), { code: 'HK', name: '香港' })
  assert.deepEqual(matchRegion('香港 01', dict), null)
})

test('短码的 token 边界保护没有被削弱', () => {
  const dict = [{ code: 'US', name: '美国', keywords: ['us'] }]
  assert.equal(matchRegion('Russia 01', dict), null)
  assert.equal(matchRegion('Australia', dict), null)
  assert.deepEqual(matchRegion('US-Premium', dict), { code: 'US', name: '美国' })
})

test('默认地区词典里不再含无法输入的国旗字符', () => {
  const flag = /[\u{1F1E6}-\u{1F1FF}]/u
  for (const region of DEFAULT_REGION_DICT) {
    for (const kw of region.keywords) {
      assert.ok(!flag.test(kw), `${region.name} 的关键词 ${kw} 仍是国旗`)
    }
  }
})

// -------- 过滤节点 --------
// 机场订阅里混着公告/广告条目(「官网｜https://xxx.com」「高速倍率节点请提工单开通」),
// 它们不是节点却会被当成节点导入、参与分组、出现在策略组里。

test('命中过滤关键词的条目被整条剔除,真节点保留', () => {
  const nodes = [
    mk('官网｜https://破晓.com'),
    mk('高速倍率节点请提工单开通'),
    mk('🇭🇰香港 01 | 三网'),
    mk('美国 IPLC 01'),
  ]
  const { kept, excluded } = excludeNodes(nodes)
  assert.deepEqual(kept.map((n) => n.originalTag), ['🇭🇰香港 01 | 三网', '美国 IPLC 01'])
  assert.equal(excluded.length, 2)
})

test('过滤发生在改名之前:预览表里不会出现被过滤的条目,序号也不给它留号', () => {
  const nodes = [mk('官网｜https://破晓.com'), mk('香港 01'), mk('香港 02')]
  const { kept } = excludeNodes(nodes)
  assert.deepEqual(renameNodes(kept).map((n) => n.tag), ['香港-01', '香港-02'])
})

test('自定义过滤词覆盖默认值', () => {
  const nodes = [mk('官网 通知'), mk('测试节点 01')]
  // 只过滤「测试」时,默认的「官网」不再生效
  const { kept } = excludeNodes(nodes, { excludeKeywords: ['测试'] })
  assert.deepEqual(kept.map((n) => n.originalTag), ['官网 通知'])
})

test('过滤词为空数组时不过滤任何东西', () => {
  const nodes = [mk('官网｜https://破晓.com'), mk('香港 01')]
  assert.equal(excludeNodes(nodes, { excludeKeywords: [] }).kept.length, 2)
})

test('纯 ASCII 短过滤词受 token 边界保护,不会误伤', () => {
  assert.equal(isExcludedName('VIP-US-01', ['vip']), true)
  assert.equal(isExcludedName('Advipsory 节点', ['vip']), false)
})

// -------- 输出顺序 --------
// 地区词典的顺序是用户在规则页拖出来的:它既是匹配优先级,也理应是节点的呈现顺序。

test('节点按地区词典顺序排列,未识别的归到最后', () => {
  const dict = [
    { code: 'HK', name: '香港', keywords: ['hk', '香港'] },
    { code: 'US', name: '美国', keywords: ['us', '美国'] },
  ]
  const raw = ['美国01', '法国01', '香港01', '美国02', '法国02', '香港02']
  const out = renameNodes(raw.map(mk), { regionDict: dict })
  assert.deepEqual(out.map((n) => n.tag), [
    '香港-01', '香港-02',   // 词典里香港在前
    '美国-01', '美国-02',
    '其他-01', '其他-02',   // 未识别垫底
  ])
})

test('调换词典顺序,节点顺序跟着变', () => {
  const raw = ['美国01', '香港01']
  const hkFirst = [
    { code: 'HK', name: '香港', keywords: ['香港'] },
    { code: 'US', name: '美国', keywords: ['美国'] },
  ]
  const usFirst = [hkFirst[1], hkFirst[0]]
  assert.deepEqual(renameNodes(raw.map(mk), { regionDict: hkFirst }).map((n) => n.tag), ['香港-01', '美国-01'])
  assert.deepEqual(renameNodes(raw.map(mk), { regionDict: usFirst }).map((n) => n.tag), ['美国-01', '香港-01'])
})

test('组内保持订阅原始次序,序号仍然连续', () => {
  const raw = ['香港01', '美国01', '香港02', '美国02', '香港03']
  const dict = [{ code: 'US', name: '美国', keywords: ['美国'] }, { code: 'HK', name: '香港', keywords: ['香港'] }]
  const out = renameNodes(raw.map(mk), { regionDict: dict })
  assert.deepEqual(out.map((n) => n.tag), ['美国-01', '美国-02', '香港-01', '香港-02', '香港-03'])
})

test('previewRename 用节点自带的 originalTag 配对,重排后原名与新名不会错位', () => {
  const dict = [{ code: 'HK', name: '香港', keywords: ['香港'] }]
  const rows = previewRename(['美国01', '香港01'].map(mk), { regionDict: dict })
  assert.deepEqual(rows, [
    { originalTag: '香港01', newTag: '香港-01' },
    { originalTag: '美国01', newTag: '其他-01' },
  ])
})

// -------- 逐条手工改名 --------

test('overrides 按原名覆盖节点名', () => {
  const out = renameNodes(['香港01', '香港02'].map(mk), { overrides: { 香港02: '我的香港' } })
  assert.deepEqual(out.map((n) => n.tag), ['香港-01', '我的香港'])
})

test('改过名的节点不消耗序号,同组不跳号', () => {
  const out = renameNodes(['香港01', '香港02', '香港03'].map(mk), { overrides: { 香港02: '我的香港' } })
  // 若改名的那条仍占号,这里会是 香港-01 / 我的香港 / 香港-03
  assert.deepEqual(out.map((n) => n.tag), ['香港-01', '我的香港', '香港-02'])
})

test('空字符串/纯空白的 override 视为没设,回落模板名', () => {
  const out = renameNodes(['香港01'].map(mk), { overrides: { 香港01: '   ' } })
  assert.equal(out[0].tag, '香港-01')
})

test('override 不影响排序:仍按其原本匹配到的地区归位', () => {
  const dict = [{ code: 'US', name: '美国', keywords: ['美国'] }, { code: 'HK', name: '香港', keywords: ['香港'] }]
  const out = renameNodes(['香港01', '美国01'].map(mk), { regionDict: dict, overrides: { 香港01: 'ZZZ' } })
  assert.deepEqual(out.map((n) => n.tag), ['美国-01', 'ZZZ'])
})
